import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { getDisciplineStyle } from '../../theme/disciplineColors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatDateOnly } from '../../lib/classesApi';
import { otorgarXpPr } from '../../lib/xpApi';
import {
  checkMetasDisponible,
  fetchMetaActiva,
  crearMeta,
  completarMeta,
  diasParaCompletar,
  MetaPersonal,
} from '../../lib/metasApi';

// Vista nueva y paralela (Módulo 5 del rediseño) -- standalone, todavía sin
// enganchar a ningún tab (a diferencia de Agenda/Perfil/Notificaciones, acá
// no hay ninguna solapa "Progreso" preexistente para reemplazar sin romper
// nada; ver el mensaje de wiring aparte).
//
// Asistencia mensual, clases del mes, horas entrenadas y rendimiento por
// disciplina son 100% datos reales (bookings.attended). Los PRs (marcas
// personales) y la evolución de cargas NO existen en ningún lado del
// backend -- no hay tabla de logs de entrenamiento. En vez de inventar una
// migración de Supabase para esto ahora, se trackean 100% LOCAL en
// AsyncStorage (mismo criterio ya validado en Notificaciones para
// "leído/no leído"): es dato real que el socio carga a mano, persiste en el
// dispositivo, solo que todavía no sincroniza entre dispositivos ni tiene
// respaldo en el servidor. Candidato natural a una tabla `personal_records`
// el día que se valide que vale la pena.

// react-native-svg YA es dependencia del proyecto (la usa
// react-native-qrcode-svg en CredentialScreen) -- se usa acá directo para el
// gráfico de evolución, sin sumar ninguna librería de charts nueva.

interface BookingConClase {
  bookingDate: string;
  attended: boolean | null;
  disciplineId: string;
  disciplineTitle: string;
  startTime: string; // "HH:mm:ss"
  endTime: string | null;
}

async function fetchBookingsDelMes(userId: string): Promise<BookingConClase[]> {
  const now = new Date();
  const inicioMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const hoyStr = formatDateOnly(now);

  const { data, error } = await supabase
    .from('bookings')
    .select('booking_date, attended, classes!inner(discipline_id, title, start_time, end_time)')
    .eq('user_id', userId)
    .gte('booking_date', inicioMes)
    .lte('booking_date', hoyStr);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => {
    const clase = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    return {
      bookingDate: row.booking_date,
      attended: row.attended,
      disciplineId: clase.discipline_id,
      disciplineTitle: clase.title,
      startTime: clase.start_time,
      endTime: clase.end_time,
    };
  });
}

interface AsistenciaHistorica {
  disciplineId: string;
  disciplineTitle: string;
}

// Todo-el-tiempo (no solo el mes) -- "rendimiento por disciplina" se arma
// sobre el acumulado histórico, a diferencia de las 3 métricas rápidas que
// son del mes en curso.
async function fetchAsistenciasHistoricas(userId: string): Promise<AsistenciaHistorica[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('classes!inner(discipline_id, title)')
    .eq('user_id', userId)
    .eq('attended', true);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => {
    const clase = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    return { disciplineId: clase.discipline_id, disciplineTitle: clase.title };
  });
}

export function duracionHoras(b: BookingConClase): number {
  if (!b.endTime) return 1; // sin hora de fin cargada -- asumimos 1h de clase
  const [h1, m1] = b.startTime.split(':').map(Number);
  const [h2, m2] = b.endTime.split(':').map(Number);
  const minutos = h2 * 60 + m2 - (h1 * 60 + m1);
  return minutos > 0 ? minutos / 60 : 1;
}

// -- PRs locales (AsyncStorage) --

interface PRCatalogItem {
  id: string;
  label: string;
  kind: 'peso' | 'tiempo';
}

