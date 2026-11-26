import { VIBRACION } from '../theme/motion';

// Vibración corta (tanda visual, parte 4) con navigator.vibrate, si existe.
// Android sí; iPhone no tiene Vibration API: no vibra y no falla. Fuera de la
// web (nativo) tampoco hace nada. Duraciones en src/theme/motion.ts.
export type MomentoVibracion = keyof typeof VIBRACION;

export function vibrar(momento: MomentoVibracion): void {
  if (typeof navigator === 'undefined') return;
  const vibrate = (navigator as Navigator & { vibrate?: (patron: number) => boolean }).vibrate;
  if (typeof vibrate !== 'function') return;
  try {
    vibrate.call(navigator, VIBRACION[momento]);
  } catch {
    // Algún navegador puede negarse (por ejemplo, sin interacción previa): no pasa nada.
  }
}
