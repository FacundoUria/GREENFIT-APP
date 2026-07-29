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
