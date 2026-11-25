import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Tocable from './Tocable';
import HojaInferior from './HojaInferior';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { XP_POR_NIVEL } from '../lib/xpApi';

// Modal "¿Cómo ganar XP?" -- extraído de PerfilMobileView (vivía inline
// ahí) para que HomeScreen pueda abrir exactamente el mismo modal desde el
// nuevo widget "Progreso Diario & Check-In". Publicar en la Comunidad,
// superar un PR y completar una Meta siguen sin otorgar XP (ver
// backend/supabase_migration_xp_solo_asistencia.sql) -- "Reservar una
// clase" es una excepción puntual aprobada por Seba, con su propio
// clawback si se cancela (ver supabase_migration_xp_reserva.sql), y "Hoy
// Entrené" es la reincorporación puntual del autoreporte, con un tope
// diario real (ver supabase_migration_hoy_entrene.sql), no autoreporte
// libre como antes. TODA acción de esta lista da SIEMPRE 100 XP, sin
// excepción.
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
  {
    emoji: '💪',
    label: 'Botón "Hoy Entrené"',
    detalle: '+100 XP -- Hasta 1 vez por cada disciplina activa que tengas, por día.',
  },
];

interface XpInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function XpInfoModal({ visible, onClose }: XpInfoModalProps) {
  return (
    <HojaInferior visible={visible} onClose={onClose}>
      <View>
        <View style={styles.headerRow}>
          <Text style={styles.title}>¿Cómo ganar XP?</Text>
          <Tocable onPress={onClose} style={styles.cerrar} accessibilityLabel="Cerrar">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Tocable>
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
    </HojaInferior>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // 44 x 44 (área mínima de toque) sin mover la X: el margen negativo compensa.
  cerrar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', margin: -11 },
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
