// Helpers de Web Push (VAPID) para el navegador. Todo lo que toca acá
// (Notification, ServiceWorkerRegistration, PushManager) solo existe en
// `web` — quien llame a estas funciones debe hacerlo detrás de un chequeo
// de Platform.OS === 'web'.

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;

export function isWebPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

// El navegador espera la clave VAPID como Uint8Array, no como el string
// base64url que se genera/guarda en .env — esta es la conversión estándar
// documentada por la spec de Push API.
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToWebPush(): Promise<PushSubscription> {
  if (!VAPID_PUBLIC_KEY) {
    throw new Error(
      'Falta configurar EXPO_PUBLIC_VAPID_PUBLIC_KEY en .env con la clave pública VAPID del backend.'
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('No diste permiso de notificaciones — activalo desde la configuración del navegador.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
}

export async function unsubscribeFromWebPush(): Promise<string | null> {
  const subscription = await getExistingSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
