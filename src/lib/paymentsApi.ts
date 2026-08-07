import { supabase } from './supabase';

// packName/price salieron del contrato a propósito: el precio de una
// transacción real de dinero NUNCA lo decide el cliente -- la Edge
// Function lee el pack real de `packs` (Service Role) y arma la
// preferencia con ESE precio, ignorando cualquier otra cosa que se le
// mande. Ver supabase/functions/create-payment-preference/index.ts.
export interface CreatePreferenceParams {
  packId: string;
  userId: string;
}

export interface PaymentPreference {
  initPoint: string;
  preferenceId: string | null;
}

// Sandbox real de Mercado Pago, SOLO como fallback mientras la Edge
// Function `create-payment-preference` no esté DESPLEGADA (o no exista) --
// deja el flujo de UI (redirección/WebView, detección de retorno, refresco
// de balances) probable de punta a punta sin bloquear el resto del trabajo
// en la app a que el backend de pagos esté listo. Si la función SÍ está
// desplegada y contesta con un error real (token de Mercado Pago vencido,
// pack inactivo, la API de Mercado Pago rechazó la preferencia, etc.), NO
// corresponde este fallback -- ver PaymentPreferenceError más abajo.
const MOCK_INIT_POINT = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=MOCK-PREFERENCE';

// Error de NEGOCIO explícito: la Edge Function está desplegada, recibió el
// pedido y contestó que no pudo generar la orden de pago. Se distingue del
// fallback de arriba por `response` en el resultado de supabase-js
// (supabase.functions.invoke): viene seteado cuando la función respondió
// -- aunque haya sido con un error -- y viene undefined solo cuando ni
// siquiera se pudo conectar (función no desplegada, sin red). Acá NUNCA
// hay que caer al mock: eso taparía un problema real de plata con un
// checkout falso que además nunca acredita nada.
export class PaymentPreferenceError extends Error {}

const MENSAJE_GENERICO = 'No se pudo generar la orden de pago. Consultá con el gimnasio.';

export async function createPaymentPreference(params: CreatePreferenceParams): Promise<PaymentPreference> {
  const { data, error, response } = await supabase.functions.invoke('create-payment-preference', {
    body: params,
  });

  if (error) {
    if (response) {
      // La función SÍ está desplegada y contestó -- se lee su mensaje real
      // (viene siempre en {error: "..."}, ver create-payment-preference/
      // index.ts) en vez de taparlo con el mock.
      const body = await response.json().catch(() => null);
      console.error('[paymentsApi] create-payment-preference devolvió un error:', response.status, body);
      throw new PaymentPreferenceError(body?.error ?? MENSAJE_GENERICO);
    }
    // Sin response: error de red real (la función no está desplegada
    // todavía, DNS, sin conexión) -- esto sí es un problema de entorno de
    // desarrollo, no de negocio, así que cae al mock para no bloquear el
    // resto del flujo de UI.
    console.warn(
      '[paymentsApi] create-payment-preference no disponible todavía, uso mock:',
      error instanceof Error ? error.message : error
    );
    return { initPoint: MOCK_INIT_POINT, preferenceId: null };
  }

  if (!data?.initPoint) {
    console.error('[paymentsApi] create-payment-preference respondió 200 pero sin initPoint:', data);
    throw new PaymentPreferenceError(MENSAJE_GENERICO);
  }

  return { initPoint: data.initPoint, preferenceId: data.preferenceId ?? null };
}
