import { supabase } from './supabase';

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// La tabla real guarda la suscripción entera como jsonb en `subscription`
// (forma estándar de PushSubscription.toJSON(): {endpoint, keys:{p256dh,auth}}),
// no como columnas planas endpoint/p256dh/auth.
//
// Guarda (o actualiza, si el endpoint ya existía) la suscripción de Web
// Push de este dispositivo/navegador. `endpoint` identifica el navegador,
// así que buscamos por `subscription->>endpoint` antes de decidir si
// insertar o actualizar (sin depender de un unique constraint que no
// controlamos, para no volver a pisar una columna que no existe).
export async function savePushSubscription(userId: string, keys: PushSubscriptionKeys): Promise<void> {
  const subscription = { endpoint: keys.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;

  const { data: existente, error: buscarError } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('subscription->>endpoint', keys.endpoint)
    .maybeSingle();
  if (buscarError) throw new Error(buscarError.message);

  if (existente) {
    const { error } = await supabase
      .from('push_subscriptions')
      .update({ user_id: userId, subscription, user_agent: userAgent })
      .eq('id', existente.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .insert({ user_id: userId, subscription, user_agent: userAgent });
  if (error) throw new Error(error.message);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('subscription->>endpoint', endpoint);
  if (error) throw new Error(error.message);
}
