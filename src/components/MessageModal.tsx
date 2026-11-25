import React, { useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Tocable from './Tocable';
import HojaInferior from './HojaInferior';
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
  // Mientras la hoja se cierra (200 ms) se sigue mostrando el último mensaje.
  const ultimo = useRef(content);
  if (content) ultimo.current = content;
  const mensaje = content ?? ultimo.current;
  if (!mensaje) return null;
  const tone = mensaje.tone ?? 'info';
  const color = TONE_COLOR[tone];
  const buttonTextColor = TONE_BUTTON_TEXT[tone];

  return (
    <HojaInferior visible={!!content} onClose={onClose}>
      <View>
        <Text style={[styles.title, { color }]}>{mensaje.title}</Text>
        <Text style={styles.message}>{mensaje.message}</Text>
        <Tocable
          style={[styles.button, { backgroundColor: color }]}
          onPress={() => {
            // Cierra primero -- el modal no debe quedar visible detrás de
            // la pantalla a la que onAction navega.
            onClose();
            mensaje.onAction?.();
          }}
        >
          <Text style={[styles.buttonText, { color: buttonTextColor }]}>{mensaje.actionLabel ?? 'Entendido'}</Text>
        </Tocable>
        {!!mensaje.onAction && (
          <Tocable style={styles.secondaryButton} onPress={onClose}>
            <Text style={styles.secondaryButtonText}>Cerrar</Text>
          </Tocable>
        )}
      </View>
    </HojaInferior>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  message: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 19, marginBottom: 18 },
  button: { borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  buttonText: { fontWeight: '700', fontSize: 14 },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13.5 },
});
