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
  DiaHistorial,
  SesionHistorial,
} from '../../lib/routinesApi';
import { formatDateOnly } from '../../lib/classesApi';
import { Routine, RoutineExercise } from '../../types';
import VideoModal from '../../components/VideoModal';
import RoutineCompleteModal from '../../components/RoutineCompleteModal';

const CONTACTO_WHATSAPP = 'https://wa.me/5492617139662';

const ZONA_ARGENTINA = 'America/Argentina/Mendoza';
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// "2026-09-26" -> "26 de septiembre" (con año solo si no es el año en curso).
// `fecha` ya viene calculada en horario de Mendoza por el servidor, así que
// se lee tal cual, sin pasar por Date (evita el corrimiento de día por UTC).
export function formatFechaHistorial(fecha: string, hoy: Date = new Date()): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const anioActual = Number(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_ARGENTINA, year: 'numeric' }).format(hoy));
  const base = `${dia} de ${MESES[mes - 1]}`;
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

function resumenSesion(s: SesionHistorial): string {
  return s.completo ? 'Completo' : `${s.ejercicios.length} de ${s.totalEjercicios} ejercicios`;
}

// Chip chico con ícono para un dato de la sub-línea (Series x Reps / Carga /
// Descanso) -- reemplaza la grilla rígida de 4 rectángulos: acá son solo
// texto en línea, mucho más liviano de leer de un vistazo.
function MetaChip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={13} color={colors.textSecondary} />
      <Text style={styles.metaChipText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// Encabezado de sección por grupo muscular ("PECHO", "TRÍCEPS"...) -- agrupa
// visualmente el entrenamiento de un vistazo, mismo color por grupo que usa
// el Admin (colorGrupoMuscular, paleta compartida entre las dos apps).
function GroupHeader({ grupo }: { grupo: string }) {
  const color = colorGrupoMuscular(grupo);
  return (
    <View style={styles.groupHeaderRow}>
      <View style={[styles.groupPill, { backgroundColor: color.bg }]}>
        <Text style={[styles.groupPillText, { color: color.text }]}>{grupo.toUpperCase()}</Text>
      </View>
      <View style={styles.groupHeaderLine} />
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
      <Ionicons name="barbell-outline" size={13} color={colors.textSecondary} />
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

// Fila de checklist ancha: nombre + sub-línea con íconos a la izquierda,
// checkbox táctil gigante (48x48 mín.) a la derecha. Al completarse, una
// transición suave (Animated, no LayoutAnimation -- no-op en react-native-web,
// el target principal de esta pantalla) tiñe el borde de verde neón y
// suaviza el texto, para dar feedback claro de "ítem cumplido".
function ExerciseRow({
  bloque,
  completado,
  peso,
  onToggle,
  onGuardarPeso,
  onVerDemo,
}: {
  bloque: RoutineExercise;
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
  const nameOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });

  const instrucciones = bloque.notes || bloque.exercise.description;

  return (
    <Animated.View style={[styles.exerciseRow, { borderColor }]}>
      <View style={styles.exerciseRowMain}>
        <Animated.Text style={[styles.exerciseName, { opacity: nameOpacity }]} numberOfLines={2}>
          {bloque.exercise.name}
        </Animated.Text>

        <View style={styles.metaLine}>
          <MetaChip icon="repeat-outline" text={`${bloque.sets ?? '-'} × ${bloque.reps || '-'}`} />
          {/* Carga editable -- recuerda la última que el socio cargó a mano
              (persistente entre sesiones), no la sugerencia fija del
              entrenador. Chip aparte de Descanso porque este SÍ se toca. */}
          <CargaInput valor={peso} onGuardar={onGuardarPeso} />
          {!!bloque.restSeconds && <MetaChip icon="time-outline" text={`${bloque.restSeconds}s descanso`} />}
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
        style={styles.checkButton}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completado }}
        accessibilityLabel={completado ? `${bloque.exercise.name}, completado` : `Marcar ${bloque.exercise.name} como completado`}
      >
        <Ionicons
          name={completado ? 'checkmark-circle' : 'ellipse-outline'}
          size={40}
          color={completado ? colors.primary : colors.textSecondary}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

// Una entrada del historial (un "Finalizar Entrenamiento"): hora + día de la
// rutina + si quedó completo, y la lista de lo que hizo con el peso que
// tenía en ese momento.
function SesionCard({ sesion }: { sesion: SesionHistorial }) {
  return (
    <View style={styles.sesionCard}>
      <View style={styles.sesionHeader}>
        <View style={styles.sesionHeaderText}>
          <Text style={styles.sesionHora}>{formatHoraArgentina(sesion.creadoEn)} hs</Text>
          {!!sesion.tituloDia && (
            <Text style={styles.sesionTitulo} numberOfLines={1}>
              {sesion.tituloDia}
            </Text>
          )}
        </View>
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

      {sesion.ejercicios.map((e) => (
        <View key={e.id} style={styles.historialEjercicio}>
          <Text style={styles.historialEjercicioNombre}>{e.nombre}</Text>
          <View style={styles.metaLine}>
            <MetaChip icon="repeat-outline" text={`${e.series ?? '-'} × ${e.repeticiones || '-'}`} />
            <MetaChip icon="barbell-outline" text={e.peso || 'Sin carga'} />
          </View>
        </View>
      ))}
    </View>
  );
}

// Pestaña "Historial": un bloque desplegable por día (más reciente arriba).
// Si ese día finalizó más de una vez (mañana y tarde), cada entrada se ve
// por separado con su hora. Solo lectura: no hay nada para editar acá.
function HistorialView({ dias, cargando, error }: { dias: DiaHistorial[]; cargando: boolean; error: string | null }) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  // El día más reciente arranca abierto -- lo más probable es que sea lo
  // que el socio quiere ver.
  const masReciente = dias[0]?.fecha;
  useEffect(() => {
    if (masReciente) setAbiertos((prev) => (prev.size === 0 ? new Set([masReciente]) : prev));
  }, [masReciente]);

  function toggle(fecha: string) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(fecha)) next.delete(fecha);
      else next.add(fecha);
      return next;
    });
  }

  if (cargando && dias.length === 0) return <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />;
  if (error) return <Text style={styles.error}>{error}</Text>;

  if (dias.length === 0) {
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
      {dias.map((dia) => {
        const abierto = abiertos.has(dia.fecha);
        const resumen =
          dia.sesiones.length > 1 ? `${dia.sesiones.length} entrenamientos` : resumenSesion(dia.sesiones[0]);
        const incompleto = dia.sesiones.length === 1 && !dia.sesiones[0].completo;
        return (
          <View key={dia.fecha} style={styles.diaCard}>
            <TouchableOpacity
              style={styles.diaHeader}
              onPress={() => toggle(dia.fecha)}
              accessibilityRole="button"
              accessibilityState={{ expanded: abierto }}
            >
              <View style={styles.sesionHeaderText}>
                <Text style={styles.diaFecha}>{formatFechaHistorial(dia.fecha)}</Text>
                <Text style={[styles.diaResumen, incompleto && styles.diaResumenIncompleto]}>{resumen}</Text>
              </View>
              <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {abierto && dia.sesiones.map((s) => <SesionCard key={s.sesionId} sesion={s} />)}
          </View>
        );
      })}
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
  const [finalizando, setFinalizando] = useState(false);
  // Aviso inline debajo del botón (0 marcados / cooldown / error) -- visible
  // también en web, donde Alert.alert es un no-op.
  const [avisoFinal, setAvisoFinal] = useState<string | null>(null);
  const [historial, setHistorial] = useState<DiaHistorial[]>([]);
  const [historialCargando, setHistorialCargando] = useState(false);
  const [historialError, setHistorialError] = useState<string | null>(null);

  const todayStr = useMemo(() => formatDateOnly(new Date()), []);

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
      setSelectedDayIdx((prev) => (r && prev < r.days.length ? prev : 0));
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
  // servidor comparando contra el total del día). El cooldown de 1 hora lo
  // valida el servidor; acá solo se muestra su respuesta.
  async function handleFinalizar() {
    if (!user || !diaActual || finalizando) return;
    setAvisoFinal(null);

    const marcados = diaActual.exercises.filter((e) => completados.has(e.id));
    if (marcados.length === 0) {
      setAvisoFinal('Marcá al menos un ejercicio para finalizar el entrenamiento.');
      return;
    }

    setFinalizando(true);
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
      if (resultado.estado === 'cooldown') {
        setAvisoFinal(
          `Ya registraste un entrenamiento hace poco. Podés volver a finalizar a partir de las ${formatHoraArgentina(
            resultado.disponibleDesde
          )}.`
        );
        return;
      }
      setModalFinalVisible(true);
    } catch (err) {
      setAvisoFinal(
        `No se pudo guardar el entrenamiento: ${err instanceof Error ? err.message : 'intentá de nuevo.'}`
      );
    } finally {
      setFinalizando(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={vista === 'hoy' ? isLoading : historialCargando}
          onRefresh={vista === 'hoy' ? load : loadHistorial}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.vistaTabs} accessibilityRole="tablist">
        {(
          [
            ['hoy', 'Rutina de hoy'],
            ['historial', 'Historial'],
          ] as const
        ).map(([clave, etiqueta]) => {
          const activa = vista === clave;
          return (
            <TouchableOpacity
              key={clave}
              onPress={() => setVista(clave)}
              style={[styles.vistaTab, activa && styles.vistaTabActiva]}
              accessibilityRole="tab"
              accessibilityState={{ selected: activa }}
            >
              <Text style={[styles.vistaTabText, activa && styles.vistaTabTextActiva]}>{etiqueta}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {vista === 'historial' ? (
        <HistorialView dias={historial} cargando={historialCargando} error={historialError} />
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
              {/* Header tipo "ficha de entrenamiento": ícono temático + título
                  personalizado, badge de Día/enfoque debajo, y a la derecha un
                  indicador de progreso en pill (sin barra de porcentaje --
                  "2 de 5 completados" se lee más rápido, sobre todo para
                  adultos mayores). */}
              <View style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View style={styles.heroTitleGroup}>
                    <View style={styles.heroIconCircle}>
                      <Text style={styles.heroIconEmoji}>🏋️‍♂️</Text>
                    </View>
                    <View style={styles.heroTitleTextGroup}>
                      <Text style={styles.heroTitle} numberOfLines={2}>
                        Rutina de {(user?.name || 'vos').split(' ')[0]}
                      </Text>
                      <View style={styles.heroFocusPill}>
                        <Text style={styles.heroFocusPillText} numberOfLines={1}>
                          {diaActual.title?.trim() || 'Entrenamiento de Hoy'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={[styles.progressPill, diaCompleto && styles.progressPillDone]}>
                    <Ionicons
                      name={diaCompleto ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={colors.primary}
                    />
                    <Text style={styles.progressPillText}>
                      {totalDia > 0 ? `${completadosDia}/${totalDia} completados` : '0/0'}
                    </Text>
                  </View>
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

              {diaActual.exercises.length === 0 ? (
                <Text style={styles.empty}>Este día todavía no tiene ejercicios cargados.</Text>
              ) : (
                gruposDelDia.map(({ grupo, ejercicios }) => (
                  <View key={grupo} style={styles.groupBlock}>
                    <GroupHeader grupo={grupo} />
                    {ejercicios.map((bloque) => (
                      <ExerciseRow
                        key={bloque.id}
                        bloque={bloque}
                        completado={completados.has(bloque.id)}
                        peso={pesoDe(bloque)}
                        onToggle={() => handleToggle(bloque.id)}
                        onGuardarPeso={(nuevoValor) => handleGuardarPeso(bloque.id, nuevoValor)}
                        onVerDemo={setVideoUrl}
                      />
                    ))}
                  </View>
                ))
              )}

              <TouchableOpacity
                style={[styles.finishButton, diaCompleto && styles.finishButtonDone, finalizando && styles.finishButtonBusy]}
                onPress={handleFinalizar}
                disabled={finalizando}
                activeOpacity={0.85}
              >
                {finalizando ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.finishButtonText}>🔥 Finalizar Entrenamiento</Text>
                )}
              </TouchableOpacity>
              {!!avisoFinal && <Text style={styles.avisoFinal}>{avisoFinal}</Text>}
            </>
          )}
        </>
      )}

      <VideoModal visible={!!videoUrl} videoUrl={videoUrl} onClose={() => setVideoUrl(null)} />
      <RoutineCompleteModal
        visible={modalFinalVisible}
        completos={completadosDia}
        total={totalDia}
        onClose={() => setModalFinalVisible(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  error: { color: colors.danger, marginTop: 20 },
  empty: { color: colors.textSecondary, marginTop: 12, textAlign: 'center' },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    marginTop: 20,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
    maxWidth: 260,
  },
  whatsappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25D366',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 20,
  },
  whatsappButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },

  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  heroTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  heroIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 255, 56, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  heroIconEmoji: { fontSize: 22 },
  heroTitleTextGroup: { flexShrink: 1 },
  heroTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '700' },
  heroFocusPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  heroFocusPillText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '600' },

  // Pill "tecnológica" del progreso: fondo oscuro + borde verde neón
  // translúcido, en vez de un texto suelto -- mismo dato ("2 de 5
  // completados") pero con más jerarquía visual.
  progressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 56, 0.3)',
  },
  progressPillDone: { borderColor: colors.primary, backgroundColor: 'rgba(0, 255, 56, 0.1)' },
  progressPillText: { color: colors.primary, fontSize: 12.5, fontWeight: '800' },

  dayTabsScroll: { marginBottom: 14 },
  dayTabsRow: { gap: 8, paddingRight: 8 },
  dayTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    maxWidth: 180,
  },
  dayTabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayTabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  dayTabTextSelected: { color: colors.onPrimary },

  groupBlock: { marginBottom: 6 },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, marginBottom: 10 },
  groupPill: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  groupPillText: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5 },
  groupHeaderLine: { flex: 1, height: 1, backgroundColor: colors.surfaceAlt },

  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
  },
  exerciseRowMain: { flex: 1, minWidth: 0 },
  exerciseName: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },

  metaLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  metaChipText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '600' },

  // Mismo look que metaChip, pero es un campo editable de verdad -- borde
  // sutil + ícono de lápiz para que se note que se puede tocar y escribir,
  // sin que la fila entera se vea como un formulario.
  cargaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  cargaInput: {
    color: colors.textPrimary,
    fontSize: 12.5,
    fontWeight: '600',
    minWidth: 40,
    maxWidth: 90,
    paddingVertical: 2,
  },

  instructionsBox: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  instructionsText: { flex: 1, color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },

  videoButton: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 12,
  },
  videoButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },

  // Botón/checkbox táctil: 48x48 mínimo recomendado para el pulgar (incluso
  // en adultos mayores), bien separado del texto para que no haya toques
  // accidentales sobre el nombre/detalles.
  checkButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },

  finishButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 18,
    marginTop: 10,
    marginBottom: 10,
  },
  finishButtonDone: { backgroundColor: colors.primaryDark },
  finishButtonBusy: { opacity: 0.7 },
  finishButtonText: { color: colors.onPrimary, fontWeight: '800', fontSize: 16 },
  avisoFinal: {
    color: colors.textSecondary,
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 12,
  },

  // Tabs "Rutina de hoy" / "Historial" -- control segmentado arriba de todo.
  vistaTabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  vistaTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  vistaTabActiva: { backgroundColor: colors.primary },
  vistaTabText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  vistaTabTextActiva: { color: colors.onPrimary },

  diaCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  diaHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  diaFecha: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  diaResumen: { color: colors.primary, fontSize: 12.5, fontWeight: '700', marginTop: 3 },
  diaResumenIncompleto: { color: colors.textSecondary },

  sesionCard: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sesionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  sesionHeaderText: { flex: 1, minWidth: 0 },
  sesionHora: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  sesionTitulo: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  sesionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  sesionBadgeCompleto: { borderColor: colors.primary, backgroundColor: 'rgba(0, 255, 56, 0.1)' },
  sesionBadgeParcial: { borderColor: colors.surfaceAlt, backgroundColor: colors.background },
  sesionBadgeText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  sesionBadgeTextCompleto: { color: colors.primary },

  historialEjercicio: { paddingVertical: 8 },
  historialEjercicioNombre: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
});
