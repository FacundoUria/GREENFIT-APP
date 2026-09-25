import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/colors';

// Anillo de nivel de Inicio -- react-native-svg YA es dependencia del
// proyecto (la usa ProgresoMobileView para su gráfico de evolución y
// CredentialScreen para el QR). Un Circle de fondo (riel) + un Circle
// encima con strokeDasharray = circunferencia completa y strokeDashoffset
// según el % REAL de progreso dentro del nivel (xpEnNivel / xpParaNivel):
// "recorta" visualmente el trazo.
//
// El centro muestra SOLO el número de nivel -- los puntos de XP ("150/500")
// ya no se escriben como texto acá (viven en Mi Perfil); el progreso se lee
// en el arco, y queda expuesto a lectores de pantalla vía accessibilityValue.
//
// El resplandor es un par de trazos más anchos y transparentes detrás del
// arco (en vez de un filtro feGaussianBlur, que no rinde igual en nativo).

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
  size = 200,
  strokeWidth = 7,
}: XpProgressRingProps) {
  // Margen para que el resplandor (más ancho que el arco) no se recorte.
  const radius = (size - strokeWidth * 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const progreso = xpParaNivel > 0 ? Math.min(1, Math.max(0, xpEnNivel / xpParaNivel)) : 0;
  const dashoffset = circumference * (1 - progreso);
  const center = size / 2;

  const arco = {
    cx: center,
    cy: center,
    r: radius,
    fill: 'none' as const,
    stroke: colors.primary,
    strokeDasharray: `${circumference} ${circumference}`,
    strokeDashoffset: dashoffset,
    strokeLinecap: 'round' as const,
    // Arranca desde arriba (12 en punto) en vez del 3 en punto por defecto
    // de un círculo SVG -- rotación en vez de tocar cx/cy para no perder el
    // centrado del texto de encima.
    rotation: -90,
    origin: `${center}, ${center}`,
  };

  return (
    <View
      style={{ width: size, height: size }}
      testID="nivel-ring"
      accessibilityRole="progressbar"
      accessibilityLabel={`Nivel ${nivel}`}
      accessibilityValue={{ min: 0, max: xpParaNivel, now: Math.min(xpParaNivel, Math.max(0, xpEnNivel)) }}
    >
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius} stroke={colors.surfaceAlt} strokeWidth={strokeWidth} fill="none" />
        <Circle {...arco} strokeWidth={strokeWidth * 3.4} strokeOpacity={0.07} />
        <Circle {...arco} strokeWidth={strokeWidth * 2.2} strokeOpacity={0.14} />
        <Circle {...arco} strokeWidth={strokeWidth} testID="nivel-ring-arco" />
      </Svg>
      <View style={styles.centerContent} pointerEvents="none">
        <View style={styles.capsula}>
          <Text style={styles.capsulaTexto}>NIVEL</Text>
        </View>
        <Text style={[styles.nivelNumero, { fontSize: size * 0.3, lineHeight: size * 0.32 }]} testID="nivel-numero">
          {nivel}
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
  capsula: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: `${colors.primary}4D`,
    backgroundColor: `${colors.primary}0D`,
    marginBottom: 4,
  },
  capsulaTexto: { color: colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 3, paddingLeft: 3 },
  nivelNumero: { color: colors.textPrimary, fontWeight: '500' },
});
