import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { UserPack } from '../../types';

// MOCK — reemplazar por GET /users/:id/packs
const mockUserPack: UserPack = {
  id: 1,
  userId: 1,
  pack: { id: 1, name: 'Pack 12 clases de Boxeo', totalCredits: 12, validityDays: 30 },
  creditsRemaining: 7,
  expiresAt: '2026-08-25',
  status: 'active',
};

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const pack = mockUserPack;
  const progress = pack.creditsRemaining / pack.pack.totalCredits;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <View style={styles.headerRow}>
        <Text style={styles.greeting}>Hola, {user?.name} 👋</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.packName}>{pack.pack.name}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.creditsRow}>
          <Text style={styles.creditsNumber}>{pack.creditsRemaining}</Text>
          <Text style={styles.creditsLabel}>de {pack.pack.totalCredits} clases restantes</Text>
        </View>
        <Text style={styles.expires}>Vence el {pack.expiresAt}</Text>
      </View>

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
