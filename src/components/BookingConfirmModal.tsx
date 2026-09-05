import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { CONSENT_TEXT_SHORT } from '../lib/consentApi';

export interface BookingConfirmTarget {
  title: string;
  startLabel: string;
  endLabel: string | null;
  instructor: string | null;
  location: string | null;
}

interface BookingConfirmModalProps {
  visible: boolean;
  target: BookingConfirmTarget | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

// Antes, tocar la tarjeta de una clase reservaba directo (one-tap): un
// scroll con el dedo mal puesto anotaba a un socio por accidente. Esto se
// interpone entre el tap y el book_class real -- mismo patrón que
// CancelBookingModal, que ya exige un paso de confirmación explícito para
// cancelar.
export default function BookingConfirmModal({
  visible,
  target,
  isSubmitting,
  onClose,
  onConfirm,
}: BookingConfirmModalProps) {
  // Reafirmación corta de salud -- se pide SIEMPRE, en cada reserva, incluso
  // el mismo día que se aceptó la declaración completa por primera vez (ver
  // ConsentModal.tsx / consentApi.ts). Es solo fricción de UI antes de
  // confirmar: no se guarda en la base, así que no hay nada que precargar
  // acá -- arranca destildado en cada apertura.
  const [reafirmado, setReafirmado] = useState(false);

  useEffect(() => {
    if (visible) setReafirmado(false);
  }, [visible]);

  if (!target) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Reservar {target.title}</Text>
          <Text style={styles.subtitle}>
            {target.startLabel}
            {target.endLabel ? ` - ${target.endLabel}` : ''} hs
            {target.instructor ? ` · Prof. ${target.instructor}` : ''}
            {target.location ? ` · ${target.location}` : ''}
          </Text>
          <Text style={styles.question}>¿Confirmás tu lugar en esta clase?</Text>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setReafirmado((v) => !v)}
            disabled={isSubmitting}
          >
            <Ionicons
              name={reafirmado ? 'checkbox' : 'square-outline'}
              size={20}
              color={reafirmado ? colors.primary : colors.textSecondary}
            />
            <Text style={styles.checkboxLabel}>{CONSENT_TEXT_SHORT}</Text>
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onClose} disabled={isSubmitting}>
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, !reafirmado && styles.primaryButtonDisabled]}
              onPress={onConfirm}
              disabled={!reafirmado || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Confirmar</Text>
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
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  question: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: 14, marginBottom: 4 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  checkboxLabel: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '600' },
  primaryButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '700' },
});
