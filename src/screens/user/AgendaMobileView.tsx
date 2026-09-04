import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../../theme/colors';
import { getDisciplineStyle } from '../../theme/disciplineColors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { loadClassesForDate, formatDateOnly, ClassWithBookings as BaseClassWithBookings } from '../../lib/classesApi';
import { fetchClosedDays, ClosedDay } from '../../lib/closedDaysApi';
import { fetchUserBalances } from '../../lib/creditsApi';
import { formatClassTime, getCountdown } from '../../lib/classTime';
import { useTicker } from '../../hooks/useTicker';
import { withTimeout } from '../../lib/withTimeout';
import CancelBookingModal from '../../components/CancelBookingModal';
import DaySelector from '../../components/DaySelector';
import ReservaConfirmadaModal from '../../components/ReservaConfirmadaModal';
import BookingConfirmModal from '../../components/BookingConfirmModal';
import MessageModal, { MessageModalContent } from '../../components/MessageModal';

// Timeout de red para reservar/cancelar: el cliente de Supabase no tiene
// uno por defecto -- si la conexión se cuelga a mitad de la request (wifi
// del gimnasio), la promesa quedaba pendiente para siempre y el spinner de
// la tarjeta nunca se cerraba (bug real reportado: "se queda pensando y
// nunca concreta la inscripción"). Ver withTimeout.ts.
const RPC_TIMEOUT_MS = 20_000;
const RPC_TIMEOUT_MESSAGE = 'Esto está tardando demasiado. Revisá tu conexión e intentá de nuevo.';

type AgendaClass = BaseClassWithBookings & { isBooked: boolean };

// Vista nueva y paralela a BookingScreen (Módulo 2 del rediseño) -- no
// reemplaza ni engancha en la navegación real todavía. Reusa exactamente la
// misma lógica funcional (loadClassesForDate/DaySelector) y solo agrega la
// capa visual: código de color por disciplina, agrupado temporal (HOY /
// MAÑANA / PRÓXIMOS DÍAS) y badges de estado. book_class/cancel_booking se
// llaman igual que en Reservas -- al confirmar reutiliza el mismo
// ReservaConfirmadaModal del Módulo 1.
//
// `loadAgendaClasses`/`fetchCreditsByDiscipline` duplican a propósito la
// lógica privada de BookingScreen.tsx (misma query, mismo criterio) en vez
// de tocar ese archivo -- una vez que esta vista esté verificada y
// enganchada al tab real, es candidata a extraerse a un hook compartido
// (`useClassBooking`) para las dos pantallas.

async function loadAgendaClasses(userId: string, date: Date): Promise<AgendaClass[]> {
  const classes = await loadClassesForDate(date);
  if (classes.length === 0) return [];

  const { data: myBookings, error } = await supabase
    .from('bookings')
    .select('class_id')
    .eq('user_id', userId)
    .eq('booking_date', classes[0].occurrenceDate)
    .in('class_id', classes.map((c) => c.id));
  if (error) throw new Error(error.message);

  const bookedIds = new Set((myBookings ?? []).map((b) => b.class_id));
  return classes.map((c) => ({ ...c, isBooked: bookedIds.has(c.id) }));
}

async function fetchCreditsByDiscipline(userId: string): Promise<Map<string, number>> {
  const balances = await fetchUserBalances(userId);
  const map = new Map<string, number>();
  for (const b of balances) map.set(b.discipline.id, b.remainingCredits ?? 0);
  return map;
}

