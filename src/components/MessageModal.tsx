import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export interface MessageModalContent {
  title: string;
  message: string;
  tone?: 'success' | 'error' | 'info';
  // Acción opcional además de cerrar -- ej. "Completar mis datos" llevando
  // a otra pantalla. Sin esto (caso por defecto, sin cambios) el modal
  // sigue mostrando un único botón "Entendido" que solo cierra.
  actionLabel?: string;
  onAction?: () => void;
}

interface MessageModalProps {
  content: MessageModalContent | null;
  onClose: () => void;
}

const TONE_COLOR: Record<NonNullable<MessageModalContent['tone']>, string> = {
  success: colors.primary,
  error: colors.danger,
  info: colors.textPrimary,
};

// Texto del botón: oscuro solo sobre el verde neón (única variante clara),
// blanco en el resto -- mismo criterio que ya usan CancelBookingModal
// (dangerButtonText: colors.white) y el resto de los botones de color de la app.
const TONE_BUTTON_TEXT: Record<NonNullable<MessageModalContent['tone']>, string> = {
  success: colors.onPrimary,
  error: colors.white,
  info: colors.background,
};

// Reemplazo de Alert.alert(title, message) con un solo botón -- ver
// crossPlatformAlert.ts para el porqué (Alert.alert es un no-op en Web).
// A diferencia de showAlert() (que usa window.alert, funcional pero feo y
// bloqueante), esto es un Modal real de React Native -- mismo componente
// que ya renderiza bien en Web (ver CancelBookingModal/
// ReservaConfirmadaModal) y mantiene la estética del resto de la app.
export default function MessageModal({ content, onClose }: MessageModalProps) {
  if (!content) return null;
  const tone = content.tone ?? 'info';
  const color = TONE_COLOR[tone];
  const buttonTextColor = TONE_BUTTON_TEXT[tone];

  return (
    <Modal visible={!!content} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={[styles.title, { color }]}>{content.title}</Text>
          <Text style={styles.message}>{content.message}</Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: color }]}
            onPress={() => {
              // Cierra primero -- el modal no debe quedar visible detrás de
              // la pantalla a la que onAction navega.
              onClose();
              content.onAction?.();
            }}
          >
            <Text style={[styles.buttonText, { color: buttonTextColor }]}>{content.actionLabel ?? 'Entendido'}</Text>
          </TouchableOpacity>
          {!!content.onAction && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Cerrar</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  message: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 19, marginBottom: 18 },
  button: { borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  buttonText: { fontWeight: '700', fontSize: 14 },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13.5 },
});
