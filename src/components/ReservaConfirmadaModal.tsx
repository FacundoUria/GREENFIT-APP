import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Tocable from './Tocable';
import HojaInferior from './HojaInferior';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import Confetti from './Confetti';
import { addToCalendar, shareReserva, ShareResult } from '../lib/calendarShare';
import { capitalize } from '../lib/dateFormat';

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

// Pantalla gamificada de "reserva confirmada": mascota + confetti + resumen
// de la clase + acciones de agendar/compartir. Se dispara SOLO tras un
// book_class exitoso -- no reemplaza ni toca el flujo de reserva existente.
export default function ReservaConfirmadaModal({ visible, reserva, onClose }: ReservaConfirmadaModalProps) {
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setShareFeedback(null);
  }, [visible]);

  // Mientras la hoja se cierra (200 ms) se sigue mostrando la última reserva.
  const ultima = useRef(reserva);
  if (reserva) ultima.current = reserva;
  const datos = reserva ?? ultima.current;
  if (!datos) return null;

  const fecha = capitalize(
    new Date(datos.startAt).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })
  );
  const horaInicio = new Date(datos.startAt).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const horaFin = datos.endAt
    ? new Date(datos.endAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  async function handleAddToCalendar() {
    await addToCalendar({
      disciplina: datos.disciplina,
      startAt: datos.startAt,
      endAt: datos.endAt,
      location: datos.location,
    });
  }

  async function handleShare() {
    const result = await shareReserva({
      disciplina: datos.disciplina,
      startAt: datos.startAt,
      location: datos.location,
    });
    setShareFeedback(SHARE_FEEDBACK[result]);
  }

  return (
    <HojaInferior visible={visible && !!reserva} onClose={onClose}>
      <View style={styles.contenido}>
        <Confetti active={visible} />

        <Image source={require('../../assets/perro.png')} style={styles.mascot} resizeMode="contain" />

        <Text style={styles.title}>¡Reserva confirmada!</Text>
        <Text style={styles.subtitle}>¡Nos vemos en el box! 💪</Text>

        <View style={styles.summary}>
          <SummaryRow icon="barbell-outline" label={datos.disciplina} />
          <SummaryRow icon="calendar-outline" label={fecha} />
          <SummaryRow icon="time-outline" label={horaFin ? `${horaInicio} - ${horaFin} hs` : `${horaInicio} hs`} />
          {!!datos.instructor && <SummaryRow icon="person-outline" label={`Prof. ${datos.instructor}`} />}
          {!!datos.location && <SummaryRow icon="location-outline" label={datos.location} />}
        </View>

        <View style={styles.actionsRow}>
          <Tocable style={styles.secondaryButton} onPress={handleAddToCalendar}>
            <Ionicons name="calendar" size={16} color={colors.textPrimary} />
            <Text style={styles.secondaryButtonText}>Agendar</Text>
          </Tocable>
          <Tocable style={styles.secondaryButton} onPress={handleShare}>
            <Ionicons name="share-social" size={16} color={colors.textPrimary} />
            <Text style={styles.secondaryButtonText}>Compartir</Text>
          </Tocable>
        </View>

        {!!shareFeedback && <Text style={styles.feedback}>{shareFeedback}</Text>}

        <Tocable style={styles.primaryButton} onPress={onClose}>
          <Text style={styles.primaryButtonText}>Listo</Text>
        </Tocable>
      </View>
      {/* Fuera del contenido (que recorta el confeti): se ubica contra la hoja. */}
      <Tocable style={styles.closeButton} onPress={onClose} accessibilityLabel="Cerrar">
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </Tocable>
    </HojaInferior>
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
  // Centrado, y recorta el confeti (que cae desde arriba del contenido).
  contenido: { alignItems: 'center', overflow: 'hidden', paddingTop: 4 },
  // 44 x 44, arriba a la derecha de la hoja (a la altura de la manija).
  closeButton: {
    position: 'absolute',
    top: 4,
    right: 8,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
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
