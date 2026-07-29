// Service Worker de Greenfit — instalabilidad de la PWA + Web Push.
//
// A propósito NO cachea el bundle de la app (nada de "cache first" sobre
// los JS de Metro): son archivos con hash que cambian en cada build, y
// cachearlos mal es la forma más común de dejar a un usuario pegado en una
// versión vieja de la app. Lo único que este SW hace de forma activa es
// recibir pushes con la app cerrada y mostrar la notificación nativa.

const CACHE_NAME = 'greenfit-shell-v1';
const SHELL_ASSETS = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Chrome exige un Service Worker que controle la página (con handler de
// `fetch`) como parte de sus criterios de instalabilidad -- sin esto,
// `beforeinstallprompt` puede no dispararse nunca aunque el manifest esté
// perfecto. Es un passthrough puro a la red: no cambia nada del
// comportamiento real, solo satisface ese requisito.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Núcleo del punto 3 del pedido: esto es lo que dispara el banner/sonido
// nativo del sistema operativo aunque la app esté cerrada o el teléfono en
// reposo — el browser despierta este Service Worker solo para correr este
// handler. El payload lo arma el backend (Edge Function del dashboard admin)
// al mandar el push firmado con la clave VAPID privada.
self.addEventListener('push', (event) => {
  let payload = { title: 'Greenfit', body: 'Tenés una notificación nueva.' };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const options = {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'greenfit-notification',
    data: { url: payload.url || '/' },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Al tocar la notificación: si ya hay una pestaña de la app abierta la
// enfoca, si no abre una nueva — así el toque siempre lleva de vuelta a la
// app en vez de dejar la notificación como un callejón sin salida.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
