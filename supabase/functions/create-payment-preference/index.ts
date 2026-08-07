import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/adminGuard.ts';
import { buildPreferenceRequest, createMpPreference, resolveBackUrls } from '../_shared/mercadopago.ts';

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
      .select('id, name, price, credits, duration_days, discipline_id, is_active')
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

    const accessToken = Deno.env.get('MP_ACCESS_TOKEN');
    if (!accessToken) {
      return jsonResponse({ error: 'Falta MP_ACCESS_TOKEN configurado en los secrets de Supabase.' }, 500);
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

    const preferenceBody = buildPreferenceRequest({
      pack: {
        id: pack.id,
        name: pack.name,
        price: pack.price,
        credits: pack.credits,
        durationDays: pack.duration_days,
        disciplineId: pack.discipline_id,
      },
      userId,
      notificationUrl: `${supabaseUrl}/functions/v1/mp-webhook`,
      backUrls,
    });

    const { id, initPoint } = await createMpPreference(accessToken, preferenceBody);

    return jsonResponse({ initPoint, preferenceId: id }, 200);
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Error inesperado creando la preferencia.' },
      500
    );
  }
});
