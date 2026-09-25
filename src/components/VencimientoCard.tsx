import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { formatLongDate } from '../lib/dateFormat';
import { MembershipStatus } from '../lib/membershipStatus';

// Tarjeta de UNA sola fecha de vencimiento -- la fecha del plan del socio
// (ver resolverFechaPlan en creditsApi.ts: sale de user_credits, igual para
// socios con y sin Aparatos). El estado sale de membershipStatus.ts
// (getExpiryStatus), no se calcula acá. Solo son texto fijo de UI las
// etiquetas.

const STATUS_META: Record<MembershipStatus, { label: string; color: string; bg: string; borde: string }> = {
  activo: { label: 'Activo al día', color: colors.primary, bg: `${colors.primary}1A`, borde: `${colors.primary}4D` },
  por_vencer: { label: 'Por vencer', color: colors.warning, bg: `${colors.warning}26`, borde: `${colors.warning}66` },
  vencido: { label: 'Vencido', color: colors.danger, bg: `${colors.danger}26`, borde: `${colors.danger}66` },
};

interface VencimientoCardProps {
  fechaISO: string;
  status: MembershipStatus;
}

export default function VencimientoCard({ fechaISO, status }: VencimientoCardProps) {
  const meta = STATUS_META[status];
  return (
    <View style={styles.card} testID="vencimiento-card">
      <View style={styles.izquierda}>
        <View style={styles.iconoWrap}>
          <Ionicons name="calendar" size={18} color={colors.primary} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.etiqueta}>Vencimiento de cuota</Text>
          <Text style={styles.fecha} testID="vencimiento-fecha">
            {formatLongDate(fechaISO)}
          </Text>
        </View>
      </View>
      <View style={[styles.badge, { backgroundColor: meta.bg, borderColor: meta.borde }]}>
        <View style={[styles.badgePunto, { backgroundColor: meta.color }]} />
        <Text style={[styles.badgeTexto, { color: meta.color }]}>{meta.label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  izquierda: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  iconoWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  etiqueta: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  fecha: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePunto: { width: 6, height: 6, borderRadius: 3 },
  badgeTexto: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
});
