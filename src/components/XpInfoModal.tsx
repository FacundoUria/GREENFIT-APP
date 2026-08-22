import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { XP_POR_NIVEL } from '../lib/xpApi';

// Modal "¿Cómo ganar XP?" -- extraído de PerfilMobileView (vivía inline
// ahí) para que HomeScreen pueda abrir exactamente el mismo modal desde el
// nuevo widget "Progreso Diario & Check-In". Publicar en la Comunidad,
// superar un PR y completar una Meta siguen sin otorgar XP (ver
// backend/supabase_migration_xp_solo_asistencia.sql) -- "Reservar una
// clase" es una excepción puntual aprobada por Seba, con su propio
// clawback si se cancela (ver supabase_migration_xp_reserva.sql).
export const REGLAS_XP: { emoji: string; label: string; detalle: string }[] = [
  {
    emoji: '📅',
    label: 'Reservar una clase',
    detalle: '+100 XP -- Se descuentan si cancelás la reserva.',
  },
  {
    emoji: '🏋️',
    label: 'Asistencia diaria',
    detalle: '+100 XP -- Acreditados presencialmente al realizar tu check-in en el gimnasio.',
  },
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
