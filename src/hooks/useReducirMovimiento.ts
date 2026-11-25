import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// "Reducir movimiento" del sistema (en web, react-native-web lo lee de
// `prefers-reduced-motion`). Con eso activado, las animaciones quedan en solo
// fade: sin desplazamientos ni escalas.
//
// Un solo valor compartido para toda la app (no un listener por componente:
// cada botón usa este hook).

let reducir = false;
let iniciado = false;
const oyentes = new Set<() => void>();

function avisar(valor: boolean) {
  reducir = !!valor;
  oyentes.forEach((oyente) => oyente());
}

function iniciar() {
  if (iniciado) return;
  iniciado = true;
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then(avisar)
    .catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', avisar);
}

function suscribir(oyente: () => void) {
  iniciar();
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function useReducirMovimiento(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => reducir,
    () => false
  );
}

// Solo para tests.
export function __resetReducirMovimientoParaTests() {
  reducir = false;
  iniciado = false;
  oyentes.clear();
}
