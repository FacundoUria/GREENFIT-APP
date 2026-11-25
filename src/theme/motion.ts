// Tokens de movimiento de la PWA (tanda visual).
//
// El sistema de movimiento es el de la referencia (EcommerceMar: Reveal.jsx /
// index.css): misma curva, mismas duraciones, aparición y toque. Los colores y
// el layout NO se copian. Reglas:
//   * solo transform y opacity (nada que recalcule layout ni repinte);
//   * en web, transiciones y keyframes CSS (react-native-web los soporta): los
//     anima el compositor del navegador, sin JS por cuadro;
//   * con "reducir movimiento", solo fade (ver useReducirMovimiento);
//   * scroll nativo, nunca scroll suave artificial.

export const CURVA = [0.22, 1, 0.36, 1] as const;
export const CURVA_CSS = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const DURACION = {
  toque: 200, // escala al tocar, check, pastilla "Reservada", cierre de hojas
  aparicion: 600, // aparición al entrar en pantalla y apertura de hojas
} as const;

export const APARICION = {
  desplazamiento: 24, // px, de abajo hacia arriba
  cascada: 60, // ms entre un elemento y el siguiente
  topeCascada: 6, // del 7.º en adelante, todos con el mismo retraso (una lista larga no espera)
} as const;

export const retrasoCascada = (indice: number): number =>
  Math.min(Math.max(indice, 0), APARICION.topeCascada) * APARICION.cascada;

export const TOQUE = {
  escala: 0.96,
  opacidadReducida: 0.7, // con "reducir movimiento": fade en vez de escala
  areaMinima: 44, // px, alto y ancho mínimos de cualquier cosa tocable
  retardo: 80, // ms antes de achicar: si en ese tiempo arranca un scroll, no se achica
  pulso: 120, // ms que se muestra achicado un toque más corto que el retardo
} as const;

// navigator.vibrate: Android sí; iOS no tiene Vibration API (no vibra, no falla).
export const VIBRACION = { reservar: 12, cancelar: 12, finalizar: 15 } as const; // ms

export const HOJA = {
  umbralCierre: 0.3, // fracción del alto de la hoja arrastrada hacia abajo para cerrarla
  velocidadCierre: 0.5, // px/ms hacia abajo: un "flick" cierra aunque no llegue al umbral
} as const;

export const REFRESCO = { umbral: 64 } as const; // px tirados para refrescar

export const ESQUELETO = { pulso: 1200, opacidadMinima: 0.45 } as const;

export const VIDRIO = { desenfoque: 18, saturacion: 1.4, fondo: 'rgba(13, 13, 14, 0.72)' } as const;