// Fallback si `pr_catalog` todavía no está desplegada en Supabase (ver
// backend/supabase_migration_pr_catalog.sql, escrita pero sin correr) o si
// el admin la corrió pero la dejó vacía. Cero pantalla en blanco mientras
// tanto -- y es exactamente la misma semilla que carga esa migración, así
// que activar la tabla el día 1 no cambia nada visualmente.
const PR_CATALOGO: PRCatalogItem[] = [
  { id: 'back-squat', label: 'Back Squat', kind: 'peso' },
  { id: 'clean-and-jerk', label: 'Clean & Jerk', kind: 'peso' },
  { id: 'deadlift', label: 'Peso Muerto', kind: 'peso' },
  { id: 'snatch', label: 'Snatch', kind: 'peso' },
  { id: 'front-squat', label: 'Front Squat', kind: 'peso' },
  { id: 'wod-fran', label: 'WOD "Fran"', kind: 'tiempo' },
];

// Catálogo gestionado por el admin (crear/editar/activar qué marcas ve el
// alumno) -- todavía no existe la pantalla admin para esto (queda en el
// panel web, otro repo), pero el lado mobile ya queda listo para
// consumirla apenas se despliegue.
async function fetchPRCatalog(): Promise<PRCatalogItem[] | null> {
  const { data, error } = await supabase
    .from('pr_catalog')
    .select('id, label, kind')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error || !data || data.length === 0) return null;
  return data.map((r) => ({ id: r.id, label: r.label, kind: r.kind as 'peso' | 'tiempo' }));
}

interface PRValue {
  value: number; // kg si kind === 'peso', segundos totales si kind === 'tiempo'
  updatedAt: string;
}
type PRMap = Record<string, PRValue>;

interface HistorialPunto {
  fecha: string;
  totalKg: number;
}

function prsKey(userId: string): string {
  return `greenfit:prs:${userId}`;
}
function historialKey(userId: string): string {
  return `greenfit:prs-historial:${userId}`;
}

