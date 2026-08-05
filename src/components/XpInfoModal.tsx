import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { XP_POR_NIVEL } from '../lib/xpApi';

// Modal "¿Cómo ganar XP?" -- extraído de PerfilMobileView (vivía inline
// ahí) para que HomeScreen pueda abrir exactamente el mismo modal desde el
// nuevo widget "Progreso Diario & Check-In" sin duplicar las 4 reglas.
export const REGLAS_XP: { emoji: string; label: string; detalle: string }[] = [
  { emoji: '🏋️', label: 'Asistencia diaria / ¡Hoy entrené!', detalle: '+100 XP (máx. 1 al día)' },
  { emoji: '💬', label: 'Publicar en la Comunidad', detalle: '+25 XP (máx. 1 al día)' },
  { emoji: '🏆', label: 'Superar un Récord Personal (PR)', detalle: '+150 XP' },
  { emoji: '🎯', label: 'Completar una Meta Personal', detalle: '+300 XP (límite 7 días)' },
];

interface XpInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function XpInfoModal({ visible, onClose }: XpInfoModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>¿Cómo ganar XP?</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>Cada {XP_POR_NIVEL} XP subís de nivel.</Text>
          {REGLAS_XP.map((regla) => (
            <View key={regla.label} style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>{regla.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.ruleLabel}>{regla.label}</Text>
                <Text style={styles.ruleDetalle}>{regla.detalle}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 12.5, marginTop: 4, marginBottom: 16 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  ruleEmoji: { fontSize: 22 },
  ruleLabel: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  ruleDetalle: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 2 },
});
