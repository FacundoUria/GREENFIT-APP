import React, { useCallback, useEffect, useState } from 'react';
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
import { fetchPacks, fetchUserBalances, syncMyMembership } from '../../lib/creditsApi';
import { combineDateAndTime, formatDateOnly } from '../../lib/classesApi';
import { createPaymentPreference } from '../../lib/paymentsApi';
import { formatCurrency } from '../../lib/currency';
import { formatClassTime, formatCountdownEmpieza, formatDayLabel, getCountdown } from '../../lib/classTime';
import { formatLongDate, getCreditsStatus, getExpiryStatus, MembershipStatus } from '../../lib/membershipStatus';
import { useTicker } from '../../hooks/useTicker';
import CancelBookingModal from '../../components/CancelBookingModal';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { fetchUnreadNotificationCount } from '../../lib/notificationsBadge';
import AsistenciaHoyStatus from '../../components/AsistenciaHoyStatus';
import XpProgressRing from '../../components/XpProgressRing';
import XpInfoModal from '../../components/XpInfoModal';
import AthleteProfileCard from '../../components/AthleteProfileCard';
import GoogleReviewCard from '../../components/GoogleReviewCard';
import GlobalAlertBanner from '../../components/GlobalAlertBanner';
import {
  fetchTotalXp,
  calcularResumenXp,
  fetchFechasAsistencia,
  calcularRachaDias,
  fetchClasesDelMes,
  fetchMiembroDesde,
  XP_POR_NIVEL,
} from '../../lib/xpApi';
import { useAvatarUpload } from '../../hooks/useAvatarUpload';

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
  const { user, updateAvatarUrl } = useAuth();
  const { configuracion } = useConfiguracion();
  const [balances, setBalances] = useState<UserCredit[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<NextBooking[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalXp, setTotalXp] = useState(0);
  const [xpInfoVisible, setXpInfoVisible] = useState(false);
  // Mismos 3 datos que ya mostraba la tarjeta de perfil gamificada en Mi
  // Perfil (racha/miembro desde/clases del mes) -- ahora también arriba de
  // todo acá, así que hacen falta también en el load() de esta pantalla.
  const [racha, setRacha] = useState(0);
  const [miembroDesde, setMiembroDesde] = useState<string | null>(null);
  const [clasesDelMes, setClasesDelMes] = useState(0);
  const { isUploadingAvatar, handleAvatarPress } = useAvatarUpload(user?.id, updateAvatarUrl);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      // Antes de leer el balance, se intenta autocurar server-side (rellena
      // huecos genuinos en `user_credits` si el alta/edición del socio en el
      // panel nunca llegó a sincronizarlos) -- tiene que ir ANTES y esperado,
      // no en el mismo Promise.all, porque si no fetchUserBalances puede
      // correr antes de que la reparación termine de insertar.
      await syncMyMembership();

      const [balancesResult, bookingsResult, packsResult, xpResult, clasesResult, desdeResult, fechasAsistencia] =
        await Promise.all([
          fetchUserBalances(user.id),
          fetchUpcomingBookings(user.id),
          fetchPacks({ activeOnly: true }),
          fetchTotalXp(user.id),
          fetchClasesDelMes(user.id),
          fetchMiembroDesde(user.id),
          fetchFechasAsistencia(user.id),
        ]);
      setBalances(balancesResult);
      setUpcomingBookings(bookingsResult);
      setPacks(packsResult);
      setTotalXp(xpResult);
      setClasesDelMes(clasesResult);
      setMiembroDesde(desdeResult);
      setRacha(calcularRachaDias(fechasAsistencia));
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

  // Efecto aparte e independiente del de arriba -- así el contador del
  // badge se refresca solo al volver de la pantalla de Notificaciones (ahí
  // es donde cambia el estado de leído/no leído) sin tocar el `load` de
  // balances/reservas que ya funciona.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      fetchUnreadNotificationCount(user.id)
        .then(setUnreadCount)
        .catch((err) => console.error('No se pudo calcular el contador de notificaciones:', err.message));
    }, [user])
  );

  // Suscripción en vivo a user_credits -- cuando el Admin ajusta créditos o
  // vencimiento desde el panel (Check-in Rápido, "Registrar Pago", el
  // stepper de la tabla de Socios), esto refresca el balance ACÁ MISMO, al
  // instante, sin que el socio tenga que salir de la pantalla y volver a
  // entrar (el useFocusEffect de arriba ya cubre ESE caso, pero no el de
  // "la pantalla ya está abierta y el Admin edita en paralelo"). Mismo
  // patrón que useNotificationSubscription.ts: el evento de Realtime no
  // valida RLS por sí solo, así que no se confía en el payload crudo -- se
  // usa solo como disparador para volver a pedir el balance real vía
  // `load()` (esa sí, autenticada y sujeta a RLS). `filter` acota el ruido
  // a la fila de este usuario, es una optimización de red, no el límite de
  // seguridad real (que sigue siendo la RLS del select en `load()`).
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`user-credits-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_credits', filter: `user_id=eq.${user.id}` },
        () => {
          load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, load]);

  async function handleSelectPack(pack: Pack) {
    if (!user || buyingPackId) return;
    setBuyingPackId(pack.id);
    try {
      const preference = await createPaymentPreference({ packId: pack.id, userId: user.id });
      setShowBuyModal(false);
      // packId/userId viajan también acá (no solo en el pedido a la Edge
      // Function) -- PaymentWebViewScreen los necesita para poder generar
      // una preferencia NUEVA si el socio toca "Reintentar" tras un pago
      // rechazado, sin volver a esta pantalla ni reabrir el modal.
      navigation.navigate('PaymentWebView', { initPoint: preference.initPoint, packId: pack.id, userId: user.id });
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
  const cancelLimitMs = configuracion.limiteCancelacionMinutos * 60 * 1000;
  const isWithinCancelLimit =
    !!nextBooking && new Date(nextBooking.startTime).getTime() - Date.now() < cancelLimitMs;

  // Cada balance se resuelve a su propio estado (una disciplina puede estar
  // vencida mientras otra sigue activa) -- "hayVencido" decide si mostramos
  // UNA sola vez el bloque de Renovar/Contactar al pie de la Hero Card, en
  // vez de repetirlo por cada fila.
  const balancesConEstado = balances.map((b) => {
    const isMembership = b.discipline.kind === 'membership';
    const status = isMembership
      ? getExpiryStatus(b.expiresAt, configuracion.diasTolerancia)
      : getCreditsStatus(b.remainingCredits);
    return { balance: b, isMembership, status };
  });
  const hayVencido = balancesConEstado.some((b) => b.status === 'vencido');
  const resumenXp = calcularResumenXp(totalXp);

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
          {unreadCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Tarjeta de perfil gamificada -- misma que ya vivía en Mi Perfil
          (avatar, nivel, XP, mascota, racha/miembro desde/clases), ahora
          también arriba de todo en Inicio. Mi Perfil se deja intacto (sigue
          teniendo la suya): esto es una segunda vidriera del mismo dato
          real, no un reemplazo. */}
      {!!user && (
        <View style={styles.athleteCardWrap}>
          <AthleteProfileCard
            name={user.name}
            avatarUrl={user.avatarUrl}
            nivel={resumenXp.nivel}
            xpEnNivel={resumenXp.xpEnNivel}
            racha={racha}
            miembroDesde={miembroDesde}
            clasesDelMes={clasesDelMes}
            isUploadingAvatar={isUploadingAvatar}
            onAvatarPress={handleAvatarPress}
            onXpInfoPress={() => setXpInfoVisible(true)}
          />
        </View>
      )}

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

      {/* Widget "Progreso Diario & Check-In" -- reemplaza al botón suelto de
          antes: ahora vive con el anillo de XP hacia el próximo nivel y el
          acceso a las reglas, todo en un solo lugar del Dashboard. */}
      {user && (
        <View style={styles.progressCard}>
          <View style={styles.progressHeaderRow}>
            <Text style={styles.progressTitle}>Progreso Diario</Text>
            <TouchableOpacity
              onPress={() => setXpInfoVisible(true)}
              hitSlop={8}
              accessibilityLabel="¿Cómo ganar XP?"
            >
              <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.progressRingRow}>
            <XpProgressRing
              xpEnNivel={resumenXp.xpEnNivel}
              xpParaNivel={XP_POR_NIVEL}
              nivel={resumenXp.nivel}
              size={78}
              strokeWidth={7}
            />
            <Text style={styles.progressHint}>
              Te faltan <Text style={styles.progressHintStrong}>{resumenXp.xpParaSubir} XP</Text> para el próximo
              nivel.
            </Text>
          </View>
          {/* Solo lectura -- el socio ya no autoreporta su asistencia, la
              acredita el Admin (Check-in Rápido o clase confirmada). El
              useFocusEffect de arriba ya vuelve a pedir el XP total al
              volver a esta pantalla, así que este estado se pone al día
              solo apenas el Admin lo acredita, sin ninguna acción acá. */}
          <AsistenciaHoyStatus userId={user.id} />
        </View>
      )}

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
                  {formatCountdownEmpieza(nextBookingCountdown)}
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

      <GoogleReviewCard />

      <CancelBookingModal
        visible={showCancelModal}
        className={nextBooking?.title ?? ''}
        isSubmitting={isCancelling}
        withinCancelLimit={isWithinCancelLimit}
        limiteMinutos={configuracion.limiteCancelacionMinutos}
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

              {!!configuracion.aliasCvu && (
                <View style={styles.transferBox}>
                  <Text style={styles.transferTitle}>¿Preferís transferencia?</Text>
                  <View style={styles.transferRow}>
                    <Text style={styles.transferLabel}>Alias / CVU</Text>
                    <Text style={styles.transferValue}>{configuracion.aliasCvu}</Text>
                  </View>
                  {!!configuracion.titularCuenta && (
                    <View style={styles.transferRow}>
                      <Text style={styles.transferLabel}>Titular</Text>
                      <Text style={styles.transferValue}>{configuracion.titularCuenta}</Text>
                    </View>
                  )}
                  <Text style={styles.transferHint}>
                    Hacé la transferencia y mandanos el comprobante para acreditarte el pack.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <XpInfoModal visible={xpInfoVisible} onClose={() => setXpInfoVisible(false)} />
      <GlobalAlertBanner activa={configuracion.alertaActiva} mensaje={configuracion.alertaMensaje} />
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
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: { color: colors.white, fontSize: 9.5, fontWeight: '800' },
  error: { color: colors.danger, marginBottom: 12 },
  text: { color: colors.textSecondary, lineHeight: 20 },

  athleteCardWrap: { marginBottom: 16 },

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

  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  progressHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTitle: { color: colors.textPrimary, fontSize: 14.5, fontWeight: '700' },
  progressRingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14, marginBottom: 4 },
  progressHint: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  progressHintStrong: { color: colors.primary, fontWeight: '800' },

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
  transferBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  transferTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  transferRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  transferLabel: { color: colors.textSecondary, fontSize: 12.5 },
  transferValue: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '600' },
  transferHint: { color: colors.textSecondary, fontSize: 11, marginTop: 10, lineHeight: 15 },
});
