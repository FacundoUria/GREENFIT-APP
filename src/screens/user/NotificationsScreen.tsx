import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

interface MyNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

// La policy notifications_select_recipient ya filtra las filas: solo trae
// las que son 'all', las dirigidas a este user_id, las de una clase donde
// tiene reserva, o las de deudores si a este socio se le acabaron los créditos.
async function loadMyNotifications(): Promise<MyNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.created_at }));
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<MyNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await loadMyNotifications());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las notificaciones.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Notificaciones</Text>

      {isLoading && items.length === 0 && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {!isLoading && !error && items.length === 0 && (
        <Text style={styles.empty}>No tenés notificaciones todavía.</Text>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.date}>
              {new Date(item.createdAt).toLocaleString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
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
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 12 },
  empty: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  body: { color: colors.textSecondary, lineHeight: 18 },
  date: { color: colors.textSecondary, fontSize: 11, marginTop: 8 },
});
