import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { supabase } from '../../lib/supabase';
import { fetchUserBalances } from '../../lib/creditsApi';
import { formatLongDate, getCreditsStatus, getExpiryStatus, MembershipStatus } from '../../lib/membershipStatus';
import {
  fetchTotalXp,
  calcularResumenXp,
  fetchFechasAsistencia,
  calcularRachaDias,
  fetchClasesDelMes,
  XP_POR_NIVEL,
} from '../../lib/xpApi';
import { checkAvatarDisponible, subirAvatarPerfil } from '../../lib/avatarApi';
import Avatar, { getInitials } from '../../components/Avatar';
import XpInfoModal from '../../components/XpInfoModal';
import { UserCredit } from '../../types';

export { getInitials };

// Vista nueva y paralela a ProfileScreen (Módulo 3 del rediseño) -- no
// reemplaza ni engancha en la navegación real todavía. ProfileScreen sigue
// siendo dueña de la edición de datos/logout; esta pantalla es el "hub"
// visual gamificado que reusa exactamente los mismos datos reales que ya
// existen (balances, configuración). Nivel/XP salen de xpApi.ts (real vía
// xp_events, con fallback si esa tabla todavía no está desplegada -- ver
// backend/supabase_migration_xp.sql). Racha y "Clases (mes)" también son
// reales ahora (antes: racha placeholder fijo, "Clases" era un conteo
// histórico de TODAS las clases de siempre bajo una etiqueta que sugería
// "del mes").

// Mismo número que usa HomeScreen para "Contactar" en la Hero Card -- lo
// reusamos tal cual para el acceso directo "Soporte" (no está exportado
// desde HomeScreen.tsx, así que se duplica el literal a propósito en vez de
// tocar ese archivo).
const CONTACTO_WHATSAPP = 'https://wa.me/5492617139662';

const STATUS_META: Record<MembershipStatus, { label: string; color: string; bg: string }> = {
  activo: { label: 'Activo', color: colors.primary, bg: 'rgba(0, 255, 56, 0.15)' },
  por_vencer: { label: 'Por Vencer', color: colors.warning, bg: 'rgba(224, 185, 83, 0.15)' },
  vencido: { label: 'Vencido', color: colors.danger, bg: 'rgba(224, 83, 83, 0.15)' },
};

