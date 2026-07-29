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
    const sinCreditos = !item.isBooked && !isFull && credits <= 0;

    const buttonLabel = item.isBooked ? 'Cancelar' : isFull ? 'Sin cupo' : sinCreditos ? 'Sin créditos' : 'Reservar';
    const buttonDisabled = isFull || sinCreditos || isPending;

    return (
      <View style={[styles.card, item.isBooked && styles.cardBooked]}>
        <View style={styles.mainRow}>
          <View style={styles.infoCol}>
            <View style={styles.titleRow}>
              <Text style={styles.className} numberOfLines={1}>
                {item.title}
              </Text>
              {item.isBooked && (
                <View style={styles.enrolledDot}>
                  <Ionicons name="checkmark" size={10} color={colors.onPrimary} />
                </View>
              )}
            </View>
            <Text style={styles.metaText}>
              {startLabel}
              {endLabel ? ` - ${endLabel}` : ''} hs
              {item.instructor ? ` · Prof. ${item.instructor}` : ''}
            </Text>
          </View>

          <View style={styles.capacityCol}>
            <Text style={[styles.capacityNumber, isFull && styles.capacityNumberFull]}>
              {item.bookedCount}/{item.capacity}
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progress * 100}%` }, isFull && styles.progressFillFull]}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.compactButton,
              item.isBooked ? styles.compactButtonCancel : styles.compactButtonGo,
              buttonDisabled && !item.isBooked && styles.compactButtonDisabled,
            ]}
            disabled={buttonDisabled}
            onPress={() => handlePress(item)}
          >
            {isPending ? (
              <ActivityIndicator color={item.isBooked ? colors.textPrimary : colors.onPrimary} size="small" />
            ) : (
              <Text
                style={[
                  styles.compactButtonText,
                  item.isBooked ? styles.compactButtonTextCancel : styles.compactButtonTextGo,
                ]}
                numberOfLines={1}
              >
                {buttonLabel}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {(item.location || !countdown.isPast || isAlmostFull || isFull || sinCreditos) && (
          <View style={styles.footerRow}>
            {item.location && (
              <View style={styles.footerItem}>
                <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                <Text style={styles.footerText}>{item.location}</Text>
              </View>
            )}
            {!countdown.isPast && (
              <Text style={[styles.footerText, countdown.isSoon && styles.countdownSoon]}>{countdown.label}</Text>
            )}
            {isAlmostFull && <Text style={[styles.footerText, styles.footerWarning]}>Últimos cupos</Text>}
            {sinCreditos && <Text style={[styles.footerText, styles.footerDanger]}>Sin créditos en {item.title}</Text>}
          </View>
        )}
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
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  cardBooked: { borderColor: colors.primary },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoCol: { flex: 1.4, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  className: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  enrolledDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaText: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  capacityCol: { width: 58, alignItems: 'center' },
  capacityNumber: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 5 },
  capacityNumberFull: { color: colors.danger },
  progressTrack: {
    width: '100%',
    height: 5,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: 5, backgroundColor: colors.primary, borderRadius: 3 },
  progressFillFull: { backgroundColor: colors.danger },
  compactButton: {
    minWidth: 84,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactButtonGo: { backgroundColor: colors.primary },
  compactButtonCancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.surfaceAlt },
  compactButtonDisabled: { backgroundColor: colors.surfaceAlt },
  compactButtonText: { fontWeight: '700', fontSize: 12.5 },
  compactButtonTextGo: { color: colors.onPrimary },
  compactButtonTextCancel: { color: colors.textSecondary },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  footerText: { color: colors.textSecondary, fontSize: 11 },
  countdownSoon: { color: colors.primary, fontWeight: '700' },
  footerWarning: { color: colors.warning, fontWeight: '700' },
  footerDanger: { color: colors.danger, fontWeight: '700' },
});
