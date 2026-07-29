import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { Pack, UserCredit } from '../../types';
import { fetchPacks, fetchUserBalances } from '../../lib/creditsApi';
import { combineDateAndTime, formatDateOnly } from '../../lib/classesApi';
import { createPaymentPreference } from '../../lib/paymentsApi';
import { formatCurrency } from '../../lib/currency';
import { formatClassTime, formatDayLabel, getCountdown } from '../../lib/classTime';
import { formatLongDate, getCreditsStatus, getExpiryStatus, MembershipStatus } from '../../lib/membershipStatus';
import { useTicker } from '../../hooks/useTicker';
import CancelBookingModal from '../../components/CancelBookingModal';

const CONTACTO_WHATSAPP = 'https://wa.me/5492617139662';

// Debe coincidir con la ventana de 2hs que aplica cancel_booking() en el
// servidor — esto es solo para avisar antes de confirmar, no la regla real.
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

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

interface NextBooking {
  classId: string;
  title: string;
  startTime: string;
  bookingDate: string; // "YYYY-MM-DD" — la ocurrencia puntual, para cancel_booking
}

// Todas las reservas confirmadas del socio que todavía no pasaron, ordenadas
// de la más próxima a la más lejana.
//
// `classes.start_time` es un `time` (hora del día de una clase recurrente),
// no un timestamp — no se puede comparar directo contra `now()` (eso
// generaba "invalid input syntax for type time" al mandarle un ISO
// datetime completo). La ocurrencia puntual sale de combinar
// `bookings.booking_date` con `classes.start_time`, y el filtrado de
// "todavía no pasó" se hace en JS sobre ese datetime combinado.
async function fetchUpcomingBookings(userId: string): Promise<NextBooking[]> {
  const todayStr = formatDateOnly(new Date());
  // Ordenamos solo por `booking_date` (columna real de `bookings`) — pedirle
  // a PostgREST que ordene por una columna de la tabla embebida (`classes`)
  // es innecesario acá y evitamos cualquier ambigüedad: el orden final sale
  // de combinar fecha + hora de cada fila candidata en JS.
  const { data, error } = await supabase
    .from('bookings')
    .select('class_id, booking_date, classes!inner(title, start_time)')
    .eq('user_id', userId)
    .gte('booking_date', todayStr)
    .order('booking_date', { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const now = new Date();
  const proximas: NextBooking[] = [];
  for (const row of data) {
    const gymClass = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    const startAt = combineDateAndTime(row.booking_date, gymClass.start_time);
    if (!startAt || new Date(startAt) <= now) continue;
    proximas.push({ classId: row.class_id, title: gymClass.title, startTime: startAt, bookingDate: row.booking_date });
  }
  return proximas.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

export default function HomeScreen({ navigation }: any) {
  useTicker();
  const { user } = useAuth();
  const [balances, setBalances] = useState<UserCredit[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<NextBooking[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [balancesResult, bookingsResult, packsResult] = await Promise.all([
        fetchUserBalances(user.id),
        fetchUpcomingBookings(user.id),
        fetchPacks({ activeOnly: true }),
      ]);
      setBalances(balancesResult);
      setUpcomingBookings(bookingsResult);
      setPacks(packsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu información.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // useFocusEffect (no useEffect+navigate) para que, al volver de la
  // WebView de pago, los balances se refresquen solos sin necesitar un
  // callback cruzado entre pantallas — ya cubre el fetch inicial también.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSelectPack(pack: Pack) {
    if (!user || buyingPackId) return;
    setBuyingPackId(pack.id);
    try {
      const preference = await createPaymentPreference({
        packId: pack.id,
        packName: pack.name,
        price: pack.price,
        userId: user.id,
      });
      setShowBuyModal(false);
      navigation.navigate('PaymentWebView', { initPoint: preference.initPoint });
    } catch (err) {
      Alert.alert('No se pudo iniciar el pago', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setBuyingPackId(null);
    }
  }

  const nextBooking = upcomingBookings[0] ?? null;
  const restoDeProximas = upcomingBookings.slice(1, 3);

  async function confirmCancel(reason: string) {
    if (!nextBooking) return;
    setIsCancelling(true);
    try {
      const { data: creditoReintegrado, error: rpcError } = await supabase.rpc('cancel_booking', {
        p_class_id: nextBooking.classId,
        p_booking_date: nextBooking.bookingDate,
        p_reason: reason || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setShowCancelModal(false);
      await load();
      Alert.alert(
        'Reserva cancelada',
        creditoReintegrado
          ? 'Te devolvimos el crédito.'
          : 'Como cancelaste con menos de 2 horas de anticipación, no se reintegra el crédito.'
      );
    } catch (err) {
      Alert.alert('No se pudo cancelar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setIsCancelling(false);
    }
  }

  const nextBookingCountdown = nextBooking ? getCountdown(nextBooking.startTime) : null;
  const isWithinCancelLimit =
    !!nextBooking && new Date(nextBooking.startTime).getTime() - Date.now() < TWO_HOURS_MS;

  // Cada balance se resuelve a su propio estado (una disciplina puede estar
  // vencida mientras otra sigue activa) -- "hayVencido" decide si mostramos
  // UNA sola vez el bloque de Renovar/Contactar al pie de la Hero Card, en
  // vez de repetirlo por cada fila.
  const balancesConEstado = balances.map((b) => {
    const isMembership = b.discipline.kind === 'membership';
    const status = isMembership ? getExpiryStatus(b.expiresAt) : getCreditsStatus(b.remainingCredits);
    return { balance: b, isMembership, status };
  });
  const hayVencido = balancesConEstado.some((b) => b.status === 'vencido');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20 }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hola, {user?.name} 👋</Text>
        </View>
        <TouchableOpacity
          style={styles.bellButton}
          onPress={() => navigation.navigate('Notifications')}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Hero Card: credencial + estado del pase, todo en un solo lugar en
          vez de una tarjeta por disciplina repitiendo el mismo borde/padding. */}
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroBrand}>
              GREEN<Text style={{ color: colors.primary }}>FIT</Text>
            </Text>
            <Text style={styles.heroName}>{user?.name}</Text>
          </View>
          <TouchableOpacity
            style={styles.heroQrButton}
            onPress={() => navigation.navigate('Credential')}
            aria-label="Ver mi credencial"
          >
            <Ionicons name="qr-code" size={20} color={colors.background} />
          </TouchableOpacity>
        </View>

        <View style={styles.heroDivider} />

        {isLoading && balances.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
        ) : balances.length === 0 ? (
          <Text style={styles.heroEmptyText}>Todavía no tenés ningún pack activo.</Text>
        ) : (
          balancesConEstado.map(({ balance: b, isMembership, status }) => (
            <View key={b.id} style={styles.heroPlanRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.heroPlanName}>
                  {isMembership ? 'Aparatos / Musculación' : b.discipline.name}
                </Text>
                <Text style={styles.heroPlanDetail}>
                  {isMembership
                    ? b.expiresAt
                      ? `${status === 'vencido' ? 'Venció el' : 'Vence el'} ${formatLongDate(b.expiresAt)}`
                      : 'Sin fecha de vencimiento cargada'
                    : b.pack
                      ? `${b.remainingCredits ?? 0} de ${b.pack.credits} clases restantes`
                      : `${b.remainingCredits ?? 0} clases restantes`}
                </Text>
              </View>
              <StatusBadge status={status} />
            </View>
          ))
        )}

        {hayVencido && (
          <View style={styles.heroVencidoActions}>
            <TouchableOpacity style={styles.renewButton} onPress={() => setShowBuyModal(true)}>
              <Text style={styles.renewButtonText}>Renovar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contactButton} onPress={() => Linking.openURL(CONTACTO_WHATSAPP)}>
              <Ionicons name="logo-whatsapp" size={14} color={colors.textPrimary} />
              <Text style={styles.contactButtonText}>Contactar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {!isLoading &&
        (nextBooking ? (
          <View style={styles.banner}>
            <View style={styles.bannerIcon}>
              <Ionicons name="calendar" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerLabel}>Tu próxima clase</Text>
              <Text style={styles.bannerValue}>
                {nextBooking.title} · {formatDayLabel(nextBooking.startTime)} {formatClassTime(nextBooking.startTime)} hs
              </Text>
              {nextBookingCountdown && !nextBookingCountdown.isPast && (
                <Text style={[styles.bannerCountdown, nextBookingCountdown.isSoon && styles.bannerCountdownSoon]}>
                  {nextBookingCountdown.label}
                </Text>
              )}
            </View>
            <TouchableOpacity style={styles.bannerCancel} onPress={() => setShowCancelModal(true)}>
              <Text style={styles.bannerCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.emptyBookingBanner} onPress={() => navigation.navigate('Reservas')}>
            <View style={styles.bannerIcon}>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerValue}>Todavía no tenés reservas</Text>
              <Text style={styles.bannerLabel}>Elegí tu próxima clase</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}

      {!isLoading && restoDeProximas.length > 0 && (
        <View style={styles.upcomingList}>
          {restoDeProximas.map((b) => (
            <View key={`${b.classId}-${b.bookingDate}`} style={styles.upcomingRow}>
              <View style={styles.upcomingDot} />
              <Text style={styles.upcomingText}>
                {b.title} · {formatDayLabel(b.startTime)} {formatClassTime(b.startTime)} hs
              </Text>
            </View>
          ))}
        </View>
      )}

      {!isLoading && (
        <View style={styles.buyCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.buyCardTitle}>Mi Pase</Text>
            <Text style={styles.buyCardText}>Sumá créditos o renová tu pase cuando quieras.</Text>
          </View>
          <TouchableOpacity style={styles.buyButton} onPress={() => setShowBuyModal(true)}>
            <Text style={styles.buyButtonText}>Comprar</Text>
          </TouchableOpacity>
        </View>
      )}

      <CancelBookingModal
        visible={showCancelModal}
        className={nextBooking?.title ?? ''}
        isSubmitting={isCancelling}
        withinCancelLimit={isWithinCancelLimit}
        onClose={() => setShowCancelModal(false)}
        onConfirm={confirmCancel}
      />

      <Modal
        visible={showBuyModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowBuyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Elegí tu pack</Text>
              <TouchableOpacity onPress={() => setShowBuyModal(false)}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {packs.length === 0 && <Text style={styles.text}>No hay packs disponibles todavía.</Text>}

            <ScrollView>
              {packs.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.packRow}
                  disabled={!!buyingPackId}
                  onPress={() => handleSelectPack(p)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.packRowName}>{p.name}</Text>
                    <Text style={styles.packRowSub}>
                      {p.discipline.name} ·{' '}
                      {p.discipline.kind === 'membership' ? `${p.durationDays} días` : `${p.credits} créditos`}
                    </Text>
                  </View>
                  {buyingPackId === p.id ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Text style={styles.packRowPrice}>{formatCurrency(p.price)}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: colors.danger, marginBottom: 12 },
  text: { color: colors.textSecondary, lineHeight: 20 },

  // Hero Card
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center' },
  heroBrand: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, letterSpacing: 0.5 },
  heroName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  heroQrButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDivider: { height: 1, backgroundColor: colors.surfaceAlt, marginVertical: 16 },
  heroEmptyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  heroPlanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  heroPlanName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  heroPlanDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  heroVencidoActions: { flexDirection: 'row', gap: 8, marginTop: 16 },

  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },

  renewButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  renewButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(37, 211, 102, 0.15)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactButtonText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  emptyBookingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.surfaceAlt,
  },
  bannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 2 },
  bannerValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  bannerCountdown: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  bannerCountdownSoon: { color: colors.primary, fontWeight: '700' },
  bannerCancel: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.danger },
  bannerCancelText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  upcomingList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    gap: 10,
  },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upcomingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textSecondary },
  upcomingText: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  buyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buyCardTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  buyCardText: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  buyButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  buyButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  packRowName: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  packRowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  packRowPrice: { color: colors.primary, fontWeight: '700', fontSize: 15 },
});
