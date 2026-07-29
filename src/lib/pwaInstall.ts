// Helpers compartidos por los distintos puntos de entrada de instalación de
// la PWA (banners automáticos + botón manual en Login) para no repetir la
// misma detección de plataforma en cada componente.

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isIosSafariBrowser(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
  return isIos && isSafari;
}

export function isAlreadyStandalone(): boolean {
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

// El bundle de React tarda en descargar/ejecutar (~2MB); si el navegador
// dispara `beforeinstallprompt` en esa ventana, antes de que cualquier
// componente haya montado su propio listener, el evento se pierde para
// siempre (no se repite). Un script inline en index.html lo captura apenas
// arranca la página, lo guarda acá, y avisa con este CustomEvent -- estas
// funciones son el puente para que los componentes de React lo recojan sin
// importar si llegó antes o después de montar.
const READY_EVENT = 'greenfit:install-prompt-ready';

export function getCapturedInstallPrompt(): BeforeInstallPromptEvent | null {
  return (window as any).__greenfitInstallPrompt ?? null;
}

export function wasInstalledGlobally(): boolean {
  return (window as any).__greenfitInstalled === true;
}

export function onInstallPromptReady(callback: () => void): () => void {
  window.addEventListener(READY_EVENT, callback);
  return () => window.removeEventListener(READY_EVENT, callback);
}
