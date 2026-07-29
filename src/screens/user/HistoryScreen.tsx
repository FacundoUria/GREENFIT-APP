import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { colors } from '../../theme/colors';
import { Booking } from '../../types';

// MOCK — reemplazar por: select de `bookings` (join `classes`) para el user logueado
const mockHistory: Booking[] = [
  {
    id: '1',
    userId: '1',
    createdAt: '2026-07-20T18:00:00',
    bookingDate: '2026-07-20',
    attended: true,
    gymClass: {
      id: '10',
      title: 'Boxeo',
      disciplineId: '1',
      instructor: null,
      location: null,
      daysOfWeek: [1, 3, 5],
      startTime: '18:00:00',
      endTime: '19:00:00',
      capacity: 10,
    },
  },
  {
    id: '2',
    userId: '1',
    createdAt: '2026-07-18T19:00:00',
    bookingDate: '2026-07-18',
    attended: false,
    gymClass: {
      id: '11',
      title: 'Kickboxing',
      disciplineId: '2',
      instructor: null,
      location: null,
      daysOfWeek: [2, 4],
      startTime: '19:00:00',
      endTime: '20:00:00',
      capacity: 8,
    },
  },
];

export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <FlatList
        data={mockHistory}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.className}>{item.gymClass.title}</Text>
              <Text style={styles.date}>
                {new Date(`${item.bookingDate}T00:00:00`).toLocaleDateString('es-AR')}
              </Text>
            </View>
            <Text style={[styles.status, item.attended ? styles.statusOk : styles.statusBad]}>
              {item.attended ? 'Asistió' : 'No asistió'}
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
