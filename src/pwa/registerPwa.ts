import { Platform } from 'react-native';

function ensureTag(selector: string, build: () => HTMLElement) {
  if (document.head.querySelector(selector)) return;
  document.head.appendChild(build());
}

// Metro (a diferencia del viejo @expo/webpack-config) no genera manifest.json
// ni service worker automáticamente a partir de app.json — arma un
// index.html "pelado". Estos <link>/<meta> son justamente lo que un
// index.html de PWA tendría hardcodeado; los inyectamos en runtime así no
// dependemos de pisar la plantilla HTML interna de Expo.
function injectHeadTags() {
  ensureTag('link[rel="icon"]', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.setAttribute('sizes', '192x192');
    link.href = '/icons/icon-192.png';
    return link;
  });

  ensureTag('link[rel="manifest"]', () => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    return link;
  });

  ensureTag('meta[name="theme-color"]', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#0F0F0F';
    return meta;
  });

  // Meta tags específicos de iOS: Safari ignora manifest.json para el ícono
  // y el modo "standalone" al agregar a inicio, así que hace falta esto
  // aparte para que la PWA abra sin barra de Safari y con ícono propio.
  ensureTag('meta[name="apple-mobile-web-app-capable"]', () => {
    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-capable';
    meta.content = 'yes';
    return meta;
  });

  ensureTag('meta[name="apple-mobile-web-app-status-bar-style"]', () => {
    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-status-bar-style';
    meta.content = 'black-translucent';
    return meta;
  });

  ensureTag('meta[name="apple-mobile-web-app-title"]', () => {
    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-title';
    meta.content = 'GreenFit';
    return meta;
  });

  ensureTag('link[rel="apple-touch-icon"]', () => {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.setAttribute('sizes', '180x180');
    link.href = '/icons/apple-touch-icon.png';
    return link;
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[pwa] no se pudo registrar el service worker:', err);
  }
}

// Se llama una sola vez, apenas arranca la app. En nativo (iOS/Android) es
// un no-op: no hay `document`/`navigator.serviceWorker` real y no aplica.
//
// EXPO_PUBLIC_E2E_MODE desactiva el service worker a propósito: su handler
// de `fetch` (ver public/sw.js) re-emite cada request DESDE SU PROPIO
// CONTEXTO ("self.respondWith(fetch(event.request))"), que corre fuera del
// frame de la página -- el page.route() de Playwright no lo intercepta, así
// que apenas el SW toma control (unos segundos después de cargar, vía
// clients.claim()) cualquier request posterior empieza a pegarle a la red
// REAL en vez de al mock. Esto se detectó en la práctica: el login fallaba
// con "Failed to fetch" solo después de que pasaban unos segundos en la
// pantalla, nunca en el primer request.
export function registerPwa() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (process.env.EXPO_PUBLIC_E2E_MODE === 'true') return;
  injectHeadTags();
  registerServiceWorker();
}
