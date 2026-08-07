import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { XP_POR_NIVEL } from '../lib/xpApi';
import Avatar from './Avatar';

// Tarjeta de perfil gamificada (avatar, nivel, barra de XP, mascota Pitbull,
// racha/miembro desde/clases del mes) -- vivía SOLO en Mi Perfil
// (PerfilMobileView.tsx), extraída acá para poder mostrarla TAMBIÉN arriba
// de todo en Inicio (HomeScreen.tsx) sin duplicar ~150 líneas de JSX/estilos
// entre las dos pantallas. 100% presentacional: cada pantalla sigue siendo
// dueña de cargar sus propios datos (fetchTotalXp/fetchClasesDelMes/etc.) y
// de su propio estado de subida de avatar (useAvatarUpload).

const MASCOT_WIDTH = 190;

function MascotHero() {
  return (
    <View style={styles.mascotWrap} pointerEvents="none">
      <Image
        source={require('../../assets/perfil-mascota.png')}
        style={styles.mascotHero}
        resizeMode="cover"
        accessibilityLabel="Mascota GreenFit"
      />
    </View>
  );
}

const MESES_ABREV = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function formatMesAnio(dateStr: string): string {
  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  return `${MESES_ABREV[date.getMonth()]} ${date.getFullYear()}`;
}

interface AthleteProfileCardProps {
  name: string;
  avatarUrl: string | null;
  nivel: number;
  xpEnNivel: number;
  racha: number;
  miembroDesde: string | null;
  clasesDelMes: number;
  isUploadingAvatar: boolean;
  onAvatarPress: () => void;
  onXpInfoPress: () => void;
}

export default function AthleteProfileCard({
  name,
  avatarUrl,
  nivel,
  xpEnNivel,
  racha,
  miembroDesde,
  clasesDelMes,
  isUploadingAvatar,
  onAvatarPress,
  onXpInfoPress,
}: AthleteProfileCardProps) {
  return (
    <View style={styles.athleteCard}>
      <View style={styles.athleteHeroRow}>
        <View style={styles.athleteInfoCol}>
          <View style={styles.athleteTopRow}>
            <TouchableOpacity
              onPress={onAvatarPress}
              disabled={isUploadingAvatar}
              accessibilityLabel="Cambiar foto de perfil"
              style={styles.avatarTouchable}
            >
              <Avatar uri={avatarUrl} name={name} size={60} />
              <View style={styles.avatarCameraBadge}>
                {isUploadingAvatar ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Ionicons name="camera" size={12} color={colors.onPrimary} />
                )}
              </View>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.athleteName} numberOfLines={1}>
                {name}
              </Text>
              <View style={styles.levelRow}>
                <View style={styles.levelBadge}>
                  <Ionicons name="flash" size={11} color={colors.onPrimary} />
                  <Text style={styles.levelBadgeText}>NIVEL {nivel}</Text>
                </View>
                <TouchableOpacity onPress={onXpInfoPress} hitSlop={8} accessibilityLabel="¿Cómo ganar XP?">
                  <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.xpBarWrap}>
            <View style={styles.xpBarTrack}>
              <View style={[styles.xpBarFill, { width: `${(xpEnNivel / XP_POR_NIVEL) * 100}%` }]} />
            </View>
            <Text style={styles.xpBarText}>
              {xpEnNivel} / {XP_POR_NIVEL} XP
            </Text>
          </View>
        </View>

        <MascotHero />
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Ionicons name="flame" size={16} color={colors.warning} />
          <Text style={styles.statValue} testID="stat-racha">
            {racha}
          </Text>
          <Text style={styles.statLabel}>Racha</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCol}>
          <Ionicons name="calendar" size={16} color={colors.primary} />
          <Text style={styles.statValue} testID="stat-miembro-desde">
            {miembroDesde ? formatMesAnio(miembroDesde) : '--'}
          </Text>
          <Text style={styles.statLabel}>Miembro desde</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCol}>
          <Ionicons name="checkmark-done" size={16} color={colors.primary} />
          <Text style={styles.statValue} testID="stat-clases">
            {clasesDelMes}
          </Text>
          <Text style={styles.statLabel}>Clases (mes)</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  athleteCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  athleteHeroRow: { position: 'relative', flexDirection: 'row', alignItems: 'flex-start' },
  athleteInfoCol: { flex: 1, minWidth: 0, paddingRight: MASCOT_WIDTH - 50, zIndex: 2 },
  mascotWrap: {
    position: 'absolute',
    bottom: -30,
    right: 0,
    width: MASCOT_WIDTH,
    height: 175,
  },
  mascotHero: { width: '100%', height: '100%' },
  athleteTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarTouchable: { position: 'relative' },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  athleteName: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  levelBadgeText: { color: colors.onPrimary, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  xpBarWrap: { marginTop: 14, gap: 4 },
  xpBarTrack: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden' },
  xpBarFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  xpBarText: { color: colors.textSecondary, fontSize: 10.5, fontWeight: '700', alignSelf: 'flex-end' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  statCol: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, height: 32, backgroundColor: colors.surfaceAlt },
  statValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  statLabel: { color: colors.textSecondary, fontSize: 10.5 },
});
