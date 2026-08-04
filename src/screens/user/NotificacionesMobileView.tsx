import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, SectionList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { NotificationAudience } from '../../types';

// Vista nueva y paralela a NotificationsScreen (Módulo 4 del rediseño) --
// mismo criterio que Agenda/Perfil: no toca esa pantalla, se engancha en su
// lugar desde la navegación (ver RootStack.tsx) una vez verificada.
//
// Dos cosas que pide la spec (leído/no-leído, categoría por color) NO
// existen como columnas en `notifications` todavía -- no hay `read_at` ni
// `tipo`/`categoria` en el schema (ver backend/supabase-schema.sql). En vez
// de inventar una tabla nueva para esto:
//   - "Leída" se trackea LOCAL, por dispositivo, en AsyncStorage -- es dato
//     real (lo que este dispositivo efectivamente vio), no un mock, solo
//     que no sincroniza entre dispositivos del mismo socio todavía.
//   - La categoría (verde/morado/naranja/azul/rojo) se infiere del
//     título/cuerpo con un clasificador simple por palabras clave, con
//     "novedad" (azul) como bucket genérico de fallback. Es una heurística
//     explícita, no aleatoria -- candidata a reemplazarse el día que el
//     panel admin tenga un selector real de "tipo de notificación" al crear
//     el anuncio (Anunciar.jsx en el panel web).

export type NotifCategoria = 'reserva' | 'recordatorio' | 'vencimiento' | 'novedad' | 'promocion';

interface CategoriaMeta {
  label: string;
  color: string;
  bg: string;
  icon: keyof typeof Ionicons.glyphMap;
  importante: boolean;
}

// Los colores de reserva/vencimiento/promoción reusan tokens de marca ya
// existentes (colors.primary/warning/danger) -- morado y azul no tienen
// token propio en theme/colors.ts, van como constantes locales de esta
// vista (mismo criterio que disciplineColors.ts con ciano/magenta).
const CATEGORIA_META: Record<NotifCategoria, CategoriaMeta> = {
  reserva: { label: 'Reserva', color: colors.primary, bg: 'rgba(0, 255, 56, 0.15)', icon: 'checkmark-circle', importante: false },
  recordatorio: { label: 'Recordatorio', color: '#B388FF', bg: 'rgba(179, 136, 255, 0.15)', icon: 'alarm', importante: false },
  vencimiento: { label: 'Vencimiento', color: colors.warning, bg: 'rgba(224, 185, 83, 0.15)', icon: 'card', importante: true },
  novedad: { label: 'Novedad', color: '#4FC3F7', bg: 'rgba(79, 195, 247, 0.15)', icon: 'megaphone', importante: false },
  promocion: { label: 'Promoción', color: colors.danger, bg: 'rgba(224, 83, 83, 0.15)', icon: 'flame', importante: true },
};

const KEYWORD_RULES: Array<{ categoria: NotifCategoria; pattern: RegExp }> = [
  { categoria: 'reserva', pattern: /reserv|confirmad|anotaste|cupo confirmado/i },
  { categoria: 'recordatorio', pattern: /recordatorio|empieza en|en breve|te esperamos|no te olvides/i },
  { categoria: 'vencimiento', pattern: /venc|cuota|deuda|renov|crédito/i },
  { categoria: 'promocion', pattern: /promo|descuento|oferta|urgente|últimos lugares|2x1/i },
  { categoria: 'novedad', pattern: /wod|noticia|novedad|nuevo horario|comunicado/i },
];

interface RawNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  audienceType: NotificationAudience;
}

interface SmartNotification extends RawNotification {
  categoria: NotifCategoria;
  leida: boolean;
}

