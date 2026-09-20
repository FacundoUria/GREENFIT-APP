import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';

interface CancelBookingModalProps {
  visible: boolean;
  className: string;
  isSubmitting?: boolean;
  // true si cancelar AHORA sería dentro de la ventana de
  // configuracion.limite_cancelacion_minutos previa a la clase — calculado
  // en el cliente solo para avisar/deshabilitar antes de confirmar; la
  // regla real la aplica cancel_booking() en el servidor (rechaza con una
  // excepción si igual se intenta). Antes esto solo significaba "no se
  // reintegra el crédito" (la cancelación se dejaba pasar igual) -- ahora
  // el servidor la bloquea del todo, así que acá también se deshabilita
  // "Confirmar cancelación" en vez de dejar tocar un botón condenado a
  // fallar.
  withinCancelLimit?: boolean;
  // Mismo valor que usó withinCancelLimit para su cálculo, solo para mostrarlo en el aviso.
  limiteMinutos?: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

// "3 horas"/"90 minutos"/"1 hora 30 minutos" -- mostramos horas cuando el
// valor cae justo en una cantidad entera de horas (el caso más común, ej.
// 180 min) para que el aviso siga leyéndose natural en vez de "180 minutos".
// Exportada -- AgendaMobileView.tsx/HomeScreen.tsx la reusan para el
// mensaje de RESULTADO tras cancelar (antes tenían "2 horas" fijo ahí, sin
// leer configuracion.limite_cancelacion_minutos como sí hace el aviso
// PREVIO de este modal, más abajo).
export function formatLimite(minutos: number): string {
  if (minutos <= 0) return '0 minutos';
  if (minutos % 60 === 0) {
    const horas = minutos / 60;
    return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  }
  if (minutos < 60) return `${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${horas} ${horas === 1 ? 'hora' : 'horas'} ${resto} min`;
}

// Modal reutilizado por Home (banner "próxima clase") y Reservas: pide un
// motivo opcional antes de confirmar la cancelación.
export default function CancelBookingModal({
  visible,
  className,
  isSubmitting,
  withinCancelLimit,
  limiteMinutos = 120,
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
          {withinCancelLimit && (
            <Text style={styles.warning}>
              Faltan menos de {formatLimite(limiteMinutos)} para que empiece la clase: no podés cancelarla.
            </Text>
          )}
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
            <TouchableOpacity
              testID="cancel-booking-confirm"
              style={[styles.dangerButton, withinCancelLimit && styles.dangerButtonDisabled]}
              onPress={handleConfirm}
              disabled={isSubmitting || withinCancelLimit}
            >
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
  warning: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -8,
    marginBottom: 14,
    fontWeight: '600',
  },
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
  dangerButtonDisabled: { opacity: 0.5 },
  dangerButtonText: { color: colors.white, fontWeight: '700' },
});
