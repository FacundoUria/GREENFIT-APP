import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/adminGuard.ts';
import { buildPreferenceRequest, createMpPreference, resolveBackUrls, resolveInitPoint, MpApiError } from '../_shared/mercadopago.ts';

interface CreatePreferenceBody {
  packId: string;
  userId?: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Arma la preferencia de Checkout Pro para un pack real -- el precio, los
// créditos/días y la disciplina SIEMPRE se leen de `packs` acá (Service
// Role, nunca del body que mande el cliente). `packName`/`price` que
// paymentsApi.ts todavía manda desde la PWA quedan ignorados a propósito:
// confiar en un monto que viene del cliente para una transacción real de
// dinero es exactamente el tipo de bug que se puede explotar.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = createAdminClient();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Falta el header Authorization.' }, 401);
    }
    const jwt = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(jwt);
    if (userError || !user) {
      return jsonResponse({ error: 'Token inválido o vencido.' }, 401);
    }

    const body: CreatePreferenceBody = await req.json();
    if (!body.packId) {
      return jsonResponse({ error: 'Falta packId.' }, 400);
    }

    // El socio logueado solo puede generar una preferencia para sí mismo --
    // el user_id que viaja en external_reference es a quien se le van a
    // acreditar los créditos/vencimiento apenas se apruebe el pago.
    const userId = body.userId ?? user.id;
    if (userId !== user.id) {
      return jsonResponse({ error: 'No podés comprar un pack para otro socio.' }, 403);
    }

    const { data: pack, error: packError } = await admin
      .from('packs')
      .select('id, name, price, is_active, incluye_aparatos, dias_vigencia, creditos')
      .eq('id', body.packId)
      .maybeSingle();
    if (packError) {
      return jsonResponse({ error: packError.message }, 400);
    }
    if (!pack) {
      return jsonResponse({ error: 'El pack no existe.' }, 404);
    }
    if (pack.is_active === false) {
      return jsonResponse({ error: 'Este pack ya no está disponible.' }, 400);
    }

    // Si el combo incluye Aparatos, se resuelve acá (Service Role, contra
    // `disciplines`) cuál es su discipline_id real -- así el webhook nunca
    // tiene que adivinarlo por nombre ni asumir que hay una sola disciplina
    // kind='membership'.
    let aparatosDisciplineId: string | null = null;
    if (pack.incluye_aparatos) {
      const { data: disciplinaAparatos, error: discError } = await admin
        .from('disciplines')
        .select('id')
        .eq('kind', 'membership')
        .limit(1)
        .maybeSingle();
      if (discError) {
        return jsonResponse({ error: discError.message }, 400);
      }
      if (!disciplinaAparatos) {
        return jsonResponse({ error: 'Este pack incluye Aparatos pero no existe ninguna disciplina de membresía configurada.' }, 400);
      }
      aparatosDisciplineId = disciplinaAparatos.id;
    }

    const accessToken = Deno.env.get('MP_ACCESS_TOKEN');
    // Log de diagnóstico: NUNCA el token completo -- alcanza con saber que
    // está seteado y su prefijo (TEST- = cuenta de prueba, APP_USR- = cuenta
    // real) para poder ver en los logs de la función si el ambiente
    // configurado en los secrets de Supabase es el que se esperaba.
    console.log(
      '[create-payment-preference] MP_ACCESS_TOKEN presente:',
      !!accessToken,
      'prefijo:',
      accessToken ? accessToken.slice(0, 8) : null
    );
    if (!accessToken) {
      return jsonResponse({ error: 'Falta MP_ACCESS_TOKEN configurado en los secrets de Supabase.' }, 500);
    }
    if (!accessToken.startsWith('TEST-') && !accessToken.startsWith('APP_USR-')) {
      console.error('[create-payment-preference] MP_ACCESS_TOKEN con formato inesperado (no empieza con TEST- ni APP_USR-).');
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) {
      return jsonResponse({ error: 'Falta SUPABASE_URL.' }, 500);
    }

    // Si el request viene de un navegador (Web/PWA), el back_url tiene que
    // ser el origin real de la PWA -- react-native-webview no soporta Web,
    // así que ahí el checkout se abre con una redirección de página
    // completa en vez de un WebView embebido (ver resolveBackUrls y
    // PaymentWebViewScreen.tsx).
    const backUrls = resolveBackUrls(req.headers.get('origin'));

    const creditos: { disciplineId: string; credits: number }[] = Array.isArray(pack.creditos)
      ? pack.creditos
          .filter((c: any) => c && typeof c.discipline_id === 'string' && typeof c.credits === 'number' && c.credits > 0)
          .map((c: any) => ({ disciplineId: c.discipline_id, credits: c.credits }))
      : [];

    const preferenceBody = buildPreferenceRequest({
      pack: {
        id: pack.id,
        name: pack.name,
        price: pack.price,
        creditos,
        incluyeAparatos: pack.incluye_aparatos === true,
        diasVigencia: pack.dias_vigencia ?? null,
      },
      userId,
      notificationUrl: `${supabaseUrl}/functions/v1/mp-webhook`,
      backUrls,
      payerEmail: user.email,
      aparatosDisciplineId,
    });

    const preference = await createMpPreference(accessToken, preferenceBody);
    // TEST- (cuenta de prueba) solo puede abrir sandbox_init_point --
    // devolver init_point ahí es EXACTAMENTE el "Tuvimos un problema
    // (COW00...)" que ve el socio en el checkout. APP_USR- (cuenta real) es
    // al revés.
    const initPoint = resolveInitPoint(accessToken, preference);

    return jsonResponse({ initPoint, preferenceId: preference.id }, 200);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof MpApiError) {
      // La respuesta exacta de Mercado Pago ya quedó logueada dentro de
      // createMpPreference (status + body completo) -- acá solo se decide
      // qué tan explícito es el mensaje que recibe el cliente. 502: el
      // problema es de un servicio de terceros (Mercado Pago), no de esta
      // función.
      console.error('[create-payment-preference] Mercado Pago rechazó la preferencia:', err.status, JSON.stringify(err.body));
      return jsonResponse({ error: err.message }, 502);
    }
    console.error('[create-payment-preference] Error inesperado:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Error inesperado creando la preferencia.' },
      500
    );
  }
});
