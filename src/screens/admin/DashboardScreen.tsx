import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { colors } from '../../theme/colors';
import { GymClass } from '../../types';
import { useAuth } from '../../context/AuthContext';

// bookedCount no vive en la tabla `classes` — se calcula contando bookings por class_id.
type ClassWithBookings = GymClass & { bookedCount: number };

// MOCK — reemplazar por: select de `classes` + count de `bookings` por class_id
const todaySchedules: ClassWithBookings[] = [
  { id: '1', title: 'Boxeo', startTime: '2026-07-27T18:00:00', capacity: 10, bookedCount: 8 },
  { id: '2', title: 'Cross', startTime: '2026-07-27T19:00:00', capacity: 12, bookedCount: 12 },
  { id: '3', title: 'Funcional', startTime: '2026-07-27T20:00:00', capacity: 8, bookedCount: 3 },
];

export default function DashboardScreen({ navigation }: any) {
  const { logout } = useAuth();
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Panel Admin — Hoy</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={todaySchedules}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const time = new Date(item.startTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('ClassRoster', { scheduleId: item.id })}
            >
              <View>
                <Text style={styles.className}>{item.title}</Text>
                <Text style={styles.time}>{time} hs</Text>
              </View>
              <Text style={styles.slots}>{item.bookedCount}/{item.capacity} anotados</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 0 },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  logout: { color: colors.textSecondary, fontSize: 13 },
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
  slots: { color: colors.primary, fontWeight: '700' },
});
