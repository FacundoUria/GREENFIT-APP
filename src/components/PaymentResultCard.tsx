import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { ResultadoPago } from '../lib/paymentResult';

// Tarjeta de "cómo terminó el checkout" -- compartida entre
// PaymentWebViewScreen.native.tsx (WebView real) y .web.tsx (redirección de
// página completa, sin WebView) para no duplicar el copy/estilos entre las
// dos implementaciones que Metro resuelve por plataforma.
const RESULTADO_META: Record<
  Exclude<ResultadoPago, null>,
  { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; message: string }
> = {
  approved: {
    icon: 'checkmark-circle',
    color: colors.primary,
    title: '¡Pago acreditado!',
    message: 'Tu compra se procesó con éxito. Ya podés ver tus créditos actualizados en tu Home.',
  },
  pending: {
    icon: 'time',
    color: colors.warning,
    title: 'Pago en revisión',
    message: 'Tu pago está en proceso de verificación. Apenas se acredite verás tus créditos sumados.',
  },
  failure: {
    icon: 'close-circle',
    color: colors.danger,
    title: 'No se pudo procesar el pago',
    message: 'El pago fue rechazado o cancelado. Podés intentarlo de nuevo cuando quieras.',
  },
};

interface PaymentResultCardProps {
  resultado: Exclude<ResultadoPago, null>;
  reintentando: boolean;
  onReintentar: () => void;
  onClose: () => void;
}

export default function PaymentResultCard({ resultado, reintentando, onReintentar, onClose }: PaymentResultCardProps) {
  const meta = RESULTADO_META[resultado];
  return (
    <View style={styles.resultContainer}>
      <Ionicons name={meta.icon} size={64} color={meta.color} />
      <Text style={styles.resultTitle}>{meta.title}</Text>
      <Text style={styles.resultMessage}>{meta.message}</Text>
      <View style={styles.resultActions}>
        {resultado === 'failure' && (
          <TouchableOpacity
            style={[styles.resultButton, styles.resultButtonPrimary]}
            onPress={onReintentar}
            disabled={reintentando}
          >
            {reintentando ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.resultButtonPrimaryText}>Reintentar</Text>
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.resultButton} onPress={onClose}>
          <Text style={styles.resultButtonText}>{resultado === 'failure' ? 'Cancelar' : 'Listo'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  resultContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  resultTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  resultMessage: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  resultActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  resultButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  resultButtonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  resultButtonText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  resultButtonPrimaryText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
});
