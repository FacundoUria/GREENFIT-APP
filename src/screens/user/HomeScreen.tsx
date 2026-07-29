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
import { useTicker } from '../../hooks/useTicker';
import CancelBookingModal from '../../components/CancelBookingModal';

interface NextBooking {
  classId: string;
  title: string;
  startTime: string;
  bookingDate: string; // "YYYY-MM-DD" — la ocurrencia puntual, para cancel_booking
}

// La próxima reserva confirmada del socio, la que viene más pronto.
//
// `classes.start_time` es un `time` (hora del día de una clase recurrente),
// no un timestamp — no se puede comparar directo contra `now()` (eso
// generaba "invalid input syntax for type time" al mandarle un ISO
// datetime completo). La ocurrencia puntual sale de combinar
// `bookings.booking_date` con `classes.start_time`, y el filtrado de
// "todavía no pasó" se hace en JS sobre ese datetime combinado.
async function fetchNextBooking(userId: string): Promise<NextBooking | null> {
  const todayStr = formatDateOnly(new Date());
  // Ordenamos solo por `booking_date` (columna real de `bookings`) — pedirle
  // a PostgREST que ordene por una columna de la tabla embebida (`classes`)
  // es innecesario acá y evitamos cualquier ambigüedad: la ocurrencia más
  // próxima se calcula en JS combinando fecha + hora de cada fila candidata.
  const { data, error } = await supabase
    .from('bookings')
    .select('class_id, booking_date, classes!inner(title, start_time)')
    .eq('user_id', userId)
    .gte('booking_date', todayStr)
    .order('booking_date', { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;

  const now = new Date();
  let closest: NextBooking | null = null;
  for (const row of data) {
    const gymClass = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    const startAt = combineDateAndTime(row.booking_date, gymClass.start_time);
    if (!startAt || new Date(startAt) <= now) continue;
    if (!closest || new Date(startAt) < new Date(closest.startTime)) {
      closest = { classId: row.class_id, title: gymClass.title, startTime: startAt, bookingDate: row.booking_date };
    }
  }
  return closest;
}

export default function HomeScreen({ navigation }: any) {
  useTicker();
  const { user } = useAuth();
  const [balances, setBalances] = useState<UserCredit[]>([]);
  const [nextBooking, setNextBooking] = useState<NextBooking | null>(null);
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
      const [balancesResult, bookingResult, packsResult] = await Promise.all([
        fetchUserBalances(user.id),
        fetchNextBooking(user.id),
        fetchPacks({ activeOnly: true }),
      ]);
      setBalances(balancesResult);
      setNextBooking(bookingResult);
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

  async function confirmCancel(reason: string) {
    if (!nextBooking) return;
    setIsCancelling(true);
    try {
      const { error: rpcError } = await supabase.rpc('cancel_booking', {
        p_class_id: nextBooking.classId,
        p_booking_date: nextBooking.bookingDate,
        p_reason: reason || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setShowCancelModal(false);
      await load();
    } catch (err) {
      Alert.alert('No se pudo cancelar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setIsCancelling(false);
    }
  }

  const nextBookingCountdown = nextBooking ? getCountdown(nextBooking.startTime) : null;

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
        const progress =
          !isMembership && b.pack.credits ? (b.remainingCredits ?? 0) / b.pack.credits : 0;
        return (
          <View key={b.id} style={[styles.card, { marginBottom: 12 }]}>
            <Text style={styles.packName}>{b.discipline.name}</Text>
            {isMembership ? (
              <Text style={styles.creditsLabel}>
                Vigente hasta {b.expiresAt ? new Date(b.expiresAt).toLocaleDateString('es-AR') : '—'}
              </Text>
            ) : (
              <>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                <View style={styles.creditsRow}>
                  <Text style={styles.creditsNumber}>{b.remainingCredits ?? 0}</Text>
                  <Text style={styles.creditsLabel}>de {b.pack.credits} clases restantes</Text>
                </View>
              </>
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
  error: { color: colors.danger, marginTop: 20 },
  packName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  progressTrack: { height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  creditsRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14, gap: 8 },
  creditsNumber: { color: colors.primary, fontSize: 32, fontWeight: '800' },
  creditsLabel: { color: colors.textSecondary, fontSize: 14 },
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
