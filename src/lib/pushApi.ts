import { supabase } from './supabase';

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Guarda (o actualiza, si el endpoint ya existía) la suscripción de Web
// Push de este dispositivo/navegador. `endpoint` es único por navegador, así
// que un upsert por endpoint alcanza para cubrir "el socio ya la tenía
// activada acá" sin duplicar filas.
export async function savePushSubscription(userId: string, keys: PushSubscriptionKeys): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: keys.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw new Error(error.message);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw new Error(error.message);
}
