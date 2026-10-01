import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../../theme/colors';
import { getDisciplineStyle } from '../../theme/disciplineColors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { loadClassesForDate, formatDateOnly, ClassWithBookings as BaseClassWithBookings } from '../../lib/classesApi';
import { fetchClosedDays, ClosedDay } from '../../lib/closedDaysApi';
import { fetchUserBalances } from '../../lib/creditsApi';
import { formatClassTime, getCountdown } from '../../lib/classTime';
import { useTicker } from '../../hooks/useTicker';
import { withTimeout } from '../../lib/withTimeout';
import CancelBookingModal, { formatLimite } from '../../components/CancelBookingModal';
import DaySelector from '../../components/DaySelector';
import ReservaConfirmadaModal from '../../components/ReservaConfirmadaModal';
import BookingConfirmModal from '../../components/BookingConfirmModal';
import ConsentModal from '../../components/ConsentModal';
import MessageModal, { MessageModalContent } from '../../components/MessageModal';
import { fetchTieneConsentimientoVigente, registrarConsentimiento } from '../../lib/consentApi';
import { capitalize, formatFechaReserva } from '../../lib/dateFormat';
import Avatar from '../../components/Avatar';
import { mockup, alfa, colorDisciplinaMockup, fuentes, useFuentesMockup } from '../../theme/agendaMockup';

// Timeout de red para reservar/cancelar: el cliente de Supabase no tiene
// uno por defecto -- si la conexión se cuelga a mitad de la request (wifi
// del gimnasio), la promesa quedaba pendiente para siempre y el spinner de
// la tarjeta nunca se cerraba (bug real reportado: "se queda pensando y
// nunca concreta la inscripción"). Ver withTimeout.ts.
const RPC_TIMEOUT_MS = 20_000;
const RPC_TIMEOUT_MESSAGE = 'Esto está tardando demasiado. Revisá tu conexión e intentá de nuevo.';

type AgendaClass = BaseClassWithBookings & { isBooked: boolean };

// Vista nueva y paralela a BookingScreen (Módulo 2 del rediseño) -- no
// reemplaza ni engancha en la navegación real todavía. Reusa exactamente la
// misma lógica funcional (loadClassesForDate/DaySelector) y solo agrega la
// capa visual: código de color por disciplina, agrupado temporal (HOY /
// MAÑANA / PRÓXIMOS DÍAS) y badges de estado. book_class/cancel_booking se
// llaman igual que en Reservas -- al confirmar reutiliza el mismo
// ReservaConfirmadaModal del Módulo 1.
//
// `loadAgendaClasses`/`fetchCreditsByDiscipline` duplican a propósito la
// lógica privada de BookingScreen.tsx (misma query, mismo criterio) en vez
// de tocar ese archivo -- una vez que esta vista esté verificada y
// enganchada al tab real, es candidata a extraerse a un hook compartido
// (`useClassBooking`) para las dos pantallas.

async function loadAgendaClasses(userId: string, date: Date): Promise<AgendaClass[]> {
  const classes = await loadClassesForDate(date);
  if (classes.length === 0) return [];

  const { data: myBookings, error } = await supabase
    .from('bookings')
    .select('class_id')
    .eq('user_id', userId)
    .eq('booking_date', classes[0].occurrenceDate)
    .in('class_id', classes.map((c) => c.id));
  if (error) throw new Error(error.message);

  const bookedIds = new Set((myBookings ?? []).map((b) => b.class_id));
  return classes.map((c) => ({ ...c, isBooked: bookedIds.has(c.id) }));
}

async function fetchCreditsByDiscipline(userId: string): Promise<Map<string, number>> {
  const balances = await fetchUserBalances(userId);
  const map = new Map<string, number>();
  for (const b of balances) map.set(b.discipline.id, b.remainingCredits ?? 0);
  return map;
}

