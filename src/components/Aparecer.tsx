import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { APARICION, CURVA_CSS, DURACION, retrasoCascada } from '../theme/motion';
import { useReducirMovimiento } from '../hooks/useReducirMovimiento';

// Aparición de la tanda visual (el Reveal de la referencia): cuando el
// elemento entra en pantalla, sube 24 px y aparece en 600 ms con la curva de
// la app. Una sola vez: después queda quieto aunque se vuelva a desplazar.
// Con "reducir movimiento", solo fundido.
//
// La cascada sale de la posición, no de un índice: los elementos que entran
// juntos (el mismo aviso del IntersectionObserver) se ordenan de arriba abajo
// y de izquierda a derecha, y cada uno espera 60 ms más que el anterior (tope:
// el 7.º). Así cascadean igual la primera pantalla y lo que aparece al
// deslizar, sin que el 9.º de una lista espere medio segundo.
//
// En web es una animación CSS (keyframes de react-native-web): la corre el
// compositor del navegador, sin JS por cuadro, y solo toca transform y
// opacity. Termina sin dejar ningún transform puesto (fill-mode "backwards"),
// así no crea capas ni contextos de apilamiento de más. En nativo no anima.
//
// Va envolviendo al elemento (un View más): si el hijo dependía de `flex` o
// de su ancho respecto del padre, ese estilo se le pasa también a Aparecer.

const ES_WEB = Platform.OS === 'web';

type Aviso = (retraso: number) => void;

// Retraso de cada caja (en el mismo orden en que vienen), según su posición.
export function retrasosPorPosicion(cajas: ReadonlyArray<{ top: number; left: number }>): number[] {
  const orden = cajas
    .map((caja, i) => ({ top: Math.round(caja.top), left: Math.round(caja.left), i }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const retrasos = new Array<number>(cajas.length);
  orden.forEach((caja, k) => {
    retrasos[caja.i] = retrasoCascada(k);
  });
  return retrasos;
}

// Un solo IntersectionObserver para toda la app (no uno por elemento).
const esperando = new Map<Element, Aviso>();
let observador: IntersectionObserver | null = null;

function alEntrar(entradas: IntersectionObserverEntry[]) {
  const visibles = entradas.filter((e) => e.isIntersecting && esperando.has(e.target));
  const retrasos = retrasosPorPosicion(visibles.map((e) => e.boundingClientRect));
  visibles.forEach((e, i) => {
    const aviso = esperando.get(e.target)!;
    esperando.delete(e.target);
    observador?.unobserve(e.target);
    aviso(retrasos[i]);
  });
}

function observarEntrada(nodo: Element, aviso: Aviso): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    aviso(0);
    return () => {};
  }
  if (!observador) observador = new IntersectionObserver(alEntrar);
  esperando.set(nodo, aviso);
  observador.observe(nodo);
  return () => {
    esperando.delete(nodo);
    observador?.unobserve(nodo);
  };
}

type AparecerProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function Aparecer({ children, style, testID }: AparecerProps) {
  const reducir = useReducirMovimiento();
  const ref = useRef<View>(null);
  // null: todavía no entró en pantalla (invisible, esperando).
  const [retraso, setRetraso] = useState<number | null>(null);

  useEffect(() => {
    if (!ES_WEB) return undefined;
    const nodo = ref.current as unknown as Element | null;
    if (!nodo || typeof nodo.getBoundingClientRect !== 'function') {
      setRetraso(0);
      return undefined;
    }
    return observarEntrada(nodo, setRetraso);
  }, []);

  if (!ES_WEB) {
    return (
      <View style={style} testID={testID}>
        {children}
      </View>
    );
  }

  const animacion =
    retraso === null
      ? ESTILOS.esperando
      : [reducir ? ESTILOS.fundido : ESTILOS.subida, retraso > 0 ? { animationDelay: `${retraso}ms` } : null];

  return (
    <View ref={ref} style={[style, animacion as StyleProp<ViewStyle>]} testID={testID}>
      {children}
    </View>
  );
}

const ANIMACION_BASE = {
  animationDuration: `${DURACION.aparicion}ms`,
  animationTimingFunction: CURVA_CSS,
  animationFillMode: 'backwards',
};

// Solo web: las claves de animación son de react-native-web.
const ESTILOS: Record<'esperando' | 'subida' | 'fundido', any> = ES_WEB
  ? StyleSheet.create({
      esperando: { opacity: 0 },
      subida: {
        ...ANIMACION_BASE,
        animationKeyframes: [
          {
            from: { opacity: 0, transform: `translateY(${APARICION.desplazamiento}px)` },
            to: { opacity: 1, transform: 'translateY(0px)' },
          },
        ],
      },
      fundido: {
        ...ANIMACION_BASE,
        animationKeyframes: [{ from: { opacity: 0 }, to: { opacity: 1 } }],
      },
    } as any)
  : { esperando: null, subida: null, fundido: null };
