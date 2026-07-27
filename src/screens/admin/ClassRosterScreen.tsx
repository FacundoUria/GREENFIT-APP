import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { colors } from '../../theme/colors';

interface RosterEntry {
  bookingId: number;
  userName: string;
  attended: boolean;
}

// MOCK — reemplazar por GET /schedules/:id/bookings
const initialRoster: RosterEntry[] = [
  { bookingId: 1, userName: 'Facundo Uria', attended: false },
  { bookingId: 2, userName: 'Martina Gómez', attended: false },
  { bookingId: 3, userName: 'Lucas Pérez', attended: true },
];

export default function ClassRosterScreen({ route }: any) {
  const [roster, setRoster] = useState(initialRoster);

  function toggleAttendance(bookingId: number) {
    setRoster((prev) =>
      prev.map((r) => (r.bookingId === bookingId ? { ...r, attended: !r.attended } : r))
    );
    // TODO real: PATCH /bookings/:id  { status: 'attended' | 'confirmed' }
  }

  function cancelClass() {
    Alert.alert('Cancelar clase', '¿Confirmás cancelar esta clase para todos los anotados?', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Cancelar clase', style: 'destructive', onPress: () => {
        // TODO real: PATCH /schedules/:id { status: 'cancelled' } + notificación push
      } },
    ]);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={roster}
        keyExtractor={(item) => String(item.bookingId)}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => toggleAttendance(item.bookingId)}>
            <Text style={styles.name}>{item.userName}</Text>
            <View style={[styles.checkbox, item.attended && styles.checkboxChecked]}>
              {item.attended && <Text style={styles.check}>✓</Text>}
            </View>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.cancelButton} onPress={cancelClass}>
        <Text style={styles.cancelText}>Cancelar clase</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  name: { color: colors.textPrimary, fontSize: 15 },
  checkbox: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 2, borderColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.white, fontWeight: '900' },
  cancelButton: { margin: 16, padding: 14, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center' },
  cancelText: { color: colors.white, fontWeight: '700' },
});
