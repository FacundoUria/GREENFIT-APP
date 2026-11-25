import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Tocable from './Tocable';
import HojaInferior from './HojaInferior';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { formatShortDate } from '../lib/dateFormat';

export interface NotificationDetail {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  categoriaLabel: string;
  categoriaColor: string;
  categoriaBg: string;
  categoriaIcon: keyof typeof Ionicons.glyphMap;
}

interface NotificationDetailSheetProps {
  notification: NotificationDetail | null;
  onClose: () => void;
}

// "03/11/2026 17:29" en hora Argentina -- mismo anclaje de huso que
// formatShortDate(), para que la fecha del popup no dependa del teléfono.
export function formatDetailDate(createdAt: string): string {
  const hora = new Date(createdAt).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Mendoza',
  });
  return `${formatShortDate(createdAt)} ${hora}`;
}

// Detalle de una notificación: en la lista el cuerpo va recortado a 3
// líneas, acá va COMPLETO. Bottom sheet (sube desde abajo) con scroll
// propio para mensajes largos; <Text> respeta los "\n" del mensaje tal cual
// (en web, react-native-web lo renderiza con white-space: pre-wrap).
export default function NotificationDetailSheet({ notification: actual, onClose }: NotificationDetailSheetProps) {
  // Mientras la hoja se cierra (200 ms) se sigue mostrando la última notificación.
  const ultima = useRef(actual);
  if (actual) ultima.current = actual;
  const notification = actual ?? ultima.current;
  if (!notification) return null;

  return (
    <HojaInferior
      visible={!!actual}
      onClose={onClose}
      style={styles.sheet}
      testID="notif-detail-sheet"
      testIDFondo="notif-detail-backdrop"
    >
      <>
        <View style={styles.headerRow}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: notification.categoriaBg, borderColor: `${notification.categoriaColor}55` },
            ]}
          >
            <Ionicons name={notification.categoriaIcon} size={18} color={notification.categoriaColor} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>{notification.title}</Text>
            <View style={styles.metaRow}>
              <View style={[styles.chip, { backgroundColor: notification.categoriaBg }]}>
                <Text style={[styles.chipText, { color: notification.categoriaColor }]}>
                  {notification.categoriaLabel}
                </Text>
              </View>
              <Text style={styles.date} testID="notif-detail-date">
                {formatDetailDate(notification.createdAt)}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyContent}>
          <Text style={styles.body} testID="notif-detail-body">
            {notification.body}
          </Text>
        </ScrollView>

        <Tocable style={styles.button} onPress={onClose} testID="notif-detail-close">
          <Text style={styles.buttonText}>Cerrar</Text>
        </Tocable>
      </>
    </HojaInferior>
  );
}

const styles = StyleSheet.create({
  // El resto (fondo, bordes, manija) lo pone HojaInferior.
  sheet: { maxHeight: '85%' },
  headerRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { borderRadius: 20, paddingVertical: 3, paddingHorizontal: 9 },
  chipText: { fontSize: 10, fontWeight: '800' },
  date: { color: colors.textSecondary, fontSize: 12 },
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingBottom: 4 },
  body: { color: colors.textPrimary, fontSize: 14.5, lineHeight: 21 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
