import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, RefreshControlProps, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { CURVA_CSS, DURACION, REFRESCO } from '../theme/motion';
import { useReducirMovimiento } from '../hooks/useReducirMovimiento';

// Tirar para refrescar (tanda visual, parte 4).
//
// En nativo queda el RefreshControl de siempre. En web (la PWA)
// react-native-web no trae uno, así que este hook arma uno propio:
//   * se activa al tirar hacia abajo con el scroll arriba de todo;
//   * el indicador sigue al dedo SOLO con transform y opacity, escritos
//     directo en el DOM (nada de render de React por cuadro);
//   * pasados REFRESCO.umbral px, al soltar refresca: el indicador queda con
//     la ruedita hasta que termina; si no llega, vuelve a su lugar;
//   * overscroll-behavior-y: contain en el contenedor, para que Chrome de
//     Android no dispare también su recarga del navegador;
//   * con "reducir movimiento", no baja ni gira: aparece y se va con fundido.
// Se siguen eventos touch (no pointer): cuando el navegador toma el gesto
// como desplazamiento cancela los pointer, pero los touchmove siguen llegando.
//
// El estado del indicador (reposo / refrescando) vive en su propio
// componente, no en la pantalla: así sus cambios no vuelven a dibujar la
// pantalla entera (en Mi Rutina, con un Android de gama baja, eso solo daba
// una tarea larga al soltar).
//
// Uso:
//   const refresco = useTirarParaRefrescar({ refrescando, onRefrescar });
//   return refresco.envolver(
//     <ScrollView ref={refresco.refScroll} refreshControl={refresco.refreshControl}>…</ScrollView>
//   );

const ES_WEB = Platform.OS === 'web';
const TAMANO = 40; // px, diámetro del indicador
const ESCONDIDO = -(TAMANO + 8); // px: arriba del borde de la zona, fuera de la vista
const RECORRIDO_MAXIMO = REFRESCO.umbral + 24; // px que el indicador acompaña al dedo
const ARRASTRE_MINIMO = 10; // px: desde acá es un arrastre (no un toque)

type Opciones = {
  refrescando: boolean;
  onRefrescar: () => unknown;
  tintColor?: string;
};

export type TirarParaRefrescar = {
  // Solo nativo: el RefreshControl de siempre.
  refreshControl?: React.ReactElement<RefreshControlProps>;
  // Solo web: ref del ScrollView/FlatList (de ahí sale el nodo que scrollea).
  refScroll?: (componente: unknown) => void;
  // Envuelve el ScrollView/FlatList (en web, con el indicador encima).
  envolver: (hijo: React.ReactElement) => React.ReactElement;
};

// Lo que los listeners del gesto le piden al indicador.
type ControlIndicador = {
  enReposo: () => boolean;
  arrastrar: (tirado: number) => void;
  volver: () => void;
  disparar: () => void;
};

type Pintura = { desplazamiento: number; giro: number; opacidad: number; transicion: boolean };

type PropsIndicador = Required<Opciones>;

const IndicadorRefresco = forwardRef<ControlIndicador, PropsIndicador>(function IndicadorRefresco(
  { refrescando, onRefrescar, tintColor },
  ref
) {
  const reducir = useReducirMovimiento();
  const [fase, setFase] = useState<'reposo' | 'refrescando'>('reposo');
  const [promesaLista, setPromesaLista] = useState(true);
  const [minimoListo, setMinimoListo] = useState(true);

  // Lo que leen los listeners del DOM (se registran una sola vez).
  const faseRef = useRef(fase);
  faseRef.current = fase;
  const reducirRef = useRef(reducir);
  reducirRef.current = reducir;
  const onRefrescarRef = useRef(onRefrescar);
  onRefrescarRef.current = onRefrescar;

  const nodoRef = useRef<View>(null);
  const timerMinimo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pintar = useCallback((p: Pintura) => {
    const nodo = nodoRef.current as unknown as HTMLElement | null;
    if (!nodo || !nodo.style) return;
    nodo.style.transition = p.transicion
      ? `transform ${DURACION.toque}ms ${CURVA_CSS}, opacity ${DURACION.toque}ms ${CURVA_CSS}`
      : 'none';
    nodo.style.transform = `translateY(${p.desplazamiento}px) rotate(${p.giro}deg)`;
    nodo.style.opacity = String(p.opacidad);
  }, []);

  // Con "reducir movimiento" el indicador no se mueve: siempre en su lugar de refresco.
  const arrastrar = useCallback(
    (tirado: number) => {
      const progreso = Math.min(tirado / REFRESCO.umbral, 1);
      pintar(
        reducirRef.current
          ? { desplazamiento: REFRESCO.umbral, giro: 0, opacidad: progreso, transicion: false }
          : { desplazamiento: Math.min(tirado, RECORRIDO_MAXIMO), giro: progreso * 180, opacidad: progreso, transicion: false }
      );
    },
    [pintar]
  );

  const volver = useCallback(() => {
    pintar({ desplazamiento: reducirRef.current ? REFRESCO.umbral : 0, giro: 0, opacidad: 0, transicion: true });
  }, [pintar]);

  const disparar = useCallback(() => {
    faseRef.current = 'refrescando';
    setFase('refrescando');
    setPromesaLista(false);
    setMinimoListo(false);
    pintar({ desplazamiento: REFRESCO.umbral, giro: 0, opacidad: 1, transicion: true });
    // La ruedita se ve al menos lo que dura una aparición, aunque la carga sea instantánea.
    timerMinimo.current = setTimeout(() => setMinimoListo(true), DURACION.aparicion);
    Promise.resolve()
      .then(() => onRefrescarRef.current())
      .catch(() => {})
      .finally(() => setPromesaLista(true));
  }, [pintar]);

  useImperativeHandle(
    ref,
    () => ({ enReposo: () => faseRef.current === 'reposo', arrastrar, volver, disparar }),
    [arrastrar, volver, disparar]
  );

  // Termina cuando terminó la recarga, pasó el mínimo y la pantalla ya no está cargando.
  useEffect(() => {
    if (fase === 'refrescando' && promesaLista && minimoListo && !refrescando) {
      faseRef.current = 'reposo';
      setFase('reposo');
      volver();
    }
  }, [fase, promesaLista, minimoListo, refrescando, volver]);

  useEffect(
    () => () => {
      if (timerMinimo.current) clearTimeout(timerMinimo.current);
    },
    []
  );

  return (
    <View ref={nodoRef} style={estilos.indicador} pointerEvents="none" aria-hidden testID="refresco-indicador">
      {fase === 'refrescando' ? (
        <ActivityIndicator size="small" color={tintColor} />
      ) : (
        <Ionicons name="arrow-down" size={20} color={tintColor} />
      )}
    </View>
  );
});

