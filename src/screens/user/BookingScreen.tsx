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
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { GymClass } from '../../types';

// bookedCount/isBooked no viven en `classes` — se calculan del lado del cliente
// contando y filtrando la tabla `bookings` para el rango del día.
type ClassWithBookings = GymClass & { bookedCount: number; isBooked: boolean };

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function loadClasses(userId: string): Promise<ClassWithBookings[]> {
  const { start, end } = todayRange();

  const { data: classes, error: classesError } = await supabase
    .from('classes')
    .select('id, title, capacity, start_time')
    .gte('start_time', start)
    .lt('start_time', end)
    .order('start_time', { ascending: true });
  if (classesError) throw new Error(classesError.message);
  if (!classes || classes.length === 0) return [];

  const classIds = classes.map((c) => c.id);
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('class_id, user_id')
    .in('class_id', classIds);
  if (bookingsError) throw new Error(bookingsError.message);

  const countByClass = new Map<string, number>();
  const bookedByUser = new Set<string>();
  for (const b of bookings ?? []) {
    countByClass.set(b.class_id, (countByClass.get(b.class_id) ?? 0) + 1);
    if (b.user_id === userId) bookedByUser.add(b.class_id);
  }

  return classes.map((c) => ({
    id: c.id,
    title: c.title,
    capacity: c.capacity,
    startTime: c.start_time,
    bookedCount: countByClass.get(c.id) ?? 0,
    isBooked: bookedByUser.has(c.id),
  }));
}

async function fetchRemainingCredits(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('remaining_credits')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.remaining_credits ?? 0;
}

export default function BookingScreen() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassWithBookings[]>([]);
  const [remainingCredits, setRemainingCredits] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [classList, credits] = await Promise.all([
        loadClasses(user.id),
        fetchRemainingCredits(user.id),
      ]);
      setClasses(classList);
      setRemainingCredits(credits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las clases.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleBooking(item: ClassWithBookings) {
    if (!item.isBooked && item.bookedCount >= item.capacity) {
      Alert.alert('Sin cupo', 'Esta clase ya no tiene lugares disponibles.');
      return;
    }
    if (!item.isBooked && remainingCredits <= 0) {
      Alert.alert('Sin créditos', 'No te quedan créditos disponibles para reservar.');
      return;
    }

    setPendingId(item.id);
    try {
      const { error: rpcError } = item.isBooked
        ? await supabase.rpc('cancel_booking', { p_class_id: item.id })
        : await supabase.rpc('book_class', { p_class_id: item.id });
      if (rpcError) throw new Error(rpcError.message);
      await load();
    } catch (err) {
      Alert.alert(
        'No se pudo completar la reserva',
        err instanceof Error ? err.message : 'Intentá de nuevo.'
      );
    } finally {
      setPendingId(null);
    }
  }

  function renderItem({ item }: { item: ClassWithBookings }) {
    const isFull = item.bookedCount >= item.capacity && !item.isBooked;
    const time = new Date(item.startTime).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const isPending = pendingId === item.id;

    return (
      <View style={styles.row}>
        <View>
          <Text style={styles.className}>{item.title}</Text>
          <Text style={styles.time}>{time} hs</Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.slots, isFull && styles.slotsFull]}>
            {item.bookedCount}/{item.capacity}
          </Text>
          <TouchableOpacity
            style={[
              styles.button,
              item.isBooked ? styles.buttonCancel : isFull ? styles.buttonDisabled : styles.buttonGo,
            ]}
            disabled={isFull || isPending}
            onPress={() => toggleBooking(item)}
          >
            {isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.buttonText}>
                {item.isBooked ? 'Cancelar' : isFull ? 'Sin cupo' : 'Voy'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Hoy</Text>
        <Text style={styles.credits}>{remainingCredits} créditos</Text>
      </View>

      {isLoading && classes.length === 0 && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {!isLoading && !error && classes.length === 0 && (
        <Text style={styles.empty}>No hay clases programadas para hoy.</Text>
      )}

      <FlatList
        data={classes}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 0,
  },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  credits: { color: colors.primary, fontWeight: '700' },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 12 },
  empty: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  className: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  time: { color: colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 8 },
  slots: { color: colors.textSecondary, fontSize: 12 },
  slotsFull: { color: colors.danger },
  button: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 76, alignItems: 'center' },
  buttonGo: { backgroundColor: colors.primary },
  buttonCancel: { backgroundColor: colors.surfaceAlt },
  buttonDisabled: { backgroundColor: colors.surfaceAlt, opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 13 },
});
