import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';

// El QR codifica el DNI -- mismo identificador que ya usa recepción para
// buscar al socio en el panel (Socios.jsx busca por nombre/apellido/DNI),
// así que no hace falta que el panel tenga un lector propio: alcanza con
// tipear o escanear el DNI para encontrar a la persona.
export default function CredentialScreen() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.brand}>
            GREEN<Text style={{ color: colors.primary }}>FIT</Text>
          </Text>
          <Text style={styles.cardSubtitle}>Credencial Digital</Text>
        </View>

        <View style={styles.qrWrap}>
          {user.dni ? (
            <QRCode value={user.dni} size={180} backgroundColor="#FFFFFF" color={colors.background} />
          ) : (
            <View style={styles.qrPlaceholder}>
              <Text style={styles.qrPlaceholderText}>Sin DNI cargado</Text>
            </View>
          )}
        </View>

        <Text style={styles.name}>{user.name}</Text>

        <View style={styles.divider} />

        <View style={styles.dniRow}>
          <Text style={styles.dniLabel}>DNI</Text>
          <Text style={styles.dniValue}>{user.dni ?? '—'}</Text>
        </View>
      </View>

      <Text style={styles.hint}>Mostrá este código en recepción para marcar tu ingreso.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  cardHeader: { alignItems: 'center', marginBottom: 24 },
  brand: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: 0.5 },
  cardSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  qrWrap: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  qrPlaceholder: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrPlaceholderText: { color: colors.background, fontSize: 13, textAlign: 'center' },
  name: { fontSize: 19, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  divider: { width: '100%', height: 1, backgroundColor: colors.surfaceAlt, marginVertical: 18 },
  dniRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dniLabel: { fontSize: 12, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  dniValue: { fontSize: 20, fontWeight: '800', color: colors.primary, letterSpacing: 1 },
  hint: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
