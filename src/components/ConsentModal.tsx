import React, { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { CONSENT_TEXT } from '../lib/consentApi';

interface ConsentModalProps {
  visible: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onAccept: () => void;
}

type Choice = 'acepto' | 'no_acepto' | null;

// Segundo gate de reserva, aparte del de contacto de emergencia
// (AgendaMobileView.tsx no lo toca -- este chequea consentimientos_socio y
// abre esto ANTES de BookingConfirmModal cuando al socio le falta la
// versión vigente de CONSENT_VERSION). Pantalla completa (no un modal chico
// como BookingConfirmModal/CancelBookingModal) porque el texto legal es
// largo y tiene que poder leerse entero con scroll real.
//
// Los dos checkboxes son mutuamente excluyentes (tocar uno destilda el
// otro) -- reflejan los "☐ Acepto / ☐ No acepto" del texto legal. Se
// resetean a ninguno seleccionado cada vez que el modal se abre, para que
// no quede "Acepto" pre-marcado de una apertura anterior.
export default function ConsentModal({ visible, isSubmitting, onClose, onAccept }: ConsentModalProps) {
  const [choice, setChoice] = useState<Choice>(null);

  // Arranca sin nada marcado cada vez que se abre -- sin importar cómo se
  // haya cerrado la vez anterior (Volver, o un onAccept exitoso que el
  // padre cierra sin pasar por handleClose).
  useEffect(() => {
    if (visible) setChoice(null);
  }, [visible]);

  function handleAccept() {
    if (choice !== 'acepto') return;
    onAccept();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.legalText}>{CONSENT_TEXT}</Text>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setChoice('acepto')}
            disabled={isSubmitting}
          >
            <Ionicons
              name={choice === 'acepto' ? 'checkbox' : 'square-outline'}
              size={22}
              color={choice === 'acepto' ? colors.primary : colors.textSecondary}
            />
            <Text style={styles.checkboxLabel}>
              Acepto la declaración de salud, el consentimiento informado y las condiciones de participación.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setChoice('no_acepto')}
            disabled={isSubmitting}
          >
            <Ionicons
              name={choice === 'no_acepto' ? 'checkbox' : 'square-outline'}
              size={22}
              color={choice === 'no_acepto' ? colors.danger : colors.textSecondary}
            />
            <Text style={styles.checkboxLabel}>No acepto.</Text>
          </TouchableOpacity>

          <Text style={styles.footerNote}>
            La aceptación de estas condiciones es necesaria para realizar reservas de clases.
          </Text>
        </ScrollView>

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={onClose} disabled={isSubmitting}>
            <Text style={styles.secondaryButtonText}>Volver</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, choice !== 'acepto' && styles.primaryButtonDisabled]}
            onPress={handleAccept}
            disabled={choice !== 'acepto' || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Continuar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },
  legalText: { color: colors.textPrimary, fontSize: 13.5, lineHeight: 20 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  checkboxLabel: { flex: 1, color: colors.textPrimary, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
  footerNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 18, fontStyle: 'italic' },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
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
