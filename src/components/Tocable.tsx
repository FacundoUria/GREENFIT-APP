import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, Platform, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import { CURVA_CSS, DURACION, TOQUE } from '../theme/motion';
import { useReducirMovimiento } from '../hooks/useReducirMovimiento';

// Reemplazo de TouchableOpacity con el toque de la tanda visual: al apoyar el
// dedo se achica a 0.96 (200 ms, curva de la app) en vez de parpadear con
// opacidad. Con "reducir movimiento", fade en vez de escala.
//
// Como en las apps nativas, el achique NO arranca apenas se apoya el dedo:
// espera TOQUE.retardo, y si en ese tiempo (o después) empieza un scroll, se
// cancela. Un toque más corto que el retardo igual se ve: un pulso breve, pero
// recién en onPress (un toque completado). onPressOut también llega cuando el
// scroll le roba el dedo al botón, y ahí no tiene que pulsar: si pulsara, la
// tarjeta bajo el dedo "respira" al empezar cada scroll (medido: ~17 de 65
// cuadros achicados, e2e/rendimiento.spec.ts).
//
// En web la escala va por transición CSS (la anima el compositor, sin JS por
// cuadro) y mantener apretado no selecciona el texto del botón. `hitSlop` en
// web NO agranda nada (react-native-web lo ignora): un tocable tiene que medir
// 44 px o más por sí mismo (TOQUE.areaMinima).

export type TocableProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

const ES_WEB = Platform.OS === 'web';

const TRANSICION_WEB: ViewStyle | null = ES_WEB
  ? ({
      transitionProperty: 'transform, opacity',
      transitionDuration: `${DURACION.toque}ms`,
      transitionTimingFunction: CURVA_CSS,
      userSelect: 'none',
    } as unknown as ViewStyle)
  : null;

const APRETADO: ViewStyle = { transform: [{ scale: TOQUE.escala }] };
const APRETADO_REDUCIDO: ViewStyle = { opacity: TOQUE.opacidadReducida };

export default function Tocable({ style, disabled, children, onPress, onPressIn, onPressOut, ...rest }: TocableProps) {
  const reducir = useReducirMovimiento();
  const [apretado, setApretado] = useState(false);
  const retardo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alScrollear = useRef<(() => void) | null>(null);
  // El dedo se levantó antes del retardo (todavía no se vio el achique).
  const soltoRapido = useRef(false);

  const limpiar = useCallback(() => {
    if (retardo.current) clearTimeout(retardo.current);
    retardo.current = null;
    if (alScrollear.current && ES_WEB) {
      document.removeEventListener('scroll', alScrollear.current, true);
    }
    alScrollear.current = null;
  }, []);

  useEffect(
    () => () => {
      limpiar();
      if (pulso.current) clearTimeout(pulso.current);
    },
    [limpiar]
  );

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      onPressIn?.(e);
      limpiar();
      soltoRapido.current = false;
      if (pulso.current) clearTimeout(pulso.current);
      retardo.current = setTimeout(() => {
        retardo.current = null;
        setApretado(true);
      }, TOQUE.retardo);
      if (ES_WEB) {
        // Un scroll (de cualquier contenedor) cancela el achique: "scroll" no
        // burbujea, por eso se escucha en captura sobre el documento.
        const cancelar = () => {
          limpiar();
          setApretado(false);
        };
        alScrollear.current = cancelar;
        document.addEventListener('scroll', cancelar, { capture: true, passive: true });
      }
    },
    [onPressIn, limpiar]
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      onPressOut?.(e);
      soltoRapido.current = retardo.current !== null;
      limpiar();
      setApretado(false);
    },
    [onPressOut, limpiar]
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (soltoRapido.current) {
        // Toque completado más corto que el retardo: pulso breve para que se note.
        soltoRapido.current = false;
        setApretado(true);
        pulso.current = setTimeout(() => setApretado(false), TOQUE.pulso);
      }
      onPress?.(e);
    },
    [onPress]
  );

  return (
    <Pressable
      disabled={disabled}
      {...rest}
      onPress={onPress ? handlePress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, TRANSICION_WEB, apretado && !disabled ? (reducir ? APRETADO_REDUCIDO : APRETADO) : null]}
    >
      {children}
    </Pressable>
  );
}
