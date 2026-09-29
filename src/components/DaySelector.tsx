import React, { useMemo } from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { isSameDay } from '../lib/dateRange';
import { mockup, alfa, fuentes } from '../theme/agendaMockup';

interface DaySelectorProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  daysAhead?: number;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// Franja horizontal de días (hoy + próximos) para navegar la grilla de
// clases sin tener que abrir un calendario completo. Estilo calcado del
// mockup de Agenda (solo lo usa AgendaMobileView): el día elegido en verde
// neón lleno, el resto en gris oscuro con borde; mismo formato de 3 letras
// para toda la fila, salvo "Hoy".
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
        const isToday = index === 0;
        const label = isToday ? 'Hoy' : WEEKDAYS[day.getDay()];
        return (
          <TouchableOpacity
            key={day.toISOString()}
            style={[styles.chip, isSelected && styles.chipSelected]}
            onPress={() => onSelect(day)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <Text
              style={[
                styles.chipLabel,
                isToday && !isSelected && styles.chipLabelToday,
                isSelected && styles.chipLabelSelected,
              ]}
            >
              {label}
            </Text>
            <Text style={[styles.chipNumber, isSelected && styles.chipNumberSelected]}>{day.getDate()}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// Mockup: gap-2 py-1; chip min-w-[62px] py-3 px-2 rounded-2xl.
const styles = StyleSheet.create({
  container: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  chip: {
    minWidth: 62,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: mockup.surfaceContainerLow,
    borderWidth: 1,
    borderColor: alfa(mockup.outlineVariant, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  // bg-primary-container text-on-secondary-fixed shadow-[0_4px_20px_-2px_rgba(0,255,102,0.35)]
  chipSelected: {
    backgroundColor: mockup.primaryContainer,
    borderColor: mockup.primaryContainer,
    shadowColor: mockup.primaryContainer,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  // text-[11px] uppercase tracking-wider font-semibold text-on-surface-variant
  chipLabel: {
    color: mockup.onSurfaceVariant,
    fontFamily: fuentes.titulo,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
  // "Hoy" cuando no es el elegido: solo la etiqueta en verde (el mockup no
  // define este caso; así se sigue ubicando hoy en la fila).
  chipLabelToday: { color: mockup.primaryContainer, fontWeight: '800' },
  chipLabelSelected: { color: mockup.onSecondaryFixed, fontWeight: '800' },
  // text-xl font-bold leading-none mt-1 text-on-surface
  chipNumber: {
    color: mockup.onSurface,
    fontFamily: fuentes.titulo,
    fontSize: 20,
    lineHeight: 20,
    fontWeight: '700',
    marginTop: 4,
  },
  // text-2xl font-black
  chipNumberSelected: { color: mockup.onSecondaryFixed, fontSize: 24, lineHeight: 24, fontWeight: '900' },
});
