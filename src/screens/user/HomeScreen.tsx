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

// Debe coincidir con la ventana de 2hs que aplica cancel_booking() en el
// servidor — esto es solo para avisar antes de confirmar, no la regla real.
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

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

      {isLoading && balances.length === 0 && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {!isLoading && !error && balances.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.text}>Todavía no tenés ningún pack activo.</Text>
        </View>
      )}

      {balances.map((b) => {
        const isMembership = b.discipline.kind === 'membership';
        const status = isMembership ? getExpiryStatus(b.expiresAt) : getCreditsStatus(b.remainingCredits);
        const progress =
          !isMembership && b.pack.credits ? (b.remainingCredits ?? 0) / b.pack.credits : 0;

        return (
          <View
            key={b.id}
            style={[
              styles.card,
              status === 'vencido' && styles.cardVencido,
              status === 'por_vencer' && styles.cardPorVencer,
              { marginBottom: 12 },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <Text style={styles.packName}>{b.discipline.name}</Text>
              <StatusBadge status={status} />
            </View>

            {isMembership ? (
              <Text style={styles.expiryText}>
                {b.expiresAt
                  ? `${status === 'vencido' ? 'Venció el' : 'Vence el'} ${formatLongDate(b.expiresAt)}`
                  : 'Sin fecha de vencimiento cargada'}
              </Text>
            ) : (
              <>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${progress * 100}%` },
                      status === 'vencido' && styles.progressFillVencido,
                    ]}
                  />
                </View>
                <View style={styles.creditsRow}>
                  <Text style={styles.creditsNumber}>{b.remainingCredits ?? 0}</Text>
                  <Text style={styles.creditsLabel}>de {b.pack.credits} clases restantes</Text>
                </View>
              </>
            )}

            {status === 'vencido' && (
              <View style={styles.vencidoActions}>
                <Text style={styles.vencidoText}>
                  {isMembership
                    ? 'Tu cuota está vencida. Renovala para seguir entrenando.'
                    : 'Te quedaste sin clases de este pack.'}
                </Text>
                <View style={styles.vencidoButtonsRow}>
                  <TouchableOpacity style={styles.renewButton} onPress={() => setShowBuyModal(true)}>
                    <Text style={styles.renewButtonText}>Renovar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.contactButton}
                    onPress={() => Linking.openURL(CONTACTO_WHATSAPP)}
                  >
                    <Ionicons name="logo-whatsapp" size={14} color={colors.textPrimary} />
                    <Text style={styles.contactButtonText}>Contactar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}

      {!isLoading && (
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Ionicons name="calendar" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerLabel}>Tu próxima clase</Text>
            {nextBooking ? (
              <>
                <Text style={styles.bannerValue}>
                  {nextBooking.title} · {formatDayLabel(nextBooking.startTime)} {formatClassTime(nextBooking.startTime)} hs
                </Text>
                {nextBookingCountdown && !nextBookingCountdown.isPast && (
                  <Text
                    style={[styles.bannerCountdown, nextBookingCountdown.isSoon && styles.bannerCountdownSoon]}
                  >
                    {nextBookingCountdown.label}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.bannerValue}>No tenés reservas próximas.</Text>
            )}
          </View>
          {nextBooking && (
            <TouchableOpacity style={styles.bannerCancel} onPress={() => setShowCancelModal(true)}>
              <Text style={styles.bannerCancelText}>Cancelar</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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

      <Text style={styles.sectionTitle}>Accesos rápidos</Text>
      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate('Reservas')}>
          <Ionicons name="calendar-outline" size={22} color={colors.primary} />
          <Text style={styles.quickButtonText}>Reservar clase</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate('Credential')}>
          <Ionicons name="qr-code-outline" size={22} color={colors.primary} />
          <Text style={styles.quickButtonText}>Mi Credencial</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickButton}
          onPress={() => navigation.navigate('Notifications')}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.primary} />
          <Text style={styles.quickButtonText}>Notificaciones</Text>
        </TouchableOpacity>
      </View>

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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  cardVencido: { borderColor: 'rgba(224, 83, 83, 0.4)' },
  cardPorVencer: { borderColor: 'rgba(224, 185, 83, 0.4)' },
  error: { color: colors.danger, marginTop: 20 },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  packName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  expiryText: { color: colors.textSecondary, fontSize: 14 },
  progressTrack: { height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  progressFillVencido: { backgroundColor: colors.danger },
  creditsRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14, gap: 8 },
  creditsNumber: { color: colors.primary, fontSize: 32, fontWeight: '800' },
  creditsLabel: { color: colors.textSecondary, fontSize: 14 },
  vencidoActions: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  vencidoText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  vencidoButtonsRow: { flexDirection: 'row', gap: 8 },
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
  text: { color: colors.textSecondary, lineHeight: 20 },
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
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 28, marginBottom: 8 },
  quickRow: { flexDirection: 'row', gap: 12 },
  quickButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  quickButtonText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
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
