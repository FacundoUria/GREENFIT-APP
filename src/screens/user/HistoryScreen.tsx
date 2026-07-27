import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { colors } from '../../theme/colors';
import { Booking } from '../../types';

// MOCK — reemplazar por GET /users/:id/bookings?status=attended
const mockHistory: Booking[] = [
  {
    id: 1,
    userId: 1,
    status: 'attended',
    createdAt: '2026-07-20T18:00:00',
    schedule: {
      id: 10,
      gymClass: { id: 1, name: 'Boxeo' },
      startTime: '2026-07-20T18:00:00',
      capacity: 10,
      bookedCount: 10,
      status: 'open',
    },
  },
  {
    id: 2,
    userId: 1,
    status: 'no_show',
    createdAt: '2026-07-18T19:00:00',
    schedule: {
      id: 11,
      gymClass: { id: 3, name: 'Funcional' },
      startTime: '2026-07-18T19:00:00',
      capacity: 8,
      bookedCount: 8,
      status: 'open',
    },
  },
];

const statusLabel: Record<Booking['status'], string> = {
  attended: 'Asistió',
  no_show: 'No asistió',
  cancelled: 'Cancelada',
  confirmed: 'Confirmada',
};

export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Historial</Text>
      <FlatList
        data={mockHistory}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.className}>{item.schedule.gymClass.name}</Text>
              <Text style={styles.date}>
                {new Date(item.schedule.startTime).toLocaleDateString('es-AR')}
              </Text>
            </View>
            <Text
              style={[
                styles.status,
                item.status === 'attended' ? styles.statusOk : styles.statusBad,
              ]}
            >
              {statusLabel[item.status]}
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
});
