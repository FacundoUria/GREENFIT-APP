import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import CancelBookingModal from '../../components/CancelBookingModal';
import DaySelector from '../../components/DaySelector';
import ReservaConfirmadaModal from '../../components/ReservaConfirmadaModal';

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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function AgendaMobileView() {
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

  async function handlePress(item: AgendaClass) {
    if (item.isBooked) {
      setCancelTarget(item);
      return;
    }
    if (closedToday) {
      Alert.alert(
        'Gimnasio cerrado',
        `El gimnasio permanece cerrado este día${closedToday.motivo ? ` (${closedToday.motivo})` : ''}.`
      );
      return;
    }
    if (item.bookedCount >= item.capacity) {
      Alert.alert('Sin cupo', 'Esta clase ya no tiene lugares disponibles.');
      return;
    }
    if ((creditsByDiscipline.get(item.disciplineId) ?? 0) <= 0) {
      Alert.alert('Sin créditos', `No te quedan créditos de ${item.title} para reservar.`);
      return;
    }

    setPendingId(item.id);
    try {
      const { error: rpcError } = await supabase.rpc('book_class', {
        p_class_id: item.id,
        p_booking_date: item.occurrenceDate,
      });
      if (rpcError) throw new Error(rpcError.message);
      await load();
      setConfirmedBooking(item);
    } catch (err) {
      Alert.alert('No se pudo reservar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setPendingId(null);
    }
  }

  async function confirmCancel(reason: string) {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const { data: creditoReintegrado, error: rpcError } = await supabase.rpc('cancel_booking', {
        p_class_id: cancelTarget.id,
        p_booking_date: cancelTarget.occurrenceDate,
        p_reason: reason || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setCancelTarget(null);
      await load();
      Alert.alert(
        'Reserva cancelada',
        creditoReintegrado
          ? 'Te devolvimos el crédito.'
          : 'Como cancelaste con menos de 2 horas de anticipación, no se reintegra el crédito.'
      );
    } catch (err) {
      Alert.alert('No se pudo cancelar', err instanceof Error ? err.message : 'Intentá de nuevo.');
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
      : { label: 'Disponible', bg: colors.surfaceAlt, fg: colors.textSecondary, icon: 'ellipse-outline' as const };

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

      {/* Preview visual del futuro botón central "+ Reserva" de la bottom
          nav (todavía no existe esa nav -- ver Módulo Navegación). Acá
          funciona como acceso rápido real: vuelve la agenda a HOY. */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setSelectedDate(new Date())}
        accessibilityLabel="Volver a hoy"
      >
        <Ionicons name="add" size={26} color={colors.onPrimary} />
      </TouchableOpacity>

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
  listContent: { padding: 16, paddingBottom: 96 },
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    borderLeftWidth: 4,
  },
  cardBooked: { borderColor: colors.primary },
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
  fab: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