// Gate de reservas (aparte del gate de "perfil obligatorio" de
// ProfileStack.tsx, que bloquea la pestaña Perfil entera si faltan
// domicilio/teléfono/etc. -- ese no se toca, este es uno nuevo y más
// puntual): sin nombre Y teléfono de contacto de emergencia, no se puede
// reservar una clase. A propósito una consulta EN VIVO acá (no un campo
// cacheado en el user de AuthContext) -- si el socio recién completó el
// dato en "Mis datos" y vuelve a Agenda, tiene que verse desbloqueado sin
// necesidad de cerrar sesión y volver a entrar.
//
// Fail-open ante un error real de red/consulta -- a diferencia de otras
// columnas "nuevas" de este archivo (avatar_url, domicilio, etc.) estas dos
// ya existen hace tiempo (AuthContext.tsx/ProfileScreen.tsx ya las leen),
// así que un error acá es un problema de conexión puntual, no una
// migración pendiente -- no tiene sentido bloquear TODA la agenda por eso.
async function fetchTieneContactoEmergencia(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('emergency_contact_name, emergency_contact_phone')
    .eq('id', userId)
    .single();
  if (error || !data) {
    console.warn('[GreenFit] No se pudo verificar el contacto de emergencia:', error?.message);
    return true;
  }
  return !!data.emergency_contact_name?.trim() && !!data.emergency_contact_phone?.trim();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function AgendaMobileView({ navigation }: any) {
  useTicker();
  const { user } = useAuth();
  const { configuracion } = useConfiguracion();
  const cancelLimitMs = configuracion.limiteCancelacionMinutos * 60 * 1000;

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [classes, setClasses] = useState<AgendaClass[]>([]);
  const [creditsByDiscipline, setCreditsByDiscipline] = useState<Map<string, number>>(new Map());
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AgendaClass | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<AgendaClass | null>(null);
  // Paso de confirmación antes de reservar (evita el one-tap accidental) +
  // reemplazo de Alert.alert (no-op en Web, ver crossPlatformAlert.ts) para
  // los mensajes de error/resultado de reservar y cancelar.
  const [confirmTarget, setConfirmTarget] = useState<AgendaClass | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [messageModal, setMessageModal] = useState<MessageModalContent | null>(null);
  // Ver fetchTieneContactoEmergencia -- arranca en true (no bloquea) para
  // no trabar el primer render mientras se resuelve; en la práctica ya está
  // resuelto antes de que exista ninguna tarjeta para tocar (useFocusEffect
  // corre antes de que loadAgendaClasses termine de poblar `classes`).
  const [tieneContactoEmergencia, setTieneContactoEmergencia] = useState(true);

  const selectedDateStr = formatDateOnly(selectedDate);
  const closedToday = closedDays.find((d) => d.fecha === selectedDateStr) ?? null;

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [classList, credits] = await Promise.all([
        loadAgendaClasses(user.id, selectedDate),
        fetchCreditsByDiscipline(user.id),
      ]);
      setClasses(classList);
      setCreditsByDiscipline(credits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la agenda.');
    } finally {
      setIsLoading(false);
    }
  }, [user, selectedDate]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    fetchClosedDays()
      .then(setClosedDays)
      .catch((err) => console.error('No se pudieron cargar los días de cierre:', err));
  }, []);

  // useFocusEffect (no useEffect simple) -- mismo criterio que HomeScreen.tsx:
  // cubre el fetch inicial Y el refresco al volver de "Mis datos" (Perfil)
  // después de completar el contacto de emergencia, sin depender de que el
  // socio cierre sesión y vuelva a entrar.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      fetchTieneContactoEmergencia(user.id).then(setTieneContactoEmergencia);
    }, [user])
  );

  // "HOY" / "MAÑANA" / "PRÓXIMOS DÍAS" -- el selector deja elegir cualquier
  // día suelto, así que el agrupado temporal se resuelve como un encabezado
  // dinámico sobre el día elegido en vez de tres listas separadas.
  const dayHeading = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(selectedDate);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
    const eyebrow = diffDays === 0 ? 'HOY' : diffDays === 1 ? 'MAÑANA' : 'PRÓXIMOS DÍAS';
    const title = capitalize(
      selectedDate.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    );
    return { eyebrow, title };
  }, [selectedDate]);

  // Ya NO dispara la reserva -- solo valida y, si todo está en orden, abre
  // el modal de confirmación (BookingConfirmModal). El RPC real vive en
  // confirmBooking(), disparado recién cuando el socio toca "Confirmar".
  function handlePress(item: AgendaClass) {
    if (item.isBooked) {
      setCancelTarget(item);
      return;
    }
    if (closedToday) {
      setMessageModal({
        title: 'Gimnasio cerrado',
        message: `El gimnasio permanece cerrado este día${closedToday.motivo ? ` (${closedToday.motivo})` : ''}.`,
        tone: 'info',
      });
      return;
    }
    if (item.bookedCount >= item.capacity) {
      setMessageModal({ title: 'Sin cupo', message: 'Esta clase ya no tiene lugares disponibles.', tone: 'error' });
      return;
    }
    if ((creditsByDiscipline.get(item.disciplineId) ?? 0) <= 0) {
      setMessageModal({
        title: 'Sin créditos',
        message: `No te quedan créditos de ${item.title} para reservar.`,
        tone: 'error',
      });
      return;
    }
    // Gate nuevo, aparte del de "perfil obligatorio" (ProfileStack.tsx, que
    // bloquea la pestaña Perfil entera y no se toca acá): sin nombre Y
    // teléfono de contacto de emergencia, no se deja avanzar a la reserva.
    // Va DESPUÉS de cerrado/cupo/créditos a propósito -- no tiene sentido
    // mandar al socio a completar su perfil por una clase que igual no
    // podría reservar (sin cupo, sin créditos, gimnasio cerrado).
    if (!tieneContactoEmergencia) {
      setMessageModal({
        title: 'Completá tu contacto de emergencia',
        message: 'Para poder reservar una clase, necesitamos el nombre y el teléfono de alguien a quien contactar en caso de emergencia.',
        tone: 'error',
        actionLabel: 'Completar mis datos',
        onAction: () => navigation.navigate('Perfil', { screen: 'MyData' }),
      });
      return;
    }
    setConfirmTarget(item);
  }

  async function confirmBooking() {
    if (!confirmTarget) return;
    const item = confirmTarget;
    setPendingId(item.id);
    setIsBooking(true);
    try {
      const { error: rpcError } = await withTimeout(
        supabase.rpc('book_class', { p_class_id: item.id, p_booking_date: item.occurrenceDate }),
        RPC_TIMEOUT_MS,
        RPC_TIMEOUT_MESSAGE
      );
      if (rpcError) throw new Error(rpcError.message);
      setConfirmTarget(null);
      await load();
      setConfirmedBooking(item);
    } catch (err) {
      setConfirmTarget(null);
      setMessageModal({
        title: 'No se pudo reservar',
        message: err instanceof Error ? err.message : 'Intentá de nuevo.',
        tone: 'error',
      });
    } finally {
      setPendingId(null);
      setIsBooking(false);
    }
  }

  async function confirmCancel(reason: string) {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const { data: creditoReintegrado, error: rpcError } = await withTimeout(
        supabase.rpc('cancel_booking', {
          p_class_id: cancelTarget.id,
          p_booking_date: cancelTarget.occurrenceDate,
          p_reason: reason || null,
        }),
        RPC_TIMEOUT_MS,
        RPC_TIMEOUT_MESSAGE
      );
      if (rpcError) throw new Error(rpcError.message);
      setCancelTarget(null);
      await load();
      setMessageModal({
        title: 'Reserva cancelada',
        message: creditoReintegrado
          ? 'Te devolvimos el crédito.'
          : 'Como cancelaste con menos de 2 horas de anticipación, no se reintegra el crédito.',
        tone: creditoReintegrado ? 'success' : 'info',
      });
    } catch (err) {
      setMessageModal({
        title: 'No se pudo cancelar',
        message: err instanceof Error ? err.message : 'Intentá de nuevo.',
        tone: 'error',
      });
    } finally {
      setIsCancelling(false);
    }
  }

  function renderItem({ item }: { item: AgendaClass }) {
    const disciplineStyle = getDisciplineStyle(item.title);
    const remaining = item.capacity - item.bookedCount;
    const isFull = remaining <= 0 && !item.isBooked;
    const credits = creditsByDiscipline.get(item.disciplineId) ?? 0;
    const sinCreditos = !item.isBooked && !isFull && credits <= 0;
    const startLabel = formatClassTime(item.startAt);
    const endLabel = item.endAt ? formatClassTime(item.endAt) : null;
    const countdown = getCountdown(item.startAt);
    const isPending = pendingId === item.id;

    const badge = item.isBooked
      ? { label: 'Reservada', bg: colors.primary, fg: colors.onPrimary, icon: 'checkmark-circle' as const }
      : isFull
      ? { label: 'Sin cupo', bg: colors.surfaceAlt, fg: colors.danger, icon: 'close-circle' as const }
      : sinCreditos
      ? { label: 'Sin créditos', bg: colors.surfaceAlt, fg: colors.warning, icon: 'alert-circle' as const }
      : { label: 'Disponible', bg: 'rgba(0, 255, 56, 0.14)', fg: colors.primary, icon: 'ellipse-outline' as const };

    return (
      <TouchableOpacity
        testID={`agenda-card-${item.id}`}
        activeOpacity={0.85}
        style={[styles.card, { borderLeftColor: disciplineStyle.color }, item.isBooked && styles.cardBooked]}
        onPress={() => handlePress(item)}
        disabled={isPending}
      >
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: `${disciplineStyle.color}26`, borderColor: `${disciplineStyle.color}55` },
          ]}
        >
          <Ionicons name={disciplineStyle.icon} size={18} color={disciplineStyle.color} />
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <Text style={styles.className} numberOfLines={1}>
              {item.title}
            </Text>
            {isPending ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                <Ionicons name={badge.icon} size={12} color={badge.fg} />
                <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
              </View>
            )}
          </View>

          <Text style={styles.metaText}>
            {startLabel}
            {endLabel ? ` - ${endLabel}` : ''} hs
            {item.instructor ? ` · Prof. ${item.instructor}` : ''}
          </Text>

          <View style={styles.cardFooterRow}>
            {!!item.location && (
              <View style={styles.footerItem}>
                <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                <Text style={styles.footerText}>{item.location}</Text>
              </View>
            )}
            <Text style={styles.footerText}>
              {item.bookedCount}/{item.capacity} cupos
            </Text>
            {!countdown.isPast && (
              <Text style={[styles.footerText, countdown.isSoon && styles.countdownSoon]}>{countdown.label}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Mi Agenda</Text>
      </View>

      <View style={styles.daySelectorWrap}>
        <DaySelector selectedDate={selectedDate} onSelect={setSelectedDate} />
      </View>

      <View style={styles.dayHeadingWrap}>
        <Text style={styles.dayEyebrow}>{dayHeading.eyebrow}</Text>
        <Text style={styles.dayTitle}>{dayHeading.title}</Text>
      </View>

      {closedToday ? (
        <View style={styles.closedBanner}>
          <Ionicons name="lock-closed" size={20} color={colors.warning} />
          <Text style={styles.closedBannerText}>
            El gimnasio permanecerá cerrado este día{closedToday.motivo ? ` (${closedToday.motivo})` : ''}.
          </Text>
        </View>
      ) : (
        <>
          {isLoading && classes.length === 0 && (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!isLoading && !error && classes.length === 0 && (
            <Text style={styles.empty}>No hay clases programadas para este día.</Text>
          )}

          <FlatList
            data={classes}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
          />
        </>
      )}

      <CancelBookingModal
        visible={!!cancelTarget}
        className={cancelTarget?.title ?? ''}
        isSubmitting={isCancelling}
        withinCancelLimit={
          !!cancelTarget && new Date(cancelTarget.startAt).getTime() - Date.now() < cancelLimitMs
        }
        limiteMinutos={configuracion.limiteCancelacionMinutos}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />

      <ReservaConfirmadaModal
        visible={!!confirmedBooking}
        reserva={
          confirmedBooking && {
            disciplina: confirmedBooking.title,
            startAt: confirmedBooking.startAt,
            endAt: confirmedBooking.endAt,
            instructor: confirmedBooking.instructor,
            location: confirmedBooking.location,
          }
        }
        onClose={() => setConfirmedBooking(null)}
      />

      <BookingConfirmModal
        visible={!!confirmTarget}
        target={
          confirmTarget && {
            title: confirmTarget.title,
            startLabel: formatClassTime(confirmTarget.startAt),
            endLabel: confirmTarget.endAt ? formatClassTime(confirmTarget.endAt) : null,
            instructor: confirmTarget.instructor,
            location: confirmTarget.location,
          }
        }
        isSubmitting={isBooking}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmBooking}
      />

      <MessageModal content={messageModal} onClose={() => setMessageModal(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { padding: 16, paddingBottom: 0 },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  daySelectorWrap: { paddingHorizontal: 16, paddingTop: 12 },
  dayHeadingWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  dayEyebrow: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  dayTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 2 },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 12 },
  empty: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 12 },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  closedBannerText: { flex: 1, color: colors.textPrimary, fontSize: 13.5, lineHeight: 19 },
  listContent: { padding: 16, paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    borderLeftWidth: 5,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  cardBooked: { borderColor: colors.primary, shadowOpacity: 0.2, elevation: 4 },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  className: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
  },
  badgeText: { fontSize: 10.5, fontWeight: '800' },
  metaText: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  cardFooterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8 },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  footerText: { color: colors.textSecondary, fontSize: 11 },
  countdownSoon: { color: colors.primary, fontWeight: '700' },
});