export function classify(n: RawNotification): NotifCategoria {
  // Un aviso a deudores es, por definición, sobre créditos/cuota vencida --
  // no hace falta ni mirar el texto.
  if (n.audienceType === 'debtors') return 'vencimiento';
  const text = `${n.title} ${n.body}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) return rule.categoria;
  }
  return 'novedad'; // bucket genérico de anuncios/noticias sin match
}

// La policy notifications_select_recipient ya filtra las filas: solo trae
// las que son 'all', las dirigidas a este user_id, las de una clase donde
// tiene reserva, o las de deudores si a este socio se le acabaron los
// créditos -- mismo query que NotificationsScreen.tsx, sumando
// audience_type (que ese archivo no necesitaba) para poder clasificar.
async function fetchNotifications(): Promise<RawNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, created_at, audience_type')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    createdAt: n.created_at,
    audienceType: n.audience_type as NotificationAudience,
  }));
}

function leidasKey(userId: string): string {
  return `greenfit:notif-leidas:${userId}`;
}

async function loadLeidasIds(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(leidasKey(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveLeidasIds(userId: string, ids: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(leidasKey(userId), JSON.stringify(Array.from(ids)));
  } catch {
    // Best-effort: si falla el guardado, en el peor caso una notificación ya
    // vista vuelve a aparecer como no leída. No rompe nada crítico.
  }
}

type Bucket = 'HOY' | 'AYER' | 'ESTA SEMANA' | 'ANTERIORES';
const BUCKET_ORDER: Bucket[] = ['HOY', 'AYER', 'ESTA SEMANA', 'ANTERIORES'];

export function getBucket(createdAt: string): Bucket {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(createdAt))) / 86_400_000);
  if (diffDays <= 0) return 'HOY';
  if (diffDays === 1) return 'AYER';
  if (diffDays <= 7) return 'ESTA SEMANA';
  return 'ANTERIORES';
}

function groupByBucket(items: SmartNotification[]): { title: Bucket; data: SmartNotification[] }[] {
  const map = new Map<Bucket, SmartNotification[]>();
  for (const item of items) {
    const bucket = getBucket(item.createdAt);
    if (!map.has(bucket)) map.set(bucket, []);
    map.get(bucket)!.push(item);
  }
  return BUCKET_ORDER.filter((b) => map.has(b)).map((title) => ({ title, data: map.get(title)! }));
}

export function formatCardTime(createdAt: string, bucket: Bucket): string {
  const date = new Date(createdAt);
  if (bucket === 'HOY' || bucket === 'AYER') {
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

type Filtro = 'todas' | 'no-leidas' | 'importantes';

const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'no-leidas', label: 'No leídas' },
  { key: 'importantes', label: 'Importantes' },
];

const EMPTY_LABEL: Record<Filtro, string> = {
  todas: 'No tenés notificaciones todavía.',
  'no-leidas': 'Estás al día -- no tenés notificaciones sin leer.',
  importantes: 'No tenés notificaciones importantes.',
};

export default function NotificacionesMobileView() {
  const { user } = useAuth();
  const [items, setItems] = useState<SmartNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [raw, leidas] = await Promise.all([fetchNotifications(), loadLeidasIds(user.id)]);
      setItems(raw.map((n) => ({ ...n, categoria: classify(n), leida: leidas.has(n.id) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las notificaciones.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  async function markAsRead(id: string) {
    if (!user) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    const leidas = await loadLeidasIds(user.id);
    leidas.add(id);
    await saveLeidasIds(user.id, leidas);
  }

  async function markAllAsRead() {
    if (!user) return;
    setItems((prev) => prev.map((n) => ({ ...n, leida: true })));
    await saveLeidasIds(user.id, new Set(items.map((n) => n.id)));
  }

  const unreadCount = items.filter((n) => !n.leida).length;

  const filtered = items.filter((n) => {
    if (filtro === 'no-leidas') return !n.leida;
    if (filtro === 'importantes') return CATEGORIA_META[n.categoria].importante;
    return true;
  });
  const sections = groupByBucket(filtered);

  return (
    <View style={styles.container}>
      <View style={styles.tabsRow}>
        {FILTROS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.tab, filtro === f.key && styles.tabActive]}
            onPress={() => setFiltro(f.key)}
          >
            <Text style={[styles.tabText, filtro === f.key && styles.tabTextActive]} numberOfLines={1}>
              {f.label}
              {f.key === 'no-leidas' && unreadCount > 0 ? ` (${unreadCount})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {unreadCount > 0 && (
        <TouchableOpacity style={styles.markAllRow} onPress={markAllAsRead}>
          <Ionicons name="checkmark-done-outline" size={14} color={colors.primary} />
          <Text style={styles.markAllText}>Marcar todas como leídas</Text>
        </TouchableOpacity>
      )}

      {isLoading && items.length === 0 && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!isLoading && !error && sections.length === 0 && <Text style={styles.empty}>{EMPTY_LABEL[filtro]}</Text>}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item, section }) => {
          const meta = CATEGORIA_META[item.categoria];
          return (
            <TouchableOpacity
              testID={`notif-card-${item.id}`}
              style={[styles.card, !item.leida && styles.cardUnread]}
              activeOpacity={0.85}
              onPress={() => !item.leida && markAsRead(item.id)}
            >
              {!item.leida && <View style={styles.unreadDot} />}
              <View style={[styles.iconCircle, { backgroundColor: meta.bg, borderColor: `${meta.color}55` }]}>
                <Ionicons name={meta.icon} size={16} color={meta.color} />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.title} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.time}>{formatCardTime(item.createdAt, section.title as Bucket)}</Text>
                </View>
                <Text style={styles.body} numberOfLines={3}>
                  {item.body}
                </Text>
                <View style={[styles.categoriaChip, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.categoriaChipText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '700' },
  tabTextActive: { color: colors.onPrimary },
  markAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  markAllText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 12 },
  empty: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 20, textAlign: 'center' },
  listContent: { padding: 16, paddingTop: 4 },
  sectionHeader: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 14,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  cardUnread: { borderColor: colors.primary },
  unreadDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  time: { color: colors.textSecondary, fontSize: 11 },
  body: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
  categoriaChip: { alignSelf: 'flex-start', borderRadius: 20, paddingVertical: 3, paddingHorizontal: 9, marginTop: 8 },
  categoriaChipText: { fontSize: 10, fontWeight: '800' },
});
