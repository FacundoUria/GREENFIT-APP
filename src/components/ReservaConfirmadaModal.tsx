import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import Confetti from './Confetti';
import { addToCalendar, shareReserva, ShareResult } from '../lib/calendarShare';

export interface ReservaConfirmada {
  disciplina: string;
  startAt: string; // ISO
  endAt: string | null;
  instructor: string | null;
  location: string | null;
}

interface ReservaConfirmadaModalProps {
  visible: boolean;
  reserva: ReservaConfirmada | null;
  onClose: () => void;
}

const SHARE_FEEDBACK: Record<ShareResult, string | null> = {
  shared: null,
  copied: 'Copiado al portapapeles -- pegalo donde quieras',
  cancelled: null,
  unavailable: 'No se pudo compartir en este dispositivo',
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Pantalla gamificada de "reserva confirmada": mascota + confetti + resumen
// de la clase + acciones de agendar/compartir. Se dispara SOLO tras un
// book_class exitoso -- no reemplaza ni toca el flujo de reserva existente.
export default function ReservaConfirmadaModal({ visible, reserva, onClose }: ReservaConfirmadaModalProps) {
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setShareFeedback(null);
  }, [visible]);

  if (!reserva) return null;

  const fecha = capitalize(
    new Date(reserva.startAt).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })
  );
  const horaInicio = new Date(reserva.startAt).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const horaFin = reserva.endAt
    ? new Date(reserva.endAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  async function handleAddToCalendar() {
    await addToCalendar({
      disciplina: reserva!.disciplina,
      startAt: reserva!.startAt,
      endAt: reserva!.endAt,
      location: reserva!.location,
    });
  }

  async function handleShare() {
    const result = await shareReserva({
      disciplina: reserva!.disciplina,
      startAt: reserva!.startAt,
      location: reserva!.location,
    });
    setShareFeedback(SHARE_FEEDBACK[result]);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Confetti active={visible} />

          <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          <Image source={require('../../assets/perro.png')} style={styles.mascot} resizeMode="contain" />

          <Text style={styles.title}>¡Reserva confirmada!</Text>
          <Text style={styles.subtitle}>¡Nos vemos en el box! 💪</Text>

          <View style={styles.summary}>
            <SummaryRow icon="barbell-outline" label={reserva.disciplina} />
            <SummaryRow icon="calendar-outline" label={fecha} />
            <SummaryRow icon="time-outline" label={horaFin ? `${horaInicio} - ${horaFin} hs` : `${horaInicio} hs`} />
            {!!reserva.instructor && <SummaryRow icon="person-outline" label={`Prof. ${reserva.instructor}`} />}
            {!!reserva.location && <SummaryRow icon="location-outline" label={reserva.location} />}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleAddToCalendar}>
              <Ionicons name="calendar" size={16} color={colors.textPrimary} />
              <Text style={styles.secondaryButtonText}>Agendar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleShare}>
              <Ionicons name="share-social" size={16} color={colors.textPrimary} />
              <Text style={styles.secondaryButtonText}>Compartir</Text>
            </TouchableOpacity>
          </View>

          {!!shareFeedback && <Text style={styles.feedback}>{shareFeedback}</Text>}

          <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Listo</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SummaryRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={styles.summaryText} numberOfLines={1}>
        {label}
      </Text>
    </View>
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
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  closeButton: { position: 'absolute', top: 14, right: 14, zIndex: 2 },
  mascot: { width: 96, height: 96, marginBottom: 10 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 13.5, marginTop: 4, marginBottom: 18, textAlign: 'center' },
  summary: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryText: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  actionsRow: { flexDirection: 'row', gap: 10, width: '100%' },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
  },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  feedback: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 10 },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
