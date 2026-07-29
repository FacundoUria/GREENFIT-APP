import React, { useCallback, useEffect, useState } from 'react';
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
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { loadClassesForDate, ClassWithBookings as BaseClassWithBookings } from '../../lib/classesApi';
import { formatClassTime, getCountdown } from '../../lib/classTime';
import { useTicker } from '../../hooks/useTicker';
import CancelBookingModal from '../../components/CancelBookingModal';
import DaySelector from '../../components/DaySelector';

type ClassWithBookings = BaseClassWithBookings & { isBooked: boolean };

// Debe coincidir con la ventana de 2hs que aplica cancel_booking() en el
// servidor — esto es solo para avisar antes de confirmar, no la regla real.
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function loadClasses(userId: string, date: Date): Promise<ClassWithBookings[]> {
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

// El balance de créditos es por disciplina — cada clase solo puede
// reservarse con los créditos de SU disciplina, no un total global.
async function fetchCreditsByDiscipline(userId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('discipline_id, remaining_credits, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const latestByDiscipline = new Map<string, number>();
  for (const row of data ?? []) {
    if (!latestByDiscipline.has(row.discipline_id)) {
      latestByDiscipline.set(row.discipline_id, row.remaining_credits ?? 0);
    }
  }
  return latestByDiscipline;
}

export default function BookingScreen() {
  useTicker();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [classes, setClasses] = useState<ClassWithBookings[]>([]);
  const [creditsByDiscipline, setCreditsByDiscipline] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ClassWithBookings | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [classList, credits] = await Promise.all([
        loadClasses(user.id, selectedDate),
        fetchCreditsByDiscipline(user.id),
      ]);
      setClasses(classList);
      setCreditsByDiscipline(credits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las clases.');
    } finally {
      setIsLoading(false);
    }
  }, [user, selectedDate]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  async function handlePress(item: ClassWithBookings) {
    if (item.isBooked) {
      setCancelTarget(item);
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

  function renderItem({ item }: { item: ClassWithBookings }) {
    const remaining = item.capacity - item.bookedCount;
    const isFull = remaining <= 0 && !item.isBooked;
    const isAlmostFull = !isFull && remaining > 0 && remaining <= 3;
    const progress = Math.min(1, item.bookedCount / item.capacity);
    const startLabel = formatClassTime(item.startAt);
    const endLabel = item.endAt ? formatClassTime(item.endAt) : null;
    const countdown = getCountdown(item.startAt);
    const isPending = pendingId === item.id;
    const credits = creditsByDiscipline.get(item.disciplineId) ?? 0;

    return (
      <View style={[styles.card, item.isBooked && styles.cardBooked]}>
        {item.isBooked && (
          <View style={styles.enrolledBadge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.onPrimary} />
            <Text style={styles.enrolledBadgeText}>Inscripto</Text>
          </View>
        )}

        <Text style={styles.className}>{item.title}</Text>
        {item.instructor && <Text style={styles.metaText}>Prof. {item.instructor}</Text>}
        <Text style={styles.metaText}>
          {startLabel}
          {endLabel ? ` - ${endLabel}` : ''} hs
        </Text>
        {item.location && (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.metaText}>{item.location}</Text>
          </View>
        )}
        {!countdown.isPast && (
          <Text style={[styles.countdown, countdown.isSoon && styles.countdownSoon]}>{countdown.label}</Text>
        )}

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%` },
              isFull && styles.progressFillFull,
            ]}
          />
        </View>
        <View style={styles.capacityRow}>
          <Text style={styles.capacityText}>
            {item.bookedCount} / {item.capacity} anotados
          </Text>
          {isFull && (
            <View style={styles.statusBadgeFull}>
              <Text style={styles.statusBadgeFullText}>Agotado</Text>
            </View>
          )}
          {isAlmostFull && (
            <View style={styles.statusBadgeAlmost}>
              <Text style={styles.statusBadgeAlmostText}>Últimos cupos</Text>
            </View>
          )}
        </View>

        <View style={[styles.creditsBadge, credits <= 0 && styles.creditsBadgeEmpty]}>
          <Text style={[styles.creditsBadgeText, credits <= 0 && styles.creditsBadgeTextEmpty]}>
            Tus créditos en {item.title}: {credits}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            item.isBooked ? styles.buttonCancel : isFull ? styles.buttonDisabled : styles.buttonGo,
          ]}
          disabled={isFull || isPending}
          onPress={() => handlePress(item)}
        >
          {isPending ? (
            <ActivityIndicator color={item.isBooked || isFull ? colors.white : colors.onPrimary} size="small" />
          ) : (
            <Text style={[styles.buttonText, !item.isBooked && !isFull && styles.buttonTextOnPrimary]}>
              {item.isBooked ? 'Cancelar mi reserva' : isFull ? 'Sin cupo' : 'Reservar cupo'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Reservas</Text>
      </View>

      <View style={styles.daySelectorWrap}>
        <DaySelector selectedDate={selectedDate} onSelect={setSelectedDate} />
      </View>

      {isLoading && classes.length === 0 && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {!isLoading && !error && classes.length === 0 && (
        <Text style={styles.empty}>No hay clases programadas para este día.</Text>
      )}

      <FlatList
        data={classes}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
      />

      <CancelBookingModal
        visible={!!cancelTarget}
        className={cancelTarget?.title ?? ''}
        isSubmitting={isCancelling}
        withinCancelLimit={
          !!cancelTarget && new Date(cancelTarget.startAt).getTime() - Date.now() < TWO_HOURS_MS
        }
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { padding: 16, paddingBottom: 0 },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  daySelectorWrap: { paddingHorizontal: 16, paddingTop: 12 },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 12 },
  empty: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  cardBooked: { borderColor: colors.primary },
  enrolledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  enrolledBadgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: '700' },
  className: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  metaText: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  countdown: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  countdownSoon: { color: colors.primary, fontWeight: '700' },
  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 12,
  },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressFillFull: { backgroundColor: colors.danger },
  capacityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  capacityText: { color: colors.textSecondary, fontSize: 12 },
  statusBadgeFull: { backgroundColor: 'rgba(224, 83, 83, 0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeFullText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  statusBadgeAlmost: { backgroundColor: 'rgba(224, 185, 83, 0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeAlmostText: { color: colors.warning, fontSize: 11, fontWeight: '700' },
  creditsBadge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 255, 56, 0.15)',
  },
  creditsBadgeEmpty: { backgroundColor: 'rgba(224, 83, 83, 0.15)' },
  creditsBadgeText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  creditsBadgeTextEmpty: { color: colors.danger },
  button: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonGo: { backgroundColor: colors.primary },
  buttonCancel: { backgroundColor: colors.surfaceAlt },
  buttonDisabled: { backgroundColor: colors.surfaceAlt, opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  buttonTextOnPrimary: { color: colors.onPrimary },
});
