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
    meta.content = 'Greenfit';
    return meta;
  });

  ensureTag('link[rel="apple-touch-icon"]', () => {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = '/icons/icon-192.png';
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
export function registerPwa() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  injectHeadTags();
  registerServiceWorker();
}
