import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Animated,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { showAlert } from '../../lib/crossPlatformAlert';
import { colors } from '../../theme/colors';
import { colorGrupoMuscular } from '../../theme/muscleGroups';
import {
  getUserRoutine,
  getTodayCompletions,
  markExerciseCompleted,
  unmarkExerciseCompleted,
  getUserExerciseWeights,
  saveExerciseWeight,
  finalizarEntrenamiento,
  getRoutineHistory,
  eliminarSesionHistorial,
  DiaHistorial,
  SesionHistorial,
} from '../../lib/routinesApi';
import { formatDateOnly } from '../../lib/classesApi';
import { Routine, RoutineExercise } from '../../types';
import Avatar from '../../components/Avatar';
import VideoModal from '../../components/VideoModal';
import RoutineCompleteModal from '../../components/RoutineCompleteModal';

const CONTACTO_WHATSAPP = 'https://wa.me/5492617139662';

// Tintes translúcidos del verde de marca (colors.primary + alfa en hex), mismo
// criterio que la barra flotante de MainTabs -- nada de hex sueltos del mockup.
const VERDE_10 = `${colors.primary}1A`;
const VERDE_15 = `${colors.primary}26`;
const VERDE_40 = `${colors.primary}66`;

// Bloqueo del botón "Finalizar" contra el doble toque accidental.
export const BLOQUEO_FINALIZAR_MS = 8000;
// Mismo tope que aplica finalizar_entrenamiento() en el servidor (solo para el texto del aviso).
const TOPE_DIARIO_FINALIZACIONES = 20;

const ZONA_ARGENTINA = 'America/Argentina/Mendoza';
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// "2026-09-26" -> "Sábado 26 de septiembre" (con año solo si no es el año en
// curso). `fecha` ya viene calculada en horario de Mendoza por el servidor:
// el día de la semana se saca de esa fecha tal cual (Date.UTC), sin pasar por
// el huso del dispositivo.
export function formatFechaHistorial(fecha: string, hoy: Date = new Date()): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const anioActual = Number(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_ARGENTINA, year: 'numeric' }).format(hoy));
  const diaSemana = DIAS_SEMANA[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  const base = `${diaSemana.charAt(0).toUpperCase()}${diaSemana.slice(1)} ${dia} de ${MESES[mes - 1]}`;
  return anio === anioActual ? base : `${base} de ${anio}`;
}

// Instante ISO -> "18:42", siempre en horario de Argentina.
export function formatHoraArgentina(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: ZONA_ARGENTINA,
  }).format(new Date(iso));
}

// Qué día (chip) mostrar al cargar la rutina:
// - si el socio ya eligió uno a mano (`elegido` != null), ese, mientras exista;
// - si no, el primer día (en el orden del entrenador) con algún ejercicio
//   tildado HOY -- así vuelve a caer en el día que estaba entrenando;
// - si no hay tildes, el primero.
export function diaInicial(routine: Routine | null, completadosHoy: Set<string>, elegido: number | null): number {
  if (!routine || routine.days.length === 0) return 0;
  if (elegido !== null) return elegido < routine.days.length ? elegido : 0;
  const conTildes = routine.days.findIndex((d) => d.exercises.some((e) => completadosHoy.has(e.id)));
  return conTildes >= 0 ? conTildes : 0;
}

function resumenSesion(s: SesionHistorial): string {
  return s.completo ? 'Completo' : `${s.ejercicios.length} de ${s.totalEjercicios} ejercicios`;
}