// Gate de reservas (aparte del gate de "perfil obligatorio" de
// ProfileStack.tsx, que bloquea la pestaña Perfil entera si faltan
// domicilio/teléfono/etc. -- ese no se toca, este es uno nuevo y más
// puntual): sin nombre Y teléfono de contacto de emergencia, no se puede
// reservar una clase. A propósito una consulta EN VIVO acá (no un campo
// cacheado en el user de AuthContext) -- si el socio recién completó el
// dato en "Mis datos" y vuelve a Agenda, tiene que verse desbloqueado sin
// necesidad de cerrar sesión y volver a entrar.
//
// Fail-open ante un error real de red/consulta -- a diferencia de otras
// columnas "nuevas" de este archivo (avatar_url, domicilio, etc.) estas dos
// ya existen hace tiempo (AuthContext.tsx/ProfileScreen.tsx ya las leen),
// así que un error acá es un problema de conexión puntual, no una
// migración pendiente -- no tiene sentido bloquear TODA la agenda por eso.
async function fetchTieneContactoEmergencia(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('emergency_contact_name, emergency_contact_phone')
    .eq('id', userId)
    .single();
  if (error || !data) {
    console.warn('[GreenFit] No se pudo verificar el contacto de emergencia:', error?.message);
    return true;
  }
  return !!data.emergency_contact_name?.trim() && !!data.emergency_contact_phone?.trim();
}

