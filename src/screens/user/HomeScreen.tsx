import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { UserCredit } from '../../types';

// Trae el user_credits más reciente del socio logueado, con su pack asociado.
// Si un socio puede tener varios packs activos a la vez, esto va a necesitar
// ajustarse para listar todos en vez de traer solo el último.
async function fetchUserCredit(userId: string): Promise<UserCredit | null> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('id, user_id, remaining_credits, created_at, pack:packs(id, name, credits, price)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const pack = Array.isArray(data.pack) ? data.pack[0] : data.pack;

  return {
    id: data.id,
    userId: data.user_id,
    remainingCredits: data.remaining_credits,
    createdAt: data.created_at,
    pack: { id: pack.id, name: pack.name, credits: pack.credits, price: pack.price },
  };
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const [credit, setCredit] = useState<UserCredit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const result = await fetchUserCredit(user.id);
      setCredit(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu crédito.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const progress = credit ? credit.remainingCredits / credit.pack.credits : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20 }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.greeting}>Hola, {user?.name} 👋</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      </View>

      {isLoading && !credit && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}

      {error && <Text style={styles.error}>{error}</Text>}

      {!isLoading && !error && !credit && (
        <Text style={styles.text}>Todavía no tenés ningún pack de clases activo.</Text>
      )}

      {credit && (
        <View style={styles.card}>
          <Text style={styles.packName}>{credit.pack.name}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={styles.creditsRow}>
            <Text style={styles.creditsNumber}>{credit.remainingCredits}</Text>
            <Text style={styles.creditsLabel}>de {credit.pack.credits} clases restantes</Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Próximo paso</Text>
      <Text style={styles.text}>
        Andá a la pestaña "Reservas" para ver la grilla de horarios y anotarte.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  logout: { color: colors.textSecondary, fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  error: { color: colors.danger, marginTop: 20 },
  packName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  progressTrack: { height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  creditsRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14, gap: 8 },
  creditsNumber: { color: colors.primary, fontSize: 32, fontWeight: '800' },
  creditsLabel: { color: colors.textSecondary, fontSize: 14 },
  expires: { color: colors.textSecondary, fontSize: 12, marginTop: 10 },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 28, marginBottom: 8 },
  text: { color: colors.textSecondary, lineHeight: 20 },
});