async function loadPRs(userId: string): Promise<PRMap> {
  try {
    const raw = await AsyncStorage.getItem(prsKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function savePRs(userId: string, prs: PRMap): Promise<void> {
  try {
    await AsyncStorage.setItem(prsKey(userId), JSON.stringify(prs));
  } catch {
    // Best-effort -- si falla, en el peor caso la próxima carga no ve el
    // último valor. No rompe nada crítico.
  }
}

async function loadHistorial(userId: string): Promise<HistorialPunto[]> {
  try {
    const raw = await AsyncStorage.getItem(historialKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Cada vez que se actualiza un PR de tipo "peso" se agrega un punto con el
// total acumulado de todos los PRs de peso en ESE momento -- así "Evolución
// de Cargas" es un gráfico real de la propia actividad del socio, no data
// de muestra. Recortado a los últimos 20 puntos para no crecer sin límite.
async function appendHistorialPunto(userId: string, totalKg: number): Promise<HistorialPunto[]> {
  const historial = await loadHistorial(userId);
  historial.push({ fecha: new Date().toISOString(), totalKg });
  const recortado = historial.slice(-20);
  try {
    await AsyncStorage.setItem(historialKey(userId), JSON.stringify(recortado));
  } catch {
    // Best-effort, ver comentario de savePRs.
  }
  return recortado;
}

function formatFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

export function formatSegundosATexto(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function parseTextoATiempo(texto: string): number | null {
  const match = texto.trim().match(/^(\d+):([0-5]?\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Mismo criterio que PerfilMobileView.getInitials -- se duplica acá (vista
// paralela) en vez de exportarla desde ese módulo.
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function mensajeMotivador(pctAsistencia: number, clasesDelMes: number): string {
  if (clasesDelMes === 0) return '¡Arrancamos el mes! Reservá tu primera clase.';
  if (pctAsistencia >= 80) return '¡Estás on fire! Seguí así. 🔥';
  if (pctAsistencia >= 50) return 'Vas por buen camino. 💪';
  return 'Sumá una clase más esta semana.';
}

// -- Gráfico de evolución (SVG liviano, sin librería de charts) --

function CargaChart({ data, onRegistrarClick }: { data: HistorialPunto[]; onRegistrarClick: () => void }) {
  if (data.length < 2) {
    return (
      <View style={styles.chartEmpty}>
        <Ionicons name="trending-up-outline" size={22} color={colors.textSecondary} />
        <Text style={styles.chartEmptyText}>
          {data.length === 0
            ? 'Registrá tu primer PR para empezar a ver tu evolución de cargas.'
            : 'Sumá otra actualización de PR para ver la curva completa.'}
        </Text>
        {data.length === 0 && (
          <TouchableOpacity style={styles.chartCtaButton} onPress={onRegistrarClick}>
            <Ionicons name="add-circle" size={16} color={colors.onPrimary} />
            <Text style={styles.chartCtaButtonText}>Registrar mi primer PR</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const width = 300;
  const height = 120;
  const padding = 16;
  const values = data.map((d) => d.totalKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = data.map((d, i) => ({
    x: padding + (i / (data.length - 1)) * (width - padding * 2),
    y: height - padding - ((d.totalKg - min) / range) * (height - padding * 2),
  }));
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Polyline points={polylinePoints} fill="none" stroke={colors.primary} strokeWidth={2.5} />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={colors.primary} />
        ))}
      </Svg>
      <View style={styles.chartFooterRow}>
        <Text style={styles.chartFooterText}>{formatFechaCorta(data[0].fecha)}</Text>
        <Text style={styles.chartFooterValue}>{Math.round(data[data.length - 1].totalKg)} kg totales</Text>
        <Text style={styles.chartFooterText}>{formatFechaCorta(data[data.length - 1].fecha)}</Text>
      </View>
    </View>
  );
}

// -- Modal para cargar/actualizar UNA marca personal --

function PRModal({
  lift,
  current,
  onSave,
  onClose,
}: {
  lift: PRCatalogItem | null;
  current: PRValue | null;
  onSave: (value: number) => void;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState('');

  useEffect(() => {
    if (!lift) return;
    if (!current) {
      setTexto('');
      return;
    }
    setTexto(lift.kind === 'peso' ? String(current.value) : formatSegundosATexto(current.value));
  }, [lift, current]);

  if (!lift) return null;

  function handleSave() {
    if (!lift) return;
    const parsed = lift.kind === 'peso' ? Number(texto.replace(',', '.')) : parseTextoATiempo(texto);
    if (!parsed || parsed <= 0) {
      Alert.alert(
        'Valor inválido',
        lift.kind === 'peso' ? 'Ingresá un peso en kilos (ej: 82.5).' : 'Ingresá un tiempo en formato mm:ss (ej: 4:15).'
      );
      return;
    }
    onSave(parsed);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{lift.label}</Text>
          <Text style={styles.modalSubtitle}>
            {lift.kind === 'peso' ? 'Ingresá tu marca en kilos' : 'Ingresá tu marca en minutos:segundos'}
          </Text>
          <TextInput
            style={styles.modalInput}
            placeholder={lift.kind === 'peso' ? 'Ej: 82.5' : 'Ej: 4:15'}
            placeholderTextColor={colors.textSecondary}
            keyboardType={lift.kind === 'peso' ? 'decimal-pad' : 'default'}
            value={texto}
            onChangeText={setTexto}
            autoFocus
          />
          <View style={styles.modalButtonRow}>
            <TouchableOpacity style={styles.modalSecondaryButton} onPress={onClose}>
              <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalPrimaryButton} onPress={handleSave}>
              <Text style={styles.modalPrimaryButtonText}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function ProgresoMobileView() {
  const { user } = useAuth();
  const [bookingsDelMes, setBookingsDelMes] = useState<BookingConClase[]>([]);
  const [historicas, setHistoricas] = useState<AsistenciaHistorica[]>([]);
  const [prs, setPrs] = useState<PRMap>({});
  const [historial, setHistorial] = useState<HistorialPunto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLift, setEditingLift] = useState<PRCatalogItem | null>(null);
  const [prCatalogo, setPrCatalogo] = useState<PRCatalogItem[]>(PR_CATALOGO);

  const [modoDemoMetas, setModoDemoMetas] = useState(false);
  const [metaActiva, setMetaActiva] = useState<MetaPersonal | null>(null);
  const [nuevaMetaTexto, setNuevaMetaTexto] = useState('');
  const [creandoMeta, setCreandoMeta] = useState(false);
  const [completandoMeta, setCompletandoMeta] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [mes, historicasData, prsData, historialData, catalogo, metasOk] = await Promise.all([
        fetchBookingsDelMes(user.id),
        fetchAsistenciasHistoricas(user.id),
        loadPRs(user.id),
        loadHistorial(user.id),
        fetchPRCatalog(),
        checkMetasDisponible(),
      ]);
      setBookingsDelMes(mes);
      setHistoricas(historicasData);
      setPrs(prsData);
      setHistorial(historialData);
      setPrCatalogo(catalogo ?? PR_CATALOGO);
      setModoDemoMetas(!metasOk);
      setMetaActiva(await fetchMetaActiva(user.id, !metasOk));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu progreso.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  async function handleSavePR(value: number) {
    if (!user || !editingLift) return;
    const lift = editingLift;
    const anterior = prs[lift.id] ?? null;
    // "Registrar / superar" un PR -- primera carga de ESE PR, o una mejora
    // real sobre el anterior (más kilos si es 'peso'; menos segundos si es
    // 'tiempo', porque ahí más rápido = mejor). Cargar un valor peor o
    // idéntico no otorga XP.
    const esRecordNuevo = !anterior || (lift.kind === 'peso' ? value > anterior.value : value < anterior.value);

    const next = { ...prs, [lift.id]: { value, updatedAt: new Date().toISOString() } };
    setPrs(next);
    await savePRs(user.id, next);

    if (lift.kind === 'peso') {
      const totalKg = prCatalogo.filter((l) => l.kind === 'peso').reduce((acc, l) => acc + (next[l.id]?.value ?? 0), 0);
      setHistorial(await appendHistorialPunto(user.id, totalKg));
    }
    if (esRecordNuevo) {
      // Efecto secundario, no bloquea el guardado del PR si falla.
      otorgarXpPr(user.id).catch((err) => console.error('No se pudo otorgar XP de PR:', err.message));
    }
    setEditingLift(null);
  }

  async function handleCrearMeta() {
    if (!user || !nuevaMetaTexto.trim()) return;
    setCreandoMeta(true);
    try {
      await crearMeta(user.id, nuevaMetaTexto.trim(), modoDemoMetas);
      setNuevaMetaTexto('');
      setMetaActiva(await fetchMetaActiva(user.id, modoDemoMetas));
    } catch (err) {
      Alert.alert('No se pudo crear la meta', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setCreandoMeta(false);
    }
  }

  async function handleCompletarMeta() {
    if (!user || !metaActiva) return;
    setCompletandoMeta(true);
    try {
      await completarMeta(user.id, metaActiva, modoDemoMetas);
      setMetaActiva(null);
      Alert.alert('¡Meta completada! 🎉', modoDemoMetas ? 'En modo demo esto no suma XP real todavía.' : 'Sumaste +300 XP.');
    } catch (err) {
      Alert.alert('No se pudo completar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setCompletandoMeta(false);
    }
  }

  if (!user) return null;

  const reservadas = bookingsDelMes.length;
  const asistidas = bookingsDelMes.filter((b) => b.attended === true).length;
  const porcentajeAsistencia = reservadas > 0 ? Math.round((asistidas / reservadas) * 100) : 0;
  const horasEntrenadas = bookingsDelMes.filter((b) => b.attended === true).reduce((acc, b) => acc + duracionHoras(b), 0);

  const conteoPorDisciplina = new Map<string, { title: string; count: number }>();
  for (const a of historicas) {
    const prev = conteoPorDisciplina.get(a.disciplineId);
    if (prev) prev.count += 1;
    else conteoPorDisciplina.set(a.disciplineId, { title: a.disciplineTitle, count: 1 });
  }
  const maxCount = Math.max(1, ...Array.from(conteoPorDisciplina.values()).map((d) => d.count));
  const disciplinas = Array.from(conteoPorDisciplina.values())
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ ...d, pct: Math.round((d.count / maxCount) * 100) }));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
    >
      {!!error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.motivationCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.motivationTitle}>{mensajeMotivador(porcentajeAsistencia, asistidas)}</Text>
          <Text style={styles.motivationSubtitle}>Cada clase suma para tu próximo nivel.</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.metricValue}>{porcentajeAsistencia}%</Text>
          <Text style={styles.metricLabel}>Asistencia del mes</Text>
        </View>
        <View style={styles.metricCard}>
          <Ionicons name="barbell-outline" size={18} color={colors.primary} />
          <Text style={styles.metricValue}>{asistidas}</Text>
          <Text style={styles.metricLabel}>Clases este mes</Text>
        </View>
        <View style={styles.metricCard}>
          <Ionicons name="time-outline" size={18} color={colors.primary} />
          <Text style={styles.metricValue}>{horasEntrenadas.toFixed(1)}h</Text>
          <Text style={styles.metricLabel}>Horas entrenadas</Text>
        </View>
      </View>

      <View style={styles.sectionTitleRow}>
        <Ionicons name="trending-up-outline" size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>Evolución de cargas</Text>
      </View>
      <View style={styles.card}>
        <CargaChart data={historial} onRegistrarClick={() => setEditingLift(prCatalogo[0])} />
      </View>

      <View style={styles.sectionTitleRow}>
        <Ionicons name="stats-chart-outline" size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>Rendimiento por disciplina</Text>
      </View>
      <View style={styles.card}>
        {isLoading && disciplinas.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
        ) : disciplinas.length === 0 ? (
          <Text style={styles.emptyText}>Todavía no tenés clases con asistencia registrada.</Text>
        ) : (
          disciplinas.map((d) => {
            const disciplineStyle = getDisciplineStyle(d.title);
            return (
              <View key={d.title} style={styles.barRow}>
                <View style={styles.barLabelRow}>
                  <Ionicons name={disciplineStyle.icon} size={13} color={disciplineStyle.color} />
                  <Text style={styles.barLabel} numberOfLines={1}>
                    {d.title}
                  </Text>
                  <Text style={styles.barCount}>{d.count}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${d.pct}%`, backgroundColor: disciplineStyle.color }]} />
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.sectionTitleRow}>
        <Ionicons name="trophy-outline" size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>Mis marcas personales</Text>
      </View>
      <View style={styles.prGrid}>
        {prCatalogo.map((lift) => {
          const current = prs[lift.id] ?? null;
          return (
            <TouchableOpacity key={lift.id} style={styles.prCard} onPress={() => setEditingLift(lift)}>
              <Text style={styles.prLabel} numberOfLines={1}>
                {lift.label}
              </Text>
              {current ? (
                <>
                  <Text style={styles.prValue}>
                    {lift.kind === 'peso' ? `${current.value} kg` : formatSegundosATexto(current.value)}
                  </Text>
                  <Text style={styles.prDate}>{formatFechaCorta(current.updatedAt)}</Text>
                </>
              ) : (
                <View style={styles.prEmptyRow}>
                  <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                  <Text style={styles.prEmptyText}>Registrar</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.sectionTitleRow}>
        <Ionicons name="flag-outline" size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>Mi meta personal</Text>
      </View>
      <View style={styles.card}>
        {modoDemoMetas && (
          <Text style={styles.metaDemoText}>
            Modo demo: completar una meta acá todavía no suma XP real (falta desplegar la migración).
          </Text>
        )}
        {metaActiva ? (
          (() => {
            const faltan = diasParaCompletar(metaActiva);
            return (
              <>
                <Text style={styles.metaTexto}>{metaActiva.texto}</Text>
                <Text style={styles.metaFecha}>
                  Creada el {formatFechaCorta(metaActiva.createdAt)} ·{' '}
                  {faltan > 0 ? `podés completarla en ${faltan} ${faltan === 1 ? 'día' : 'días'}` : 'ya podés completarla'}
                </Text>
                <TouchableOpacity
                  style={[styles.metaButton, faltan > 0 && styles.metaButtonDisabled]}
                  disabled={faltan > 0 || completandoMeta}
                  onPress={handleCompletarMeta}
                >
                  {completandoMeta ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={styles.metaButtonText}>
                      {faltan > 0 ? `Disponible en ${faltan} ${faltan === 1 ? 'día' : 'días'}` : 'Marcar como completada (+300 XP)'}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            );
          })()
        ) : (
          <>
            <TextInput
              style={styles.metaInput}
              placeholder="Ej: Bajar 5kg, hacer 10 dominadas seguidas..."
              placeholderTextColor={colors.textSecondary}
              value={nuevaMetaTexto}
              onChangeText={setNuevaMetaTexto}
            />
            <TouchableOpacity
              style={[styles.metaButton, !nuevaMetaTexto.trim() && styles.metaButtonDisabled]}
              disabled={!nuevaMetaTexto.trim() || creandoMeta}
              onPress={handleCrearMeta}
            >
              {creandoMeta ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <Text style={styles.metaButtonText}>Crear meta</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      <PRModal
        lift={editingLift}
        current={editingLift ? prs[editingLift.id] ?? null : null}
        onSave={handleSavePR}
        onClose={() => setEditingLift(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  error: { color: colors.danger, marginBottom: 12 },

  motivationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontSize: 18, fontWeight: '800' },
  motivationTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  motivationSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },

  metricsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  metricValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  metricLabel: { color: colors.textSecondary, fontSize: 10, textAlign: 'center', paddingHorizontal: 4 },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  emptyText: { color: colors.textSecondary, fontSize: 13 },

  chartEmpty: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  chartEmptyText: { color: colors.textSecondary, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  chartCtaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  chartCtaButtonText: { color: colors.onPrimary, fontSize: 12.5, fontWeight: '700' },
  chartFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  chartFooterText: { color: colors.textSecondary, fontSize: 11 },
  chartFooterValue: { color: colors.primary, fontSize: 12.5, fontWeight: '800' },

  barRow: { marginBottom: 14 },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  barLabel: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  barCount: { color: colors.textSecondary, fontSize: 11 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  prGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  prCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  prLabel: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '600', marginBottom: 6 },
  prValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  prDate: { color: colors.textSecondary, fontSize: 10.5, marginTop: 3 },
  prEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  prEmptyText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },

  metaDemoText: { color: colors.warning, fontSize: 11.5, fontWeight: '600', marginBottom: 10, lineHeight: 16 },
  metaTexto: { color: colors.textPrimary, fontSize: 14.5, fontWeight: '700', lineHeight: 20 },
  metaFecha: { color: colors.textSecondary, fontSize: 12, marginTop: 6, marginBottom: 14 },
  metaInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 14,
    color: colors.textPrimary,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  metaButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  metaButtonDisabled: { backgroundColor: colors.surfaceAlt },
  metaButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13.5 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { color: colors.textSecondary, fontSize: 13, marginBottom: 14 },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 14,
    color: colors.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  modalButtonRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalSecondaryButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  modalSecondaryButtonText: { color: colors.textPrimary, fontWeight: '600' },
  modalPrimaryButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.primary },
  modalPrimaryButtonText: { color: colors.onPrimary, fontWeight: '700' },
});
