import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';

interface CancelBookingModalProps {
  visible: boolean;
  className: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

// Modal reutilizado por Home (banner "próxima clase") y Reservas: pide un
// motivo opcional antes de confirmar la cancelación.
export default function CancelBookingModal({
  visible,
  className,
  isSubmitting,
  onClose,
  onConfirm,
}: CancelBookingModalProps) {
  const [reason, setReason] = useState('');

  function handleConfirm() {
    onConfirm(reason.trim());
    setReason('');
  }

  function handleClose() {
    setReason('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Cancelar {className}</Text>
          <Text style={styles.subtitle}>Contanos por qué (opcional) — ayuda al gimnasio a organizarse.</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: estoy enfermo"
            placeholderTextColor={colors.textSecondary}
            value={reason}
            onChangeText={setReason}
            multiline
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleClose} disabled={isSubmitting}>
              <Text style={styles.secondaryButtonText}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dangerButton} onPress={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.dangerButtonText}>Confirmar cancelación</Text>
              )}
            </TouchableOpacity>
          </View>
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
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginBottom: 14, lineHeight: 18 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 12,
    color: colors.textPrimary,
    minHeight: 70,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '600' },
  dangerButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.danger,
  },
  dangerButtonText: { color: colors.white, fontWeight: '700' },
});
