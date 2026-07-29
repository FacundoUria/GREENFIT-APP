import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { colors } from '../../theme/colors';
import { Booking } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatDateOnly } from '../../lib/classesApi';

async function fetchHistory(userId: string): Promise<Booking[]> {
  const todayStr = formatDateOnly(new Date());
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, user_id, booking_date, attended, created_at, classes!inner(id, title, discipline_id, instructor, location, capacity, days_of_week, start_time, end_time)'
    )
    .eq('user_id', userId)
    .lte('booking_date', todayStr)
    .order('booking_date', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => {
    const gymClass = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    return {
      id: row.id,
      userId: row.user_id,
      bookingDate: row.booking_date,
      attended: row.attended,
      createdAt: row.created_at,
      gymClass: {
        id: gymClass.id,
        title: gymClass.title,
        disciplineId: gymClass.discipline_id,
        instructor: gymClass.instructor,
        location: gymClass.location,
        daysOfWeek: gymClass.days_of_week ?? [],
        startTime: gymClass.start_time,
        endTime: gymClass.end_time,
        capacity: gymClass.capacity,
      },
    };
  });
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const [history, setHistory] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      setHistory(await fetchHistory(user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu historial.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      {isLoading && history.length === 0 && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {!isLoading && !error && history.length === 0 && (
        <Text style={styles.empty}>Todavía no tenés clases en tu historial.</Text>
      )}
      <FlatList
        data={history}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.className}>{item.gymClass.title}</Text>
              <Text style={styles.date}>
                {new Date(`${item.bookingDate}T00:00:00`).toLocaleDateString('es-AR')}
              </Text>
            </View>
            <Text
              style={[
                styles.status,
                item.attended === true ? styles.statusOk : item.attended === false ? styles.statusBad : styles.statusPending,
              ]}
            >
              {item.attended === true ? 'Asistió' : item.attended === false ? 'No asistió' : 'Sin marcar'}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', padding: 16, paddingBottom: 0 },
  error: { color: colors.danger, padding: 16 },
  empty: { color: colors.textSecondary, padding: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  className: { color: colors.textPrimary, fontWeight: '600' },
  date: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  status: { fontSize: 12, fontWeight: '700' },
  statusOk: { color: colors.primary },
  statusBad: { color: colors.danger },
  statusPending: { color: colors.textSecondary },
});
