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
// Function `create-payment-preference` no esté desplegada en Supabase (o
// falle) — deja el flujo de UI (WebView, detección de retorno, refresco de
// balances) 100% probable de punta a punta sin bloquear el resto del trabajo
// en la app a que el backend de pagos esté listo.
const MOCK_INIT_POINT = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=MOCK-PREFERENCE';

export async function createPaymentPreference(params: CreatePreferenceParams): Promise<PaymentPreference> {
  try {
    const { data, error } = await supabase.functions.invoke('create-payment-preference', {
      body: params,
    });
    if (error) throw new Error(error.message);
    if (!data?.initPoint) throw new Error('La función no devolvió un init_point.');
    return { initPoint: data.initPoint, preferenceId: data.preferenceId ?? null };
  } catch (err) {
    console.warn(
      '[paymentsApi] create-payment-preference no disponible todavía, uso mock:',
      err instanceof Error ? err.message : err
    );
    return { initPoint: MOCK_INIT_POINT, preferenceId: null };
  }
}
