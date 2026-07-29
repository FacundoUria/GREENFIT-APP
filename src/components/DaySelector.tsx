import React, { useMemo } from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { isSameDay } from '../lib/dateRange';

interface DaySelectorProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  daysAhead?: number;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// Franja horizontal de días (hoy + próximos) para navegar la grilla de
// clases sin tener que abrir un calendario completo.
export default function DaySelector({ selectedDate, onSelect, daysAhead = 10 }: DaySelectorProps) {
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: daysAhead }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [daysAhead]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.container}>
      {days.map((day, index) => {
        const isSelected = isSameDay(day, selectedDate);
        const label = index === 0 ? 'Hoy' : index === 1 ? 'Mañana' : WEEKDAYS[day.getDay()];
        return (
          <TouchableOpacity
            key={day.toISOString()}
            style={[styles.chip, isSelected && styles.chipSelected]}
            onPress={() => onSelect(day)}
          >
            <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>{label}</Text>
            <Text style={[styles.chipNumber, isSelected && styles.chipLabelSelected]}>{day.getDate()}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, paddingBottom: 4 },
  chip: {
    width: 56,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  chipNumber: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 2 },
  chipLabelSelected: { color: colors.onPrimary },
});
