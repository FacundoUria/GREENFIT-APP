import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/adminGuard.ts';
import { extractPaymentId, fetchMpPayment, parseExternalReference } from '../_shared/mercadopago.ts';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Público (sin JWT) -- lo llama Mercado Pago, no la app. La seguridad NO
// pasa por autenticar el request entrante (el body de un webhook nunca es
// confiable por sí solo: cualquiera podría mandar un POST fingiendo un
// pago aprobado) sino por volver a consultar el pago REAL contra la API de
// MP con nuestro propio MP_ACCESS_TOKEN antes de acreditar nada -- el
// status/monto que importa es el que MP devuelve ahí, nunca el del body
// entrante.
//
// Responde 200 en casi todos los casos, incluidos los "no aplica" (evento
// que no es de payment, external_reference no reconocible, etc.) -- MP
// reintenta agresivamente cualquier respuesta que no sea 2xx, y esos casos
// no son errores transitorios que valga la pena reintentar.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let body: unknown = null;
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = null;
      }
    }

    const paymentId = extractPaymentId(body, url);
    if (!paymentId) {
      return jsonResponse({ ignored: true }, 200);
    }

    const accessToken = Deno.env.get('MP_ACCESS_TOKEN');
    if (!accessToken) {
      console.error('[mp-webhook] Falta MP_ACCESS_TOKEN configurado en los secrets de Supabase.');
      return jsonResponse({ error: 'Falta MP_ACCESS_TOKEN configurado.' }, 500);
    }

    const payment = await fetchMpPayment(accessToken, paymentId);
    const reference = parseExternalReference(payment.external_reference);
    if (!reference) {
      console.error(`[mp-webhook] Pago ${paymentId} sin external_reference reconocible -- se ignora.`);
      return jsonResponse({ ignored: true }, 200);
    }

    const admin = createAdminClient();

    const { data: packRow } = await admin.from('packs').select('name').eq('id', reference.pack_id).maybeSingle();

    const { error: rpcError } = await admin.rpc('mp_process_payment', {
      p_user_id: reference.user_id,
      p_pack_id: reference.pack_id,
      p_creditos: reference.creditos,
      p_incluye_aparatos: reference.incluye_aparatos,
      p_dias_vigencia: reference.dias_vigencia,
      p_aparatos_discipline_id: reference.aparatos_discipline_id,
      p_amount: payment.transaction_amount,
      p_paquete: packRow?.name ?? 'Pack Mercado Pago',
      p_mp_payment_id: String(payment.id),
      p_mp_status: payment.status,
    });

    if (rpcError) {
      console.error(`[mp-webhook] Error procesando el pago ${paymentId}:`, rpcError.message);
      return jsonResponse({ error: rpcError.message }, 500);
    }

    return jsonResponse({ processed: true, status: payment.status }, 200);
  } catch (err) {
    console.error('[mp-webhook] Error inesperado:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Error inesperado.' }, 500);
  }
});
