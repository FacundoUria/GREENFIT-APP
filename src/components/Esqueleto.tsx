import React from 'react';
import { DimensionValue, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { ESQUELETO } from '../theme/motion';
import { colors } from '../theme/colors';
import { useReducirMovimiento } from '../hooks/useReducirMovimiento';

// Esqueletos de la tanda visual: mientras carga, en vez de una ruedita, la
// forma de lo que va a aparecer (las mismas tarjetas, con bloques grises), así
// no salta nada cuando llegan los datos.
//
// El pulso es UNA animación CSS de opacidad para todo el esqueleto (no una por
// bloque): una sola capa que anima el compositor. Con "reducir movimiento",
// quieto. Para lectores de pantalla es una barra de progreso "Cargando", como
// la ruedita de antes.

const ES_WEB = Platform.OS === 'web';

type EsqueletoProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function Esqueleto({ children, style, testID }: EsqueletoProps) {
  const reducir = useReducirMovimiento();
  return (
    <View
      style={[style, !reducir ? ESTILOS.pulso : null]}
      accessibilityRole="progressbar"
      accessibilityLabel="Cargando"
      testID={testID}
    >
      {children}
    </View>
  );
}

// Un bloque gris (el "hueso" del esqueleto).
export function Hueso({
  ancho,
  alto,
  radio = 6,
  color = colors.surfaceAlt,
  style,
}: {
  ancho: DimensionValue;
  alto: number;
  radio?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ width: ancho, height: alto, borderRadius: radio, backgroundColor: color }, style]} />;
}

// Solo web: las claves de animación son de react-native-web.
const ESTILOS: { pulso: any } = ES_WEB
  ? StyleSheet.create({
      pulso: {
        animationKeyframes: [
          {
            '0%': { opacity: 1 },
            '50%': { opacity: ESQUELETO.opacidadMinima },
            '100%': { opacity: 1 },
          },
        ],
        animationDuration: `${ESQUELETO.pulso}ms`,
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
      },
    } as any)
  : { pulso: null };
