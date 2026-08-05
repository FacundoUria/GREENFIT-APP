import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/colors';

// Anillo de progreso de XP hacia el próximo nivel -- react-native-svg YA es
// dependencia del proyecto (la usa ProgresoMobileView para su gráfico de
// evolución y CredentialScreen para el QR), sin sumar ninguna librería
// nueva. Técnica estándar: un Circle de fondo (track) + un Circle encima
// con strokeDasharray = circunferencia completa y strokeDashoffset movido
// según el % de progreso -- "recorta" visualmente el trazo.

interface XpProgressRingProps {
  xpEnNivel: number; // 0..xpParaNivel-1, progreso dentro del nivel actual
  xpParaNivel: number; // XP_POR_NIVEL
  nivel: number;
  size?: number;
  strokeWidth?: number;
}

export default function XpProgressRing({
  xpEnNivel,
  xpParaNivel,
  nivel,
  size = 96,
  strokeWidth = 9,
}: XpProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progreso = xpParaNivel > 0 ? Math.min(1, Math.max(0, xpEnNivel / xpParaNivel)) : 0;
  const dashoffset = circumference * (1 - progreso);
  const center = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius} stroke={colors.surfaceAlt} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.primary}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          // Arranca desde arriba (12 en punto) en vez del 3 en punto por
          // defecto de un círculo SVG -- rotación en vez de tocar cx/cy
          // para no perder el centrado del texto de encima.
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      </Svg>
      <View style={styles.centerContent} pointerEvents="none">
        <Text style={styles.nivelText}>N{nivel}</Text>
        <Text style={styles.xpText}>
          {xpEnNivel}/{xpParaNivel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nivelText: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  xpText: { color: colors.textSecondary, fontSize: 9.5, fontWeight: '700', marginTop: 1 },
});