// Chip grande y legible (series × reps) -- ícono en verde, texto en blanco.
function MetaChip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={14} color={colors.primary} />
      <Text style={styles.metaChipText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// Carga real editable -- distinta de bloque.weightSuggestion (la sugerencia
// fija que cargó el entrenador, igual para cualquier socio con esta
// rutina). Estado local propio para no disparar un guardado en cada tecla:
// solo persiste al perder el foco, y solo si realmente cambió algo.
function CargaInput({ valor, onGuardar }: { valor: string; onGuardar: (nuevoValor: string) => void }) {
  const [texto, setTexto] = useState(valor);

  useEffect(() => {
    setTexto(valor);
  }, [valor]);

  function handleBlur() {
    const limpio = texto.trim();
    if (limpio && limpio !== valor.trim()) onGuardar(limpio);
    else if (!limpio) setTexto(valor); // no se guardan cargas vacías -- vuelve al último valor real
  }

  return (
    <View style={styles.cargaChip}>
      <Ionicons name="barbell-outline" size={14} color={colors.primary} />
      <TextInput
        value={texto}
        onChangeText={setTexto}
        onBlur={handleBlur}
        placeholder="Carga"
        placeholderTextColor={colors.textSecondary}
        style={styles.cargaInput}
        accessibilityLabel="Carga (kg) usada en este ejercicio"
      />
      <Ionicons name="pencil-outline" size={11} color={colors.textSecondary} />
    </View>
  );
}

// Tarjeta grande de ejercicio (estilo HUD): etiqueta "01 • GRUPO" con el color
// del grupo muscular + descanso, nombre grande, chips de series×reps y carga
// editable, y a la derecha el check cuadrado gigante (56x56). Al completarse,
// una transición suave (Animated, no LayoutAnimation -- no-op en
// react-native-web, el target principal de esta pantalla) tiñe el borde y el
// fondo de verde y el check se llena.
function ExerciseRow({
  bloque,
  numero,
  completado,
  peso,
  onToggle,
  onGuardarPeso,
  onVerDemo,
}: {
  bloque: RoutineExercise;
  numero: number;
  completado: boolean;
  peso: string;
  onToggle: () => void;
  onGuardarPeso: (nuevoValor: string) => void;
  onVerDemo: (url: string) => void;
}) {
  const anim = useRef(new Animated.Value(completado ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: completado ? 1 : 0,
      duration: 260,
      useNativeDriver: false, // interpola color/opacidad, no soportado por el driver nativo
    }).start();
  }, [completado, anim]);

  const borderColor = anim.interpolate({ inputRange: [0, 1], outputRange: [colors.surfaceAlt, colors.primary] });
  const backgroundColor = anim.interpolate({ inputRange: [0, 1], outputRange: [colors.surface, VERDE_10] });
  const nameOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] });

  const grupo = bloque.exercise.muscleGroup || 'Otros';
  const colorGrupo = colorGrupoMuscular(grupo);
  const instrucciones = bloque.notes || bloque.exercise.description;

  return (
    <Animated.View style={[styles.exerciseCard, completado && styles.exerciseCardDone, { borderColor, backgroundColor }]}>
      <View style={styles.exerciseRowMain}>
        <View style={styles.tagRow}>
          <View style={[styles.grupoTag, { backgroundColor: colorGrupo.bg }]}>
            <Text style={[styles.grupoTagText, { color: colorGrupo.text }]} numberOfLines={1}>
              {`${String(numero).padStart(2, '0')} • ${grupo.toUpperCase()}`}
            </Text>
          </View>
          {!!bloque.restSeconds && (
            <View style={styles.descanso}>
              <Ionicons name="timer-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.descansoText}>{bloque.restSeconds}s</Text>
            </View>
          )}
        </View>

        <Animated.Text style={[styles.exerciseName, { opacity: nameOpacity }]} numberOfLines={2}>
          {bloque.exercise.name}
        </Animated.Text>

        <View style={styles.metaLine}>
          <MetaChip icon="repeat-outline" text={`${bloque.sets ?? '-'} × ${bloque.reps || '-'}`} />
          {/* Carga editable -- recuerda la última que el socio cargó a mano
              (persistente entre sesiones), no la sugerencia fija del
              entrenador. */}
          <CargaInput valor={peso} onGuardar={onGuardarPeso} />
        </View>

        {!!instrucciones && (
          <View style={styles.instructionsBox}>
            <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.instructionsText}>{instrucciones}</Text>
          </View>
        )}

        {!!bloque.exercise.videoUrl && (
          <TouchableOpacity style={styles.videoButton} onPress={() => onVerDemo(bloque.exercise.videoUrl!)}>
            <Ionicons name="play-circle" size={16} color={colors.primary} />
            <Text style={styles.videoButtonText}>Ver Demo</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        onPress={onToggle}
        hitSlop={6}
        style={[styles.checkButton, completado && styles.checkButtonDone]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completado }}
        accessibilityLabel={completado ? `${bloque.exercise.name}, completado` : `Marcar ${bloque.exercise.name} como completado`}
      >
        <Ionicons name="checkmark" size={28} color={completado ? colors.onPrimary : colors.surfaceAlt} />
      </TouchableOpacity>
    </Animated.View>
  );
}

