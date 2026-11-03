import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet } from 'react-native';
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
export default function NotificationDetailSheet({ notification, onClose }: NotificationDetailSheetProps) {
  return (
    <Modal visible={!!notification} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Cerrar notificación"
          testID="notif-detail-backdrop"
        />
        {notification && (
          <View style={styles.sheet} testID="notif-detail-sheet">
            <View style={styles.handle} />
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

            <TouchableOpacity style={styles.button} onPress={onClose} testID="notif-detail-close">
              <Text style={styles.buttonText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.surfaceAlt,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceAlt,
    marginBottom: 14,
  },
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