function nodoScrolleable(componente: unknown): HTMLElement | null {
  if (!componente) return null;
  const conMetodo = componente as { getScrollableNode?: () => unknown };
  const nodo = typeof conMetodo.getScrollableNode === 'function' ? conMetodo.getScrollableNode() : componente;
  return typeof HTMLElement !== 'undefined' && nodo instanceof HTMLElement ? nodo : null;
}

// Escucha el gesto sobre el nodo que scrollea y le habla al indicador.
function escuchar(nodo: HTMLElement, control: React.RefObject<ControlIndicador | null>): () => void {
  let siguiendo = false;
  let inicioY = 0;
  let tirado = 0;
  let arrastrando = false;

  // Después de tirar, si el navegador igual manda un click al botón que
  // quedó bajo el dedo, se descarta (mismo criterio que HojaInferior).
  const tragarClick = () => {
    const tragar = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', tragar, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', tragar, { capture: true }), 400);
  };

  const alEmpezar = (e: TouchEvent) => {
    siguiendo = !!control.current?.enReposo() && e.touches.length === 1 && nodo.scrollTop <= 0;
    if (!siguiendo) return;
    inicioY = e.touches[0].clientY;
    tirado = 0;
    arrastrando = false;
  };

  const alMover = (e: TouchEvent) => {
    if (!siguiendo) return;
    if (nodo.scrollTop > 0) {
      // Empezó a scrollear el contenido: ya no es tirar para refrescar.
      siguiendo = false;
      if (tirado > 0) control.current?.volver();
      return;
    }
    tirado = Math.max(0, e.touches[0].clientY - inicioY);
    if (!arrastrando && tirado > ARRASTRE_MINIMO) {
      arrastrando = true;
      // Un "scroll" cancela el achique del botón bajo el dedo (ver Tocable).
      nodo.dispatchEvent(new Event('scroll'));
    }
    control.current?.arrastrar(tirado);
  };

  const alSoltar = () => {
    if (!siguiendo) return;
    siguiendo = false;
    if (arrastrando) tragarClick();
    if (tirado >= REFRESCO.umbral) control.current?.disparar();
    else if (tirado > 0) control.current?.volver();
    tirado = 0;
  };

  nodo.style.overscrollBehaviorY = 'contain';
  nodo.addEventListener('touchstart', alEmpezar, { passive: true });
  nodo.addEventListener('touchmove', alMover, { passive: true });
  nodo.addEventListener('touchend', alSoltar, { passive: true });
  nodo.addEventListener('touchcancel', alSoltar, { passive: true });
  return () => {
    nodo.removeEventListener('touchstart', alEmpezar);
    nodo.removeEventListener('touchmove', alMover);
    nodo.removeEventListener('touchend', alSoltar);
    nodo.removeEventListener('touchcancel', alSoltar);
  };
}

export function useTirarParaRefrescar({ refrescando, onRefrescar, tintColor = colors.primary }: Opciones): TirarParaRefrescar {
  const control = useRef<ControlIndicador>(null);
  const desconectar = useRef<(() => void) | null>(null);

  useEffect(() => () => desconectar.current?.(), []);

  const refScroll = useCallback((componente: unknown) => {
    desconectar.current?.();
    desconectar.current = null;
    const nodo = nodoScrolleable(componente);
    if (nodo) desconectar.current = escuchar(nodo, control);
  }, []);

  if (!ES_WEB) {
    return {
      refreshControl: (
        <RefreshControl refreshing={refrescando} onRefresh={() => void onRefrescar()} tintColor={tintColor} />
      ),
      envolver: (hijo) => hijo,
    };
  }

  return {
    refScroll,
    envolver: (hijo) => (
      <View style={estilos.zona}>
        {hijo}
        <IndicadorRefresco ref={control} refrescando={refrescando} onRefrescar={onRefrescar} tintColor={tintColor} />
      </View>
    ),
  };
}

const estilos = StyleSheet.create({
  // Misma caja que el ScrollView/FlatList que envuelve; recorta el indicador
  // mientras está escondido arriba.
  zona: { flex: 1, position: 'relative', overflow: 'hidden' },
  indicador: {
    position: 'absolute',
    top: ESCONDIDO,
    alignSelf: 'center',
    width: TAMANO,
    height: TAMANO,
    borderRadius: TAMANO / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    zIndex: 10,
  },
});