function StatusBadge({ status }: { status: MembershipStatus }) {
  const meta = STATUS_META[status];
  return (
    <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.statusBadgeText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

const MESES_ABREV = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function formatMesAnio(dateStr: string): string {
  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  return `${MESES_ABREV[date.getMonth()]} ${date.getFullYear()}`;
}

// `created_at` de `profiles` no lo trae AuthContext (solo pide id/full_name/
// dni/phone/role/active/avatar_url) -- se pide acá aparte, mismo criterio
// que ya usa ProfileScreen.tsx para sus propios campos extra, en vez de
// tocar la query de AuthContext.
async function fetchMiembroDesde(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('created_at').eq('id', userId).single();
  if (error || !data?.created_at) return null;
  return data.created_at as string;
}

export type PerfilAccesoDirecto =
  | 'mis-datos'
  | 'mis-reservas'
  | 'pagos'
  | 'notificaciones'
  | 'progreso'
  | 'comunidad'
  | 'mi-plan'
  | 'soporte';

interface AccesoDirectoDef {
  key: PerfilAccesoDirecto;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

// "Mi Agenda" se sacó de acá -- duplicaba a "Mis Reservas" (las dos
// llevaban al mismo tab de Agenda). En su lugar quedó "Mi Progreso"
// (gráficos de PRs, nivel y asistencia -- lo mismo que antes vivía en la
// bottom nav como tab "Progreso", ahora se abre desde acá).
const ACCESOS_DIRECTOS: AccesoDirectoDef[] = [
  { key: 'mis-datos', label: 'Mis Datos', icon: 'person-outline' },
  { key: 'mis-reservas', label: 'Mis Reservas', icon: 'calendar-outline' },
  { key: 'pagos', label: 'Pagos y Facturas', icon: 'card-outline' },
  { key: 'notificaciones', label: 'Notificaciones', icon: 'notifications-outline' },
  { key: 'progreso', label: 'Mi Progreso', icon: 'stats-chart-outline' },
  { key: 'comunidad', label: 'Comunidad', icon: 'people-outline' },
  { key: 'mi-plan', label: 'Mi Plan', icon: 'ribbon-outline' },
  { key: 'soporte', label: 'Soporte', icon: 'help-buoy-outline' },
];

interface PerfilMobileViewProps {
  // Cuando esta vista se enganche de verdad a la navegación (todavía no
  // arrancó ese módulo), el padre resuelve cada acceso a su ruta real:
  //   mis-datos      -> ProfileStack "ProfileHome" (ya existe)
  //   mis-reservas   -> tab "Reservas" (ya existe, cruza de tab)
  //   notificaciones -> RootStack "Notifications" (ya existe, ruta raíz)
  //   progreso       -> ProfileStack "Progreso" (pantalla empujada, con header nativo)
  //   comunidad      -> tab "Comunidad" (ya existe, cruza de tab)
  //   pagos/mi-plan  -> pantallas todavía no construidas
  // Sin esta prop (preview standalone) tocar un acceso solo muestra un
  // aviso, salvo "Soporte" que ya tiene destino real (WhatsApp).
  onNavigate?: (target: PerfilAccesoDirecto) => void;
}

export default function PerfilMobileView({ onNavigate }: PerfilMobileViewProps) {
  const { user, updateAvatarUrl, logout } = useAuth();
  const { configuracion } = useConfiguracion();

  const [balances, setBalances] = useState<UserCredit[]>([]);
  const [clasesDelMes, setClasesDelMes] = useState(0);
  const [racha, setRacha] = useState(0);
  const [miembroDesde, setMiembroDesde] = useState<string | null>(null);
  const [totalXp, setTotalXp] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comingSoonLabel, setComingSoonLabel] = useState<string | null>(null);
  const comingSoonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [xpInfoVisible, setXpInfoVisible] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [balancesData, clases, desde, xp, fechasAsistencia] = await Promise.all([
        fetchUserBalances(user.id),
        fetchClasesDelMes(user.id),
        fetchMiembroDesde(user.id),
        fetchTotalXp(user.id),
        fetchFechasAsistencia(user.id),
      ]);
      setBalances(balancesData);
      setClasesDelMes(clases);
      setMiembroDesde(desde);
      setTotalXp(xp);
      setRacha(calcularRachaDias(fechasAsistencia));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu perfil.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // useFocusEffect (no useEffect a secas) -- React Navigation mantiene esta
  // pantalla MONTADA al cambiar de tab o volver de una pantalla empujada
  // (Progreso, Comunidad), así que un useEffect normal solo cargaba una vez
  // y nunca volvía a pedir el XP/racha/clases reales. Este era el bug real
  // detrás de "el Check-in Rápido del admin no se refleja en la PWA": no es
  // que el dato esté mal, es que esta pantalla no lo volvía a pedir al
  // volver a foco. Mismo criterio que ya usa HomeScreen.tsx.
  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

  useEffect(() => {
    return () => {
      if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current);
    };
  }, []);

  function handleTilePress(acceso: AccesoDirectoDef) {
    if (acceso.key === 'soporte') {
      Linking.openURL(CONTACTO_WHATSAPP);
      return;
    }
    if (onNavigate) {
      onNavigate(acceso.key);
      return;
    }
    setComingSoonLabel(`${acceso.label} -- todavía no está conectado al menú`);
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current);
    comingSoonTimer.current = setTimeout(() => setComingSoonLabel(null), 2400);
  }

  // Tocar el avatar deja cambiar la foto de perfil -- sube a Storage
  // (bucket 'avatars') y actualiza profiles.avatar_url; updateAvatarUrl()
  // refleja el cambio al instante en memoria (AuthContext) sin esperar un
  // refetch completo del perfil.
  async function handleAvatarPress() {
    if (!user || isUploadingAvatar) return;
    const disponible = await checkAvatarDisponible();
    if (!disponible) {
      Alert.alert('Función no disponible', 'La foto de perfil todavía no está activada. Probá de nuevo más tarde.');
      return;
    }
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso necesario', 'Habilitá el acceso a tus fotos para poder cambiar tu foto de perfil.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (resultado.canceled || !resultado.assets[0]) return;

    setIsUploadingAvatar(true);
    try {
      const url = await subirAvatarPerfil(user.id, resultado.assets[0].uri);
      updateAvatarUrl(url);
    } catch (err) {
      Alert.alert('No se pudo actualizar la foto', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  if (!user) return null;

  const resumenXp = calcularResumenXp(totalXp);

  const balancesConEstado = balances.map((b) => {
    const isMembership = b.discipline.kind === 'membership';
    const status: MembershipStatus = isMembership
      ? getExpiryStatus(b.expiresAt, configuracion.diasTolerancia)
      : getCreditsStatus(b.remainingCredits);
    return { balance: b, isMembership, status };
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Mi Perfil</Text>
        {/* Sutil a propósito -- el logout "completo" ya vive en Mis Datos
            (ProfileScreen.tsx); esto es solo un atajo rápido desde el hub,
            sin llamar la atención con color de peligro ni texto. */}
        <TouchableOpacity onPress={logout} hitSlop={10} accessibilityLabel="Cerrar sesión">
          <Ionicons name="log-out-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      {/* Header de atleta gamificado */}
      <View style={styles.athleteCard}>
        <Image source={require('../../../assets/perro.png')} style={styles.mascotWatermark} resizeMode="contain" />

        <View style={styles.athleteTopRow}>
          <TouchableOpacity
            onPress={handleAvatarPress}
            disabled={isUploadingAvatar}
            accessibilityLabel="Cambiar foto de perfil"
            style={styles.avatarTouchable}
          >
            <Avatar uri={user.avatarUrl} name={user.name} size={60} />
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
              {user.name}
            </Text>
            <View style={styles.levelRow}>
              <View style={styles.levelBadge}>
                <Ionicons name="flash" size={11} color={colors.onPrimary} />
                <Text style={styles.levelBadgeText}>NIVEL {resumenXp.nivel}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setXpInfoVisible(true)}
                hitSlop={8}
                accessibilityLabel="¿Cómo ganar XP?"
              >
                <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.xpBarWrap}>
          <View style={styles.xpBarTrack}>
            <View
              style={[styles.xpBarFill, { width: `${(resumenXp.xpEnNivel / XP_POR_NIVEL) * 100}%` }]}
            />
          </View>
          <Text style={styles.xpBarText}>
            {resumenXp.xpEnNivel} / {XP_POR_NIVEL} XP
          </Text>
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

      {/* Plan actual */}
      <View style={styles.sectionTitleRow}>
        <Ionicons name="ribbon-outline" size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>Plan actual</Text>
      </View>
      <View style={styles.planCard}>
        {isLoading && balances.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
        ) : balancesConEstado.length === 0 ? (
          <Text style={styles.planEmptyText}>Todavía no tenés ningún pack activo.</Text>
        ) : (
          balancesConEstado.map(({ balance: b, isMembership, status }) => (
            <View key={b.id} style={styles.planRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.planName} numberOfLines={1}>
                  {b.pack?.name ?? (isMembership ? 'Aparatos / Musculación' : b.discipline.name)}
                </Text>
                <Text style={styles.planDetail}>
                  {isMembership
                    ? b.expiresAt
                      ? `${status === 'vencido' ? 'Venció el' : 'Vence el'} ${formatLongDate(b.expiresAt)}`
                      : 'Sin fecha de vencimiento cargada'
                    : `${b.remainingCredits ?? 0}${b.pack?.credits ? ` de ${b.pack.credits}` : ''} clases restantes`}
                </Text>
              </View>
              <StatusBadge status={status} />
            </View>
          ))
        )}
      </View>

      {/* Accesos rápidos */}
      <View style={styles.sectionTitleRow}>
        <Ionicons name="apps-outline" size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>Accesos rápidos</Text>
      </View>
      <View style={styles.grid}>
        {ACCESOS_DIRECTOS.map((acceso) => (
          <TouchableOpacity
            key={acceso.key}
            style={styles.tile}
            activeOpacity={0.8}
            onPress={() => handleTilePress(acceso)}
          >
            <View style={styles.tileIconCircle}>
              <Ionicons name={acceso.icon} size={20} color={colors.primary} />
            </View>
            <Text style={styles.tileLabel} numberOfLines={2}>
              {acceso.label}
            </Text>
          </TouchableOpacity>
        ))}
        {/* Espaciador invisible: completa la grilla 3x3 (8 accesos + 1
            hueco) para que la última fila no quede desbalanceada. */}
        <View style={[styles.tile, styles.tileSpacer]} />
      </View>

      {!!comingSoonLabel && (
        <View style={styles.comingSoonToast}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.comingSoonText}>{comingSoonLabel}</Text>
        </View>
      )}

      <XpInfoModal visible={xpInfoVisible} onClose={() => setXpInfoVisible(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  error: { color: colors.danger, marginBottom: 12 },

  athleteCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  mascotWatermark: { position: 'absolute', right: -14, top: -14, width: 96, height: 96, opacity: 0.1 },
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

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },

  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  planEmptyText: { color: colors.textSecondary, fontSize: 13 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  planName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  planDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 },
  statusBadgeText: { fontSize: 10.5, fontWeight: '800' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    width: '31%',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  tileSpacer: { backgroundColor: 'transparent', borderWidth: 0 },
  tileIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '600', textAlign: 'center' },

  comingSoonToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  comingSoonText: { color: colors.textSecondary, fontSize: 11.5 },
});
