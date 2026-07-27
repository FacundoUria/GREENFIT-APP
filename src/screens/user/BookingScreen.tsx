import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { colors } from '../../theme/colors';
import { Schedule } from '../../types';

// MOCK — reemplazar por GET /schedules?date=...
const initialSchedules: Schedule[] = [
  { id: 1, gymClass: { id: 1, name: 'Boxeo' }, startTime: '2026-07-27T18:00:00', capacity: 10, bookedCount: 8, status: 'open' },
  { id: 2, gymClass: { id: 2, name: 'Cross' }, startTime: '2026-07-27T19:00:00', capacity: 12, bookedCount: 12, status: 'open' },
  { id: 3, gymClass: { id: 3, name: 'Funcional' }, startTime: '2026-07-27T20:00:00', capacity: 8, bookedCount: 3, status: 'open' },
];

// id de las clases donde el usuario ya reservó (mock local, en real vendría de la API)
const initialBookedIds = new Set<number>();

export default function BookingScreen() {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [bookedIds, setBookedIds] = useState(initialBookedIds);

  function toggleBooking(schedule: Schedule) {
    const alreadyBooked = bookedIds.has(schedule.id);

    if (!alreadyBooked && schedule.bookedCount >= schedule.capacity) {
      Alert.alert('Sin cupo', 'Esta clase ya no tiene lugares disponibles.');
      return;
    }

    setSchedules((prev) =>
      prev.map((s) =>
        s.id === schedule.id
          ? { ...s, bookedCount: s.bookedCount + (alreadyBooked ? -1 : 1) }
          : s
      )
    );

    setBookedIds((prev) => {
      const next = new Set(prev);
      alreadyBooked ? next.delete(schedule.id) : next.add(schedule.id);
      return next;
    });

    // TODO real: POST /bookings (reservar, descuenta 1 crédito)
    //            DELETE /bookings/:id (cancelar, dentro del margen permitido)
  }

  function renderItem({ item }: { item: Schedule }) {
    const isBooked = bookedIds.has(item.id);
    const isFull = item.bookedCount >= item.capacity && !isBooked;
    const time = new Date(item.startTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={styles.row}>
        <View>
          <Text style={styles.className}>{item.gymClass.name}</Text>
          <Text style={styles.time}>{time} hs</Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.slots, isFull && styles.slotsFull]}>
            {item.bookedCount}/{item.capacity}
          </Text>
          <TouchableOpacity
            style={[
              styles.button,
              isBooked ? styles.buttonCancel : isFull ? styles.buttonDisabled : styles.buttonGo,
            ]}
            disabled={isFull}
            onPress={() => toggleBooking(item)}
          >
            <Text style={styles.buttonText}>{isBooked ? 'Cancelar' : isFull ? 'Sin cupo' : 'Voy'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Hoy</Text>
      <FlatList
        data={schedules}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
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
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  className: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  time: { color: colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 8 },
  slots: { color: colors.textSecondary, fontSize: 12 },
  slotsFull: { color: colors.danger },
  button: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  buttonGo: { backgroundColor: colors.primary },
  buttonCancel: { backgroundColor: colors.surfaceAlt },
  buttonDisabled: { backgroundColor: colors.surfaceAlt, opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 13 },
});