export default function AgendaMobileView({ navigation }: any) {
  useTicker();
  useFuentesMockup();
  const { user } = useAuth();
  const { configuracion } = useConfiguracion();
  const cancelLimitMs = configuracion.limiteCancelacionMinutos * 60 * 1000;

  const [selectedDate, setSelectedDate] = useState(new Date());
  // La lista se guarda JUNTO con el día al que pertenece. En pantalla solo se
  // usan sus tarjetas si ese día es el elegido ahora (ver `classes` más
  // abajo): así nunca se dibuja -- ni por un cuadro -- una tarjeta de otro día
  // bajo el encabezado del día nuevo.
  const [lista, setLista] = useState<{ fecha: string | null; items: AgendaClass[] }>({ fecha: null, items: [] });
  const [creditsByDiscipline, setCreditsByDiscipline] = useState<Map<string, number>>(new Map());
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AgendaClass | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<AgendaClass | null>(null);
  // Paso de confirmación antes de reservar (evita el one-tap accidental) +
  // reemplazo de Alert.alert (no-op en Web, ver crossPlatformAlert.ts) para
  // los mensajes de error/resultado de reservar y cancelar.
  const [confirmTarget, setConfirmTarget] = useState<AgendaClass | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [messageModal, setMessageModal] = useState<MessageModalContent | null>(null);
  // Ver fetchTieneContactoEmergencia -- arranca en true (no bloquea) para
  // no trabar el primer render mientras se resuelve; en la práctica ya está
  // resuelto antes de que exista ninguna tarjeta para tocar (useFocusEffect
  // corre antes de que loadAgendaClasses termine de poblar `classes`).
  const [tieneContactoEmergencia, setTieneContactoEmergencia] = useState(true);
  // Segundo gate, coexiste con el de arriba (ver handlePress): clase que
  // está esperando que el socio acepte la declaración de salud/consentimiento
  // informado (versión vigente) antes de pasar a BookingConfirmModal.
  const [consentTarget, setConsentTarget] = useState<AgendaClass | null>(null);
  const [isAcceptingConsent, setIsAcceptingConsent] = useState(false);

  const selectedDateStr = formatDateOnly(selectedDate);
  const closedToday = closedDays.find((d) => d.fecha === selectedDateStr) ?? null;

  // Tarjetas del día ELEGIDO. Si lo que hay cargado es de otro día (recién se
  // cambió de día y la respuesta todavía no llegó), no se muestra nada: se ve
  // la ruedita. Tirar para refrescar o recargar después de reservar no cambia
  // el día, así que ahí las tarjetas se quedan en pantalla.
  const hayDatosDelDia = lista.fecha === selectedDateStr;
  const classes = hayDatosDelDia ? lista.items : [];

  // Número de la última carga pedida. Bug real (carrera entre respuestas):
  // tocar "mañana" y volver a "hoy" dispara dos cargas; si la de mañana
  // respondía DESPUÉS que la de hoy, pisaba la lista -- encabezado de HOY con
  // las tarjetas (y los cupos en 0) de mañana, y un toque en "Reservar"
  // reservaba la clase de mañana. Ahora cada carga recuerda su número y solo
  // la ÚLTIMA pedida puede escribir en pantalla; las viejas se descartan.
  const ultimaCarga = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const estaCarga = ++ultimaCarga.current;
    const sigueVigente = () => estaCarga === ultimaCarga.current;
    const fechaPedida = formatDateOnly(selectedDate);
    setError(null);
    try {
      const [classList, credits] = await Promise.all([
        loadAgendaClasses(user.id, selectedDate),
        fetchCreditsByDiscipline(user.id),
      ]);
      if (!sigueVigente()) return;
      setLista({ fecha: fechaPedida, items: classList });
      setCreditsByDiscipline(credits);
    } catch (err) {
      if (!sigueVigente()) return;
      setError(err instanceof Error ? err.message : 'No se pudo cargar la agenda.');
    } finally {
      // Una carga vieja no apaga la ruedita de la carga que sigue en curso.
      if (sigueVigente()) setIsLoading(false);
    }
  }, [user, selectedDate]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);


  useEffect(() => {
    fetchClosedDays()
      .then(setClosedDays)
      .catch((err) => console.error('No se pudieron cargar los días de cierre:', err));
  }, []);

  // useFocusEffect (no useEffect simple) -- mismo criterio que HomeScreen.tsx:
  // cubre el fetch inicial Y el refresco al volver de "Mis datos" (Perfil)
  // después de completar el contacto de emergencia, sin depender de que el
  // socio cierre sesión y vuelva a entrar.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      fetchTieneContactoEmergencia(user.id).then(setTieneContactoEmergencia);
    }, [user])
  );

  // "HOY" / "MAÑANA" / "PRÓXIMOS DÍAS" -- el selector deja elegir cualquier
  // día suelto, así que el agrupado temporal se resuelve como un encabezado
  // dinámico sobre el día elegido en vez de tres listas separadas.
  const dayHeading = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(selectedDate);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
    const eyebrow = diffDays === 0 ? 'HOY' : diffDays === 1 ? 'MAÑANA' : 'PRÓXIMOS DÍAS';
    // Formato del mockup: "Jueves 24 de Septiembre" (sin coma, mes en mayúscula).
    const diaSemana = selectedDate.toLocaleDateString('es-AR', { weekday: 'long' });
    const mes = selectedDate.toLocaleDateString('es-AR', { month: 'long' });
    const title = `${capitalize(diaSemana)} ${selectedDate.getDate()} de ${capitalize(mes)}`;
    return { eyebrow, title };
  }, [selectedDate]);

  // Ya NO dispara la reserva -- solo valida y, si todo está en orden, abre
  // el modal de confirmación (BookingConfirmModal). El RPC real vive en
  // confirmBooking(), disparado recién cuando el socio toca "Confirmar".
  // Async desde el gate de consentimiento en adelante: esos dos chequeos
  // finales pegan contra la base (a diferencia de los de arriba, que solo
  // miran estado ya cargado en memoria).
  async function handlePress(item: AgendaClass) {
    if (item.isBooked) {
      setCancelTarget(item);
      return;
    }
    if (closedToday) {
      setMessageModal({
        title: 'Gimnasio cerrado',
        message: `El gimnasio permanece cerrado este día${closedToday.motivo ? ` (${closedToday.motivo})` : ''}.`,
        tone: 'info',
      });
      return;
    }
    if (item.bookedCount >= item.capacity) {
      setMessageModal({ title: 'Sin cupo', message: 'Esta clase ya no tiene lugares disponibles.', tone: 'error' });
      return;
    }
    if ((creditsByDiscipline.get(item.disciplineId) ?? 0) <= 0) {
      setMessageModal({
        title: 'Sin créditos',
        message: `No te quedan créditos de ${item.title} para reservar.`,
        tone: 'error',
      });
      return;
    }
    // Gate 1: contacto de emergencia, aparte del de "perfil obligatorio"
    // (ProfileStack.tsx, que bloquea la pestaña Perfil entera y no se toca
    // acá): sin nombre Y teléfono de contacto de emergencia, no se deja
    // avanzar a la reserva. Va DESPUÉS de cerrado/cupo/créditos a propósito
    // -- no tiene sentido mandar al socio a completar su perfil por una
    // clase que igual no podría reservar (sin cupo, sin créditos, gimnasio
    // cerrado).
    if (!tieneContactoEmergencia) {
      setMessageModal({
        title: 'Completá tu contacto de emergencia',
        message: 'Para poder reservar una clase, necesitamos el nombre y el teléfono de alguien a quien contactar en caso de emergencia.',
        tone: 'error',
        actionLabel: 'Completar mis datos',
        onAction: () => navigation.navigate('Perfil', { screen: 'MyData' }),
      });
      return;
    }
    if (!user) return;

    // Gate 2: consentimiento informado / declaración de salud (coexiste con
    // el de arriba, va después). A diferencia del contacto de emergencia
    // (cacheado en estado, refrescado por useFocusEffect), esto se consulta
    // EN VIVO acá mismo -- así, apenas el socio acepta en ConsentModal, se
    // puede pasar directo a BookingConfirmModal sin depender de un refoco de
    // pantalla. Fail-closed a propósito (decisión explícita, distinta del
    // contacto de emergencia): es un registro legal, así que ante un error
    // real de red/consulta no se deja avanzar -- ver consentApi.ts.
    setPendingId(item.id);
    const { tieneConsentimiento, error: consentError } = await fetchTieneConsentimientoVigente(user.id);
    setPendingId(null);
    if (consentError) {
      setMessageModal({
        title: 'No se pudo verificar tu consentimiento',
        message: 'No pudimos confirmar tu declaración de salud. Revisá tu conexión e intentá de nuevo.',
        tone: 'error',
      });
      return;
    }
    if (!tieneConsentimiento) {
      setConsentTarget(item);
      return;
    }
    setConfirmTarget(item);
  }

  // Se llama al tocar "Continuar" en ConsentModal con "Acepto" marcado.
  // Snapshot de nombre/DNI actuales del socio (si edita su perfil después,
  // este registro puntual no cambia -- ver la migración) y, si sale bien,
  // sigue derecho a BookingConfirmModal sin que el socio tenga que volver a
  // tocar la tarjeta de la clase.
  async function handleAcceptConsent() {
    if (!consentTarget || !user) return;
    setIsAcceptingConsent(true);
    try {
      await registrarConsentimiento(user.id, user.name, user.dni ?? '');
      const item = consentTarget;
      setConsentTarget(null);
      setConfirmTarget(item);
    } catch (err) {
      setMessageModal({
        title: 'No se pudo registrar tu aceptación',
        message: err instanceof Error ? err.message : 'Intentá de nuevo.',
        tone: 'error',
      });
    } finally {
      setIsAcceptingConsent(false);
    }
  }

  async function confirmBooking() {
    if (!confirmTarget) return;
    const item = confirmTarget;
    setPendingId(item.id);
    setIsBooking(true);
    try {
      const { error: rpcError } = await withTimeout(
        supabase.rpc('book_class', { p_class_id: item.id, p_booking_date: item.occurrenceDate }),
        RPC_TIMEOUT_MS,
        RPC_TIMEOUT_MESSAGE
      );
      if (rpcError) throw new Error(rpcError.message);
      setConfirmTarget(null);
      await load();
      setConfirmedBooking(item);
    } catch (err) {
      setConfirmTarget(null);
      setMessageModal({
        title: 'No se pudo reservar',
        message: err instanceof Error ? err.message : 'Intentá de nuevo.',
        tone: 'error',
      });
    } finally {
      setPendingId(null);
      setIsBooking(false);
    }
  }

  async function confirmCancel(reason: string) {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const { data: creditoReintegrado, error: rpcError } = await withTimeout(
        supabase.rpc('cancel_booking', {
          p_class_id: cancelTarget.id,
          p_booking_date: cancelTarget.occurrenceDate,
          p_reason: reason || null,
        }),
        RPC_TIMEOUT_MS,
        RPC_TIMEOUT_MESSAGE
      );
      if (rpcError) throw new Error(rpcError.message);
      setCancelTarget(null);
      await load();
      setMessageModal({
        title: 'Reserva cancelada',
        message: creditoReintegrado
          ? 'Te devolvimos el crédito.'
          : `Como cancelaste con menos de ${formatLimite(configuracion.limiteCancelacionMinutos)} de anticipación, no se reintegra el crédito.`,
        tone: creditoReintegrado ? 'success' : 'info',
      });
    } catch (err) {
      setMessageModal({
        title: 'No se pudo cancelar',
        message: err instanceof Error ? err.message : 'Intentá de nuevo.',
        tone: 'error',
      });
    } finally {
      setIsCancelling(false);
    }
  }

  function renderItem({ item }: { item: AgendaClass }) {
    const disciplineStyle = getDisciplineStyle(item.title);
    const remaining = item.capacity - item.bookedCount;
    const isFull = remaining <= 0 && !item.isBooked;
    const credits = creditsByDiscipline.get(item.disciplineId) ?? 0;
    const sinCreditos = !item.isBooked && !isFull && credits <= 0;
    const startLabel = formatClassTime(item.startAt);
    const countdown = getCountdown(item.startAt);
    const isPending = pendingId === item.id;

    // Pill de estado -- PURAMENTE DECORATIVO: un View sin ningún manejador y
    // con pointerEvents="none", así cualquier toque (incluido encima del
    // pill) lo recibe el TouchableOpacity de la tarjeta y dispara el mismo
    // handlePress de siempre. Calcado del mockup: "RESERVAR" verde sólido y
    // "SIN CUPO" gris sólido; los dos estados que el mockup no tiene
    // (Reservada, Sin créditos) usan el mismo lenguaje: sólidos, sin íconos.
    const pill = item.isBooked
      ? { label: 'Reservada', caja: styles.pillReservada, texto: styles.pillTextoReservada }
      : isFull
      ? { label: 'Sin cupo', caja: styles.pillSinCupo, texto: styles.pillTextoSinCupo }
      : sinCreditos
      ? { label: 'Sin créditos', caja: styles.pillSinCreditos, texto: styles.pillTextoSinCreditos }
      : { label: 'Reservar', caja: styles.pillReservar, texto: styles.pillTextoReservar };

    const colorDisciplina = isFull
      ? mockup.onSurfaceVariant
      : colorDisciplinaMockup(item.title, disciplineStyle.color);

    // Info funcional que el mockup no tiene, en letra chica para no romper
    // el layout compacto: profesor · cupos · cuenta regresiva.
    const detalles = [
      item.instructor ? `Prof. ${item.instructor}` : null,
      `${item.bookedCount}/${item.capacity} cupos`,
    ].filter(Boolean) as string[];

    return (
      <TouchableOpacity
        testID={`agenda-card-${item.id}`}
        activeOpacity={0.85}
        style={[styles.card, isFull && styles.cardSinCupo, item.isBooked && styles.cardReservada]}
        onPress={() => handlePress(item)}
        disabled={isPending}
      >
        <View style={styles.cardBody}>
          <Text style={[styles.disciplina, { color: colorDisciplina }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.hora, isFull && styles.horaSinCupo]}>
            {startLabel}
            <Text style={styles.horaHs}> hs</Text>
          </Text>
          <Text style={styles.detalles} numberOfLines={1}>
            {detalles.join(' · ')}
            {!countdown.isPast && (
              <>
                {' · '}
                <Text style={countdown.isSoon ? styles.countdownSoon : undefined}>{countdown.label}</Text>
              </>
            )}
          </Text>
        </View>

        <View style={styles.pillSlot} pointerEvents="none">
          {isPending ? (
            <View style={[styles.pill, styles.pillSinCupo]} testID={`agenda-card-cargando-${item.id}`}>
              <ActivityIndicator size="small" color={mockup.primaryContainer} />
            </View>
          ) : (
            <View style={[styles.pill, pill.caja]}>
              <Text style={[styles.pillTexto, pill.texto]}>{pill.label}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Brillo ambiental del mockup (dos círculos verdes difuminados). Solo
          web: el blur es un filtro CSS; en nativo no se dibuja. */}
      {Platform.OS === 'web' && (
        <View style={styles.brilloFondo} pointerEvents="none">
          <View style={styles.brilloArriba} />
          <View style={styles.brilloAbajo} />
        </View>
      )}

      {/* Header calcado del mockup (avatar + saludo + título). Sin el pill de
          "15 créditos": los créditos son por disciplina y sumarlos engañaría
          al socio. El título sigue siendo "Mi Agenda". */}
      <View style={styles.headerRow}>
        <View style={styles.avatarRing}>
          <Avatar uri={user?.avatarUrl} name={user?.name ?? ''} size={36} />
        </View>
        <View style={styles.headerTextos}>
          <Text style={styles.headerSaludo} numberOfLines={1}>
            Hola, {(user?.name ?? '').trim().split(/\s+/)[0] || 'socio'}
          </Text>
          <Text style={styles.header}>Mi Agenda</Text>
        </View>
      </View>

      <View style={styles.daySelectorWrap}>
        <DaySelector selectedDate={selectedDate} onSelect={setSelectedDate} />
      </View>

      <View style={styles.dayHeadingWrap}>
        <Text style={styles.dayTitle} numberOfLines={1}>
          {dayHeading.title}
        </Text>
        {!closedToday && !error && classes.length > 0 && (
          <Text style={styles.dayTurnos}>{classes.length === 1 ? '1 turno' : `${classes.length} turnos`}</Text>
        )}
      </View>

      {closedToday ? (
        <View style={styles.closedBanner}>
          <Ionicons name="lock-closed" size={20} color={colors.warning} />
          <Text style={styles.closedBannerText}>
            El gimnasio permanecerá cerrado este día{closedToday.motivo ? ` (${closedToday.motivo})` : ''}.
          </Text>
        </View>
      ) : (
        <>
          {/* Ruedita: cargando, o todavía sin la respuesta del día elegido. */}
          {(isLoading || (!hayDatosDelDia && !error)) && classes.length === 0 && (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!isLoading && !error && hayDatosDelDia && classes.length === 0 && (
            <Text style={styles.empty}>No hay clases programadas para este día.</Text>
          )}

          <FlatList
            data={classes}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
          />
        </>
      )}

      <CancelBookingModal
        visible={!!cancelTarget}
        className={cancelTarget?.title ?? ''}
        // La fecha de la reserva que se cancela (la de la tarjeta tocada),
        // no la del día elegido en el selector.
        dateLabel={cancelTarget ? formatFechaReserva(cancelTarget.occurrenceDate) : null}
        isSubmitting={isCancelling}
        withinCancelLimit={
          !!cancelTarget && new Date(cancelTarget.startAt).getTime() - Date.now() < cancelLimitMs
        }
        limiteMinutos={configuracion.limiteCancelacionMinutos}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />

      <ReservaConfirmadaModal
        visible={!!confirmedBooking}
        reserva={
          confirmedBooking && {
            disciplina: confirmedBooking.title,
            startAt: confirmedBooking.startAt,
            endAt: confirmedBooking.endAt,
            instructor: confirmedBooking.instructor,
            location: confirmedBooking.location,
          }
        }
        onClose={() => setConfirmedBooking(null)}
      />

      <ConsentModal
        visible={!!consentTarget}
        isSubmitting={isAcceptingConsent}
        onClose={() => setConsentTarget(null)}
        onAccept={handleAcceptConsent}
      />

      <BookingConfirmModal
        visible={!!confirmTarget}
        target={
          confirmTarget && {
            title: confirmTarget.title,
            // La fecha de la TARJETA (lo que book_class va a reservar), no
            // la del día elegido en el selector.
            dateLabel: formatFechaReserva(confirmTarget.occurrenceDate),
            startLabel: formatClassTime(confirmTarget.startAt),
            endLabel: confirmTarget.endAt ? formatClassTime(confirmTarget.endAt) : null,
            instructor: confirmTarget.instructor,
            location: confirmTarget.location,
          }
        }
        isSubmitting={isBooking}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmBooking}
      />

      <MessageModal content={messageModal} onClose={() => setMessageModal(null)} />
    </View>
  );
}

// Medidas calcadas del mockup (Tailwind -> px): px-6 = 24, gap-5 = 20,
// gap-3.5 = 14, p-4 = 16, rounded-2xl = 16, rounded-xl = 12, text-3xl = 30,
// text-xs = 12, text-sm = 14, min-h-[48px], px-6 / px-5 del pill.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: mockup.background, overflow: 'hidden' },

  // "Ambient Glow Backdrop" del mockup: w-96 h-96 bg-primary-container/10
  // blur-[120px] arriba al centro, y w-72 h-72 /5 blur-[100px] abajo a la izquierda.
  brilloFondo: { ...StyleSheet.absoluteFillObject },
  brilloArriba: {
    position: 'absolute',
    top: -160,
    left: '50%',
    marginLeft: -192,
    width: 384,
    height: 384,
    borderRadius: 192,
    backgroundColor: alfa(mockup.primaryContainer, 0.1),
    // `filter` = CSS de web (react-native-web lo pasa tal cual).
    filter: 'blur(120px)',
  },
  brilloAbajo: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    width: 288,
    height: 288,
    borderRadius: 144,
    backgroundColor: alfa(mockup.primaryContainer, 0.05),
    // `filter` = CSS de web (react-native-web lo pasa tal cual).
    filter: 'blur(100px)',
  },

  // ---- Header: px-6 pt-7 pb-3 ----
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 12,
  },
  avatarRing: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: mockup.outlineVariant,
    backgroundColor: mockup.surfaceContainerHigh,
    padding: 1,
  },
  headerTextos: { flexShrink: 1 },
  headerSaludo: {
    color: mockup.onSurfaceVariant,
    fontFamily: fuentes.titulo,
    fontSize: 11,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
  header: {
    color: mockup.onSurface,
    fontFamily: fuentes.titulo,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginTop: 2,
  },

  // ---- Selector de días (py-2 del main) ----
  daySelectorWrap: { paddingHorizontal: 24, paddingTop: 8 },

  // ---- Encabezado del día: text-xl bold tracking-tight + "N turnos" text-xs ----
  dayHeadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  dayTitle: {
    flexShrink: 1,
    color: mockup.onSurface,
    fontFamily: fuentes.titulo,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  dayTurnos: {
    color: mockup.onSurfaceVariant,
    fontFamily: fuentes.titulo,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },

  error: { color: colors.danger, paddingHorizontal: 24, marginTop: 12 },
  empty: { color: mockup.onSurfaceVariant, fontFamily: fuentes.texto, paddingHorizontal: 24, marginTop: 16 },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 24,
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: mockup.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  closedBannerText: { flex: 1, color: mockup.onSurface, fontFamily: fuentes.texto, fontSize: 14, lineHeight: 20 },

  // ---- Lista: gap-5 arriba, gap-3.5 entre tarjetas, pb-6 ----
  listContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24, gap: 14 },

  // ---- Tarjeta: bg-surface-container-low border-outline-variant/50 rounded-2xl p-4 ----
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: mockup.surfaceContainerLow,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: alfa(mockup.outlineVariant, 0.5),
  },
  // Sin cupo: bg /70, border /30, opacity-80 (igual al mockup).
  cardSinCupo: {
    backgroundColor: alfa(mockup.surfaceContainerLow, 0.7),
    borderColor: alfa(mockup.outlineVariant, 0.3),
    opacity: 0.8,
  },
  // Reservada (no está en el mockup): mismo formato, borde verde para
  // ubicarla de un vistazo.
  cardReservada: { borderColor: alfa(mockup.primaryContainer, 0.5) },
  cardBody: { flex: 1, minWidth: 0 },
  // text-xs font-bold uppercase tracking-wider mb-1
  disciplina: {
    fontFamily: fuentes.titulo,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  // text-3xl font-black tracking-tight leading-none
  hora: {
    color: mockup.onSurface,
    fontFamily: fuentes.titulo,
    fontSize: 30,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: -0.75,
  },
  horaSinCupo: { color: alfa(mockup.onSurface, 0.8) },
  // "hs": text-base font-semibold text-on-surface-variant
  horaHs: { color: mockup.onSurfaceVariant, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
  // Info funcional extra, chica y discreta (no está en el mockup).
  detalles: { color: mockup.onSurfaceVariant, fontFamily: fuentes.texto, fontSize: 11, lineHeight: 14, marginTop: 8 },
  countdownSoon: { color: mockup.primaryContainer, fontWeight: '700' },

  // ---- Pill (decorativo): min-h-[48px] rounded-xl ----
  pillSlot: { flexShrink: 0 },
  pill: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pillTexto: { fontFamily: fuentes.titulo, textTransform: 'uppercase' },
  // RESERVAR: px-6 bg-primary-container text-on-secondary-fixed text-sm font-black tracking-wider + sombra verde
  pillReservar: {
    paddingHorizontal: 24,
    backgroundColor: mockup.primaryContainer,
    shadowColor: mockup.primaryContainer,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pillTextoReservar: { color: mockup.onSecondaryFixed, fontSize: 14, lineHeight: 20, fontWeight: '900', letterSpacing: 0.7 },
  // SIN CUPO: px-5 bg-surface-container-high border-outline-variant/40 text-on-surface-variant text-xs font-bold tracking-wider
  pillSinCupo: {
    paddingHorizontal: 20,
    backgroundColor: mockup.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: alfa(mockup.outlineVariant, 0.4),
  },
  pillTextoSinCupo: { color: mockup.onSurfaceVariant, fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  // RESERVADA (no está en el mockup): mismo tamaño que SIN CUPO, sólido verde
  // muy oscuro con borde y texto neón -> se lee "ya es tuya" sin confundirse
  // con la acción RESERVAR.
  pillReservada: {
    paddingHorizontal: 20,
    backgroundColor: mockup.onPrimary,
    borderWidth: 1,
    borderColor: mockup.primaryContainer,
  },
  pillTextoReservada: { color: mockup.primaryContainer, fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  // SIN CRÉDITOS (no está en el mockup): mismo tamaño que SIN CUPO, ámbar
  // sólido con texto oscuro -> estado bien visible, no una alerta tenue.
  pillSinCreditos: { paddingHorizontal: 20, backgroundColor: mockup.amber },
  pillTextoSinCreditos: { color: mockup.onSecondaryFixed, fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
});
