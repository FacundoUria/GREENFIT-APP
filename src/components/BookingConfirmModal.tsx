import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import Tocable from './Tocable';
import HojaInferior from './HojaInferior';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { CONSENT_TEXT_SHORT } from '../lib/consentApi';

export interface BookingConfirmTarget {
  title: string;
  // Fecha exacta de la ocurrencia que se va a reservar, ya formateada
  // ("Hoy, jueves 1 de octubre"). Sale de la TARJETA tocada, no del día
  // elegido en el selector: el socio confirma el día, no solo la hora.
  dateLabel: string;
  startLabel: string;
  endLabel: string | null;
  instructor: string | null;
  location: string | null;
  // Tanda EC -- aviso opcional bajo el horario (ej. "La clase ya empezó:
  // termina a las 20:00 hs."), para que reservar una clase en curso se entienda.
  aviso?: string | null;
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

  // Mientras la hoja se cierra (200 ms) se sigue mostrando la última clase,
  // aunque el padre ya haya limpiado `target`.
  const ultimo = useRef(target);
  if (target) ultimo.current = target;
  const clase = target ?? ultimo.current;
  if (!clase) return null;

  return (
    <HojaInferior visible={visible && !!target} onClose={onClose} cerrable={!isSubmitting}>
      <View>
        <Text style={styles.title}>Reservar {clase.title}</Text>
        <Text style={styles.fecha}>{clase.dateLabel}</Text>
        <Text style={styles.subtitle}>
          {clase.startLabel}
          {clase.endLabel ? ` - ${clase.endLabel}` : ''} hs
          {clase.instructor ? ` · Prof. ${clase.instructor}` : ''}
          {clase.location ? ` · ${clase.location}` : ''}
        </Text>
        {!!clase.aviso && <Text style={styles.aviso}>{clase.aviso}</Text>}
        <Text style={styles.question}>¿Confirmás tu lugar en esta clase?</Text>

        <Tocable
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
        </Tocable>

        <View style={styles.buttonRow}>
          <Tocable style={styles.secondaryButton} onPress={onClose} disabled={isSubmitting}>
            <Text style={styles.secondaryButtonText}>Cancelar</Text>
          </Tocable>
          <Tocable
            style={[styles.primaryButton, !reafirmado && styles.primaryButtonDisabled]}
            onPress={onConfirm}
            disabled={!reafirmado || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Confirmar</Text>
            )}
          </Tocable>
        </View>
      </View>
    </HojaInferior>
  );
}

// Precalentar la hoja (rendimiento de la Agenda en gama baja): la PRIMERA vez
// que el navegador maqueta este texto, con estas fuentes y tamaños, tarda
// ~40 ms en un Android de gama baja (medido en Moto G4 con CPU 4x: las
// siguientes veces, ~5 ms, porque lo guarda en caché). Eso caía justo al
// abrir la hoja y daba una tarea larga. La Agenda dibuja esto una sola vez,
// invisible, al montarse (un momento que ya es pesado y sin animaciones que
// cuidar), y lo saca a los dos cuadros. Mismos estilos que la hoja; sin
// datos de ninguna clase. Solo web: es un costo del navegador.
export function PrecalentarHojaReserva({ onListo }: { onListo: () => void }) {
  const onListoActual = useRef(onListo);
  onListoActual.current = onListo;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof requestAnimationFrame !== 'function') {
      onListoActual.current();
      return undefined;
    }
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => onListoActual.current());
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (Platform.OS !== 'web') return null;
  return (
    <View style={styles.precalentar} pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.title}>Reservar</Text>
      <Text style={styles.fecha}>Hoy, mañana</Text>
      <Text style={styles.subtitle}>00:00 - 00:00 hs · Prof.</Text>
      <Text style={styles.aviso}>La clase ya empezó: termina a las 00:00 hs.</Text>
      <Text style={styles.question}>¿Confirmás tu lugar en esta clase?</Text>
      <View style={styles.checkboxRow}>
        <Ionicons name="square-outline" size={20} color={colors.textSecondary} />
        <Ionicons name="checkbox" size={20} color={colors.primary} />
        <Text style={styles.checkboxLabel}>{CONSENT_TEXT_SHORT}</Text>
      </View>
      <Text style={styles.secondaryButtonText}>Cancelar</Text>
      <Text style={styles.primaryButtonText}>Confirmar</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  // La fecha va destacada (verde, negrita): es lo que el socio tiene que
  // poder chequear de un vistazo antes de confirmar.
  fecha: { color: colors.primary, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  aviso: { color: colors.primary, fontSize: 13, fontWeight: '600', lineHeight: 18, marginTop: 6 },
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
  // Invisible y sin recibir toques (ver PrecalentarHojaReserva).
  precalentar: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});