// Tarjeta del historial = UNA finalización (una sesion_id). Si ese día hubo
// dos (mañana y tarde), son dos tarjetas separadas, cada una con su hora.
// Nada se edita: la única acción es "Eliminar" la sesión completa (con
// confirmación). Ni "repetir" ni favoritos.
function SesionCard({
  fecha,
  sesion,
  onEliminar,
}: {
  fecha: string;
  sesion: SesionHistorial;
  onEliminar: () => void;
}) {
  const hora = formatHoraArgentina(sesion.creadoEn);
  return (
    <View style={styles.sesionCard}>
      <View style={styles.sesionHeader}>
        <View style={styles.sesionFechaRow}>
          <Text style={styles.sesionFecha}>{formatFechaHistorial(fecha)}</Text>
          <Text style={styles.sesionHora}>{hora} hs</Text>
        </View>
        <View style={styles.sesionTituloRow}>
          <Text style={styles.sesionTitulo} numberOfLines={2}>
            {sesion.tituloDia || 'Entrenamiento'}
          </Text>
          <View style={[styles.sesionBadge, sesion.completo ? styles.sesionBadgeCompleto : styles.sesionBadgeParcial]}>
            <Ionicons
              name={sesion.completo ? 'checkmark-circle' : 'ellipse-outline'}
              size={13}
              color={sesion.completo ? colors.primary : colors.textSecondary}
            />
            <Text style={[styles.sesionBadgeText, sesion.completo && styles.sesionBadgeTextCompleto]}>
              {resumenSesion(sesion)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.sesionEjercicios}>
        {sesion.ejercicios.map((e) => (
          <View key={e.id} style={styles.historialEjercicio}>
            <Text style={styles.historialEjercicioNombre}>{e.nombre}</Text>
            <View style={styles.historialEjercicioDatos}>
              <Text style={styles.historialSeriesReps}>{`${e.series ?? '-'} × ${e.repeticiones || '-'}`}</Text>
              <Text style={e.peso ? styles.historialPeso : styles.historialSinPeso}>{e.peso || 'Sin carga'}</Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={styles.eliminarButton}
        onPress={onEliminar}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Eliminar entrenamiento del ${formatFechaHistorial(fecha)} a las ${hora}`}
      >
        <Ionicons name="trash-outline" size={14} color={colors.danger} />
        <Text style={styles.eliminarButtonText}>Eliminar</Text>
      </TouchableOpacity>
    </View>
  );
}

export interface SesionAEliminar {
  fecha: string;
  sesion: SesionHistorial;
}

// Confirmación antes de borrar -- el borrado no se puede deshacer. Modal
// propio (no Alert.alert, que en react-native-web es un no-op).
function EliminarSesionModal({
  objetivo,
  eliminando,
  onCancelar,
  onConfirmar,
}: {
  objetivo: SesionAEliminar | null;
  eliminando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const s = objetivo?.sesion;
  return (
    <Modal visible={!!objetivo} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}>
            <Ionicons name="trash-outline" size={24} color={colors.danger} />
          </View>
          <Text style={styles.modalTitulo}>¿Eliminar este entrenamiento?</Text>
          {!!objetivo && !!s && (
            <Text style={styles.modalTexto}>
              {`${formatFechaHistorial(objetivo.fecha)} · ${formatHoraArgentina(s.creadoEn)} hs\n${
                s.tituloDia || 'Entrenamiento'
              }\n\n${
                s.ejercicios.length === 1
                  ? 'Se borra el ejercicio de esta sesión.'
                  : `Se borran los ${s.ejercicios.length} ejercicios de esta sesión.`
              } No se puede deshacer.`}
            </Text>
          )}
          <View style={styles.modalBotones}>
            <TouchableOpacity style={styles.modalCancelar} onPress={onCancelar} disabled={eliminando}>
              <Text style={styles.modalCancelarText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalEliminar, eliminando && styles.finishButtonBusy]}
              onPress={onConfirmar}
              disabled={eliminando}
              accessibilityLabel="Confirmar eliminar entrenamiento"
            >
              {eliminando ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.modalEliminarText}>Eliminar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Pestaña "Historial": una tarjeta por entrenamiento finalizado, la más
// reciente arriba.
function HistorialView({
  dias,
  cargando,
  error,
  aviso,
  onEliminar,
}: {
  dias: DiaHistorial[];
  cargando: boolean;
  error: string | null;
  aviso: string | null;
  onEliminar: (objetivo: SesionAEliminar) => void;
}) {
  const sesiones = dias.flatMap((d) => d.sesiones.map((s) => ({ fecha: d.fecha, sesion: s })));

  if (cargando && sesiones.length === 0) return <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />;
  if (error) return <Text style={styles.error}>{error}</Text>;

  if (sesiones.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="calendar-outline" size={32} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>Todavía no hay entrenamientos</Text>
        <Text style={styles.emptyText}>
          Cada vez que toques "Finalizar Entrenamiento" en Rutina de hoy, lo que hiciste queda guardado acá.
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.historialTituloRow}>
        <Text style={styles.seccionLabel}>HISTORIAL DE ENTRENAMIENTOS</Text>
        <Text style={styles.historialCantidad}>
          {sesiones.length === 1 ? '1 registrado' : `${sesiones.length} registrados`}
        </Text>
      </View>
      {!!aviso && <Text style={styles.avisoHistorial}>{aviso}</Text>}
      {sesiones.map(({ fecha, sesion }) => (
        <SesionCard key={sesion.sesionId} fecha={fecha} sesion={sesion} onEliminar={() => onEliminar({ fecha, sesion })} />
      ))}
    </>
  );
}

type Vista = 'hoy' | 'historial';

// La rutina asignada al socio logueado (la más reciente), organizada por
// días con checklist de ejercicios completados hoy, más la pestaña
// "Historial" con los entrenamientos finalizados.
export default function UserRoutineScreen() {
  const { user } = useAuth();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [completados, setCompletados] = useState<Set<string>>(new Set());
  const [modalFinalVisible, setModalFinalVisible] = useState(false);
  // routine_exercise_id -> última carga que el socio guardó ahí. Vacío
  // (sin entrada) para cualquier ejercicio en el que todavía no cargó la
  // suya -- en ese caso se muestra la sugerencia del entrenador como valor
  // por defecto (ver `pesoDe` más abajo), sin que eso cuente como "guardado".
  const [pesos, setPesos] = useState<Map<string, string>>(new Map());
  const [vista, setVista] = useState<Vista>('hoy');
  // `finalizando` = esperando la respuesta del servidor (spinner).
  // `bloqueoFinalizar` = botón deshabilitado contra el doble toque: arranca al
  // tocar y dura BLOQUEO_FINALIZAR_MS o hasta que responde el servidor, lo
  // que pase DESPUÉS.
  const [finalizando, setFinalizando] = useState(false);
  const [bloqueoFinalizar, setBloqueoFinalizar] = useState(false);
  const timerBloqueo = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerBloqueo.current) clearTimeout(timerBloqueo.current);
  }, []);
  // Aviso inline debajo del botón (0 marcados / cooldown / error) -- visible
  // también en web, donde Alert.alert es un no-op.
  const [avisoFinal, setAvisoFinal] = useState<string | null>(null);
  const [historial, setHistorial] = useState<DiaHistorial[]>([]);
  const [historialCargando, setHistorialCargando] = useState(false);
  const [historialError, setHistorialError] = useState<string | null>(null);
  // Sesión que el socio pidió eliminar (modal de confirmación abierto).
  const [sesionAEliminar, setSesionAEliminar] = useState<SesionAEliminar | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [avisoHistorial, setAvisoHistorial] = useState<string | null>(null);

  const todayStr = useMemo(() => formatDateOnly(new Date()), []);
  // true apenas el socio toca un chip de día: desde ahí se respeta su
  // elección (incluso al refrescar) en vez de volver a elegir por los tildes.
  const diaElegidoAMano = useRef(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [r, completions, pesosGuardados] = await Promise.all([
        getUserRoutine(user.id),
        getTodayCompletions(user.id, todayStr),
        getUserExerciseWeights(user.id),
      ]);
      setRoutine(r);
      setCompletados(completions);
      setPesos(pesosGuardados);
      setSelectedDayIdx((prev) => diaInicial(r, completions, diaElegidoAMano.current ? prev : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu rutina.');
    } finally {
      setIsLoading(false);
    }
  }, [user, todayStr]);

  useEffect(() => {
    load();
  }, [load]);

  const loadHistorial = useCallback(async () => {
    if (!user) return;
    setHistorialError(null);
    setHistorialCargando(true);
    try {
      setHistorial(await getRoutineHistory(user.id));
    } catch (err) {
      setHistorialError(err instanceof Error ? err.message : 'No se pudo cargar tu historial.');
    } finally {
      setHistorialCargando(false);
    }
  }, [user]);

  // Se relee cada vez que se abre la pestaña: así una finalización recién
  // hecha ya aparece sin tener que tirar para refrescar.
  useEffect(() => {
    if (vista === 'historial') loadHistorial();
  }, [vista, loadHistorial]);

  const diaActual = routine?.days[selectedDayIdx] ?? null;
  const totalDia = diaActual?.exercises.length ?? 0;
  const completadosDia = diaActual ? diaActual.exercises.filter((e) => completados.has(e.id)).length : 0;
  const diaCompleto = totalDia > 0 && completadosDia === totalDia;

  // Agrupa los ejercicios del día por grupo muscular, respetando el orden en
  // que el entrenador los cargó (no alfabético) -- así el bloque "Pecho"
  // sigue viéndose antes que "Tríceps" si así se armó la rutina.
  const gruposDelDia = useMemo(() => {
    if (!diaActual) return [];
    const orden: string[] = [];
    const porGrupo = new Map<string, RoutineExercise[]>();
    for (const bloque of diaActual.exercises) {
      const grupo = bloque.exercise.muscleGroup || 'Otros';
      if (!porGrupo.has(grupo)) {
        porGrupo.set(grupo, []);
        orden.push(grupo);
      }
      porGrupo.get(grupo)!.push(bloque);
    }
    return orden.map((grupo) => ({ grupo, ejercicios: porGrupo.get(grupo)! }));
  }, [diaActual]);

  async function handleToggle(routineExerciseId: string) {
    if (!user) return;
    const yaCompletado = completados.has(routineExerciseId);
    setAvisoFinal(null);

    // Optimista: la app responde al toque de inmediato, se corrige sola si
    // la escritura falla.
    setCompletados((prev) => {
      const next = new Set(prev);
      if (yaCompletado) next.delete(routineExerciseId);
      else next.add(routineExerciseId);
      return next;
    });

    try {
      if (yaCompletado) {
        await unmarkExerciseCompleted(user.id, routineExerciseId, todayStr);
      } else {
        await markExerciseCompleted(user.id, routineExerciseId, todayStr);
      }
    } catch (err) {
      setCompletados((prev) => {
        const next = new Set(prev);
        if (yaCompletado) next.add(routineExerciseId);
        else next.delete(routineExerciseId);
        return next;
      });
      showAlert('No se pudo guardar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  // La carga que se muestra es la que el socio ya guardó ahí; si todavía no
  // guardó ninguna, cae a la sugerencia del entrenador (weight_suggestion)
  // como punto de partida -- nunca un campo vacío de la nada.
  function pesoDe(bloque: RoutineExercise): string {
    return pesos.get(bloque.id) ?? bloque.weightSuggestion ?? '';
  }

  async function handleGuardarPeso(routineExerciseId: string, nuevoValor: string) {
    if (!user) return;
    const anterior = pesos.get(routineExerciseId);

    // Optimista, mismo criterio que el checklist: se ve al instante, se
    // corrige sola si la escritura falla.
    setPesos((prev) => {
      const next = new Map(prev);
      next.set(routineExerciseId, nuevoValor);
      return next;
    });

    try {
      await saveExerciseWeight(user.id, routineExerciseId, nuevoValor);
    } catch (err) {
      setPesos((prev) => {
        const next = new Map(prev);
        if (anterior === undefined) next.delete(routineExerciseId);
        else next.set(routineExerciseId, anterior);
        return next;
      });
      showAlert('No se pudo guardar la carga', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  // "Finalizar Entrenamiento": guarda en el historial una foto de los
  // ejercicios MARCADOS del día que se está viendo, con el peso que muestra
  // la pantalla en este momento. Parcial = completo=false (lo decide el
  // servidor comparando contra el total del día). La ventana de 10 s y el
  // tope de 20 por día los valida el servidor; acá solo se muestra su
  // respuesta (y el botón se bloquea BLOQUEO_FINALIZAR_MS contra el doble toque).
  // Borra la sesión COMPLETA confirmada en el modal (el servidor solo borra
  // si es del socio) y relee el historial desde el servidor.
  async function handleEliminarSesion() {
    if (!sesionAEliminar || eliminando) return;
    setEliminando(true);
    setAvisoHistorial(null);
    try {
      const borradas = await eliminarSesionHistorial(sesionAEliminar.sesion.sesionId);
      if (borradas === 0) setAvisoHistorial('Ese entrenamiento ya no estaba en tu historial.');
      setSesionAEliminar(null);
      await loadHistorial();
    } catch (err) {
      setSesionAEliminar(null);
      setAvisoHistorial(`No se pudo eliminar: ${err instanceof Error ? err.message : 'intentá de nuevo.'}`);
    } finally {
      setEliminando(false);
    }
  }

  async function handleFinalizar() {
    if (!user || !diaActual || finalizando || bloqueoFinalizar) return;
    setAvisoFinal(null);

    const marcados = diaActual.exercises.filter((e) => completados.has(e.id));
    if (marcados.length === 0) {
      setAvisoFinal('Marcá al menos un ejercicio para finalizar el entrenamiento.');
      return;
    }

    setFinalizando(true);
    setBloqueoFinalizar(true);
    const inicio = Date.now();
    try {
      const resultado = await finalizarEntrenamiento(
        diaActual.title?.trim() || null,
        diaActual.exercises.length,
        marcados.map((e) => ({
          nombre: e.exercise.name,
          grupo: e.exercise.muscleGroup || null,
          series: e.sets ?? null,
          repeticiones: e.reps || null,
          peso: pesoDe(e).trim() || null,
        }))
      );
      if (resultado.estado === 'reciente') {
        setAvisoFinal('Ya registraste este entrenamiento recién.');
        return;
      }
      if (resultado.estado === 'tope_diario') {
        setAvisoFinal(`Llegaste al máximo de ${TOPE_DIARIO_FINALIZACIONES} entrenamientos registrados por hoy.`);
        return;
      }
      setModalFinalVisible(true);
    } catch (err) {
      setAvisoFinal(
        `No se pudo guardar el entrenamiento: ${err instanceof Error ? err.message : 'intentá de nuevo.'}`
      );
    } finally {
      setFinalizando(false);
      const resto = BLOQUEO_FINALIZAR_MS - (Date.now() - inicio);
      if (resto > 0) {
        timerBloqueo.current = setTimeout(() => setBloqueoFinalizar(false), resto);
      } else {
        setBloqueoFinalizar(false);
      }
    }
  }

  // Mismo orden que antes (agrupado por grupo muscular, en el orden en que el
  // entrenador los cargó), numerado para la etiqueta "01 • GRUPO".
  const ejerciciosDelDia = gruposDelDia.flatMap((g) => g.ejercicios);
  const primerNombre = (user?.name || '').trim().split(/\s+/)[0] || 'Atleta';
  const progreso = totalDia > 0 ? completadosDia / totalDia : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={vista === 'hoy' ? isLoading : historialCargando}
          onRefresh={vista === 'hoy' ? load : loadHistorial}
          tintColor={colors.primary}
        />
      }
    >
      {/* Header HUD: avatar + nombre, marca a la derecha. */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarRing}>
            <Avatar uri={user?.avatarUrl} name={user?.name ?? ''} size={40} />
          </View>
          <Text style={styles.headerNombre} numberOfLines={1}>
            {primerNombre}
          </Text>
        </View>
        <Text style={styles.marca}>
          Green<Text style={styles.marcaFit}>Fit</Text>
        </Text>
      </View>

      {/* Switcher de dos pestañas */}
      <View style={styles.vistaTabs} accessibilityRole="tablist">
        {(
          [
            ['hoy', 'Rutina de hoy', 'flash'],
            ['historial', 'Historial', 'time'],
          ] as const
        ).map(([clave, etiqueta, icono]) => {
          const activa = vista === clave;
          return (
            <TouchableOpacity
              key={clave}
              onPress={() => setVista(clave)}
              style={[styles.vistaTab, activa && styles.vistaTabActiva]}
              accessibilityRole="tab"
              accessibilityState={{ selected: activa }}
            >
              <Ionicons name={icono} size={17} color={activa ? colors.onPrimary : colors.textSecondary} />
              <Text style={[styles.vistaTabText, activa && styles.vistaTabTextActiva]}>{etiqueta}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {vista === 'historial' ? (
        <HistorialView
          dias={historial}
          cargando={historialCargando}
          error={historialError}
          aviso={avisoHistorial}
          onEliminar={(objetivo) => {
            setAvisoHistorial(null);
            setSesionAEliminar(objetivo);
          }}
        />
      ) : (
        <>
          {isLoading && !routine && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}
          {error && <Text style={styles.error}>{error}</Text>}

          {!isLoading && !error && !routine && (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="barbell-outline" size={32} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Todavía no tenés una rutina</Text>
              <Text style={styles.emptyText}>
                Tu entrenador aún no te asignó un plan de ejercicios. Escribile para coordinar tu rutina personalizada.
              </Text>
              <TouchableOpacity style={styles.whatsappButton} onPress={() => Linking.openURL(CONTACTO_WHATSAPP)}>
                <Ionicons name="logo-whatsapp" size={18} color={colors.onPrimary} />
                <Text style={styles.whatsappButtonText}>Contactar a mi entrenador</Text>
              </TouchableOpacity>
            </View>
          )}

          {routine && diaActual && (
            <>
              {/* Barra de sesión: día de hoy + "X/Y" + barra de progreso. */}
              <View style={styles.sesionBar}>
                <View style={styles.sesionBarTop}>
                  <View style={styles.sesionBarTitulo}>
                    <View style={[styles.sesionDot, diaCompleto && styles.sesionDotDone]} />
                    <View style={styles.sesionBarTituloText}>
                      <Text style={styles.seccionLabel}>SESIÓN DE HOY</Text>
                      <Text style={styles.sesionBarDia} numberOfLines={2}>
                        {diaActual.title?.trim() || 'Entrenamiento de hoy'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.sesionBarContador}>
                    <Text style={styles.sesionBarNumero}>{`${completadosDia}/${totalDia}`}</Text>
                    <Text style={styles.sesionBarNumeroLabel}>COMPLETADOS</Text>
                  </View>
                </View>
                <View
                  style={styles.progressTrack}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: totalDia, now: completadosDia }}
                >
                  <View style={[styles.progressFill, { width: `${Math.round(progreso * 100)}%` }]} />
                </View>
              </View>

              {/* Selector de días */}
              {routine.days.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dayTabsRow}
                  style={styles.dayTabsScroll}
                >
                  {routine.days.map((d, idx) => {
                    const seleccionado = idx === selectedDayIdx;
                    return (
                      <TouchableOpacity
                        key={d.id}
                        onPress={() => {
                          diaElegidoAMano.current = true;
                          setSelectedDayIdx(idx);
                          setAvisoFinal(null);
                        }}
                        style={[styles.dayTab, seleccionado && styles.dayTabSelected]}
                      >
                        <Text style={[styles.dayTabText, seleccionado && styles.dayTabTextSelected]} numberOfLines={1}>
                          {d.title}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {ejerciciosDelDia.length === 0 ? (
                <Text style={styles.empty}>Este día todavía no tiene ejercicios cargados.</Text>
              ) : (
                ejerciciosDelDia.map((bloque, idx) => (
                  <ExerciseRow
                    key={bloque.id}
                    bloque={bloque}
                    numero={idx + 1}
                    completado={completados.has(bloque.id)}
                    peso={pesoDe(bloque)}
                    onToggle={() => handleToggle(bloque.id)}
                    onGuardarPeso={(nuevoValor) => handleGuardarPeso(bloque.id, nuevoValor)}
                    onVerDemo={setVideoUrl}
                  />
                ))
              )}

              <TouchableOpacity
                style={[styles.finishButton, bloqueoFinalizar && styles.finishButtonBusy]}
                onPress={handleFinalizar}
                disabled={bloqueoFinalizar}
                accessibilityState={{ disabled: bloqueoFinalizar }}
                activeOpacity={0.85}
              >
                {finalizando ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={24} color={colors.onPrimary} />
                    <Text style={styles.finishButtonText}>Finalizar Entrenamiento</Text>
                  </>
                )}
              </TouchableOpacity>
              {!!avisoFinal && <Text style={styles.avisoFinal}>{avisoFinal}</Text>}
            </>
          )}
        </>
      )}

      <VideoModal visible={!!videoUrl} videoUrl={videoUrl} onClose={() => setVideoUrl(null)} />
      <EliminarSesionModal
        objetivo={sesionAEliminar}
        eliminando={eliminando}
        onCancelar={() => setSesionAEliminar(null)}
        onConfirmar={handleEliminarSesion}
      />
      <RoutineCompleteModal
        visible={modalFinalVisible}
        completos={completadosDia}
        total={totalDia}
        onClose={() => setModalFinalVisible(false)}
      />
    </ScrollView>
  );
}

// Sombra/glow verde (en web se traduce a box-shadow).
const glowVerde = (opacidad: number, radio: number) => ({
  shadowColor: colors.primary,
  shadowOpacity: opacidad,
  shadowRadius: radio,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  error: { color: colors.danger, marginTop: 20 },
  empty: { color: colors.textSecondary, marginTop: 12, textAlign: 'center' },

  // ---- Header HUD ----
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  avatarRing: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: VERDE_40,
    padding: 2,
    ...glowVerde(0.2, 12),
  },
  headerNombre: { flexShrink: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  marca: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  marcaFit: { color: colors.primary },

  // ---- Switcher de pestañas ----
  vistaTabs: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 6,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  vistaTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 14,
  },
  vistaTabActiva: { backgroundColor: colors.primary, ...glowVerde(0.35, 16) },
  vistaTabText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.3 },
  vistaTabTextActiva: { color: colors.onPrimary },

  seccionLabel: { color: colors.primary, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5 },

  // ---- Barra de sesión ----
  sesionBar: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    gap: 14,
  },
  sesionBarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sesionBarTitulo: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  sesionBarTituloText: { flexShrink: 1 },
  sesionDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary, opacity: 0.6 },
  sesionDotDone: { opacity: 1, ...glowVerde(0.6, 8) },
  sesionBarDia: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 2 },
  sesionBarContador: { alignItems: 'flex-end' },
  sesionBarNumero: { color: colors.primary, fontSize: 19, fontWeight: '900' },
  sesionBarNumeroLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    padding: 1,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary, ...glowVerde(0.6, 10) },

  // ---- Selector de días ----
  dayTabsScroll: { marginBottom: 14 },
  dayTabsRow: { gap: 8, paddingRight: 8 },
  dayTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    maxWidth: 200,
  },
  dayTabSelected: { backgroundColor: VERDE_15, borderColor: colors.primary },
  dayTabText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '700' },
  dayTabTextSelected: { color: colors.primary },

  // ---- Tarjeta de ejercicio ----
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    borderWidth: 2,
  },
  exerciseCardDone: glowVerde(0.2, 24),
  exerciseRowMain: { flex: 1, minWidth: 0 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  grupoTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  grupoTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  descanso: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  descansoText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '600' },
  exerciseName: { color: colors.textPrimary, fontSize: 15.5, fontWeight: '800', lineHeight: 20 },

  metaLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  metaChipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },

  // Mismo look que metaChip pero con borde verde tenue + lápiz: se nota que
  // es un campo que se puede tocar y escribir.
  cargaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: VERDE_40,
  },
  cargaInput: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    // Ancho fijo: en web el TextInput reserva ~20 caracteres por defecto y
    // empujaba el chip a la línea de abajo; 64 alcanza para "42.5kg" o "2x14kg".
    width: 64,
    paddingVertical: 3,
  },

  instructionsBox: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  instructionsText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },

  videoButton: { flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'flex-start', marginTop: 12 },
  videoButtonText: { color: colors.primary, fontWeight: '700', fontSize: 12.5 },

  // Check cuadrado gigante (56x56): bien separado del texto para que no haya
  // toques accidentales, cómodo para el pulgar (también en adultos mayores).
  checkButton: {
    width: 56,
    height: 56,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.surfaceAlt,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkButtonDone: { backgroundColor: colors.primary, borderColor: colors.primary, ...glowVerde(0.45, 14) },

  finishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: 18,
    marginTop: 6,
    marginBottom: 10,
    ...glowVerde(0.25, 20),
  },
  finishButtonBusy: { opacity: 0.7 },
  finishButtonText: { color: colors.onPrimary, fontWeight: '900', fontSize: 15, letterSpacing: 0.3 },
  avisoFinal: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 12 },

  // ---- Historial ----
  historialTituloRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 2,
  },
  historialCantidad: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '600' },
  sesionCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  sesionHeader: {
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceAlt,
  },
  sesionFechaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8 },
  sesionFecha: { color: colors.primary, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4 },
  sesionHora: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  sesionTituloRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 },
  sesionTitulo: { flex: 1, minWidth: 0, color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  sesionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  sesionBadgeCompleto: { borderColor: colors.primary, backgroundColor: VERDE_10 },
  sesionBadgeParcial: { borderColor: colors.surfaceAlt, backgroundColor: colors.background },
  sesionBadgeText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  sesionBadgeTextCompleto: { color: colors.primary },
  sesionEjercicios: { paddingTop: 12, gap: 10 },
  historialEjercicio: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  historialEjercicioNombre: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  historialEjercicioDatos: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  historialSeriesReps: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  historialPeso: { color: colors.primary, fontSize: 12.5, fontWeight: '900', minWidth: 48, textAlign: 'right' },
  avisoHistorial: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 12 },
  eliminarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 5,
    marginTop: 14,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  eliminarButtonText: { color: colors.danger, fontSize: 12.5, fontWeight: '700' },

  // ---- Modal de confirmación de borrado ----
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  modalIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: `${colors.danger}1F`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitulo: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  modalTexto: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  modalBotones: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
  modalCancelar: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  modalCancelarText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  modalEliminar: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.danger },
  modalEliminarText: { color: colors.white, fontWeight: '800', fontSize: 14 },
  historialSinPeso: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', minWidth: 48, textAlign: 'right' },

  // ---- Estados vacíos ----
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    marginTop: 8,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: VERDE_10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
    maxWidth: 280,
  },
  whatsappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25D366',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 20,
  },
  whatsappButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
