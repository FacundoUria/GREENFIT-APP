import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { formatDateOnly } from './classesApi';

// Sistema de XP/Niveles real (500 XP = 1 nivel) -- ver
// backend/supabase_migration_xp.sql para las 4 reglas vigentes. Esa
// migración todavía NO está corrida, así que fetchTotalXp() cae a una
// estimación (ver más abajo) hasta que se despliegue -- mismo criterio
// híbrido que ya usan comunidadApi.ts/ProgresoMobileView.

export const XP_POR_NIVEL = 500;

export interface XpResumen {
  totalXp: number;
  nivel: number;
  xpEnNivel: number; // 0..499, progreso dentro del nivel actual
  xpParaSubir: number; // XP_POR_NIVEL - xpEnNivel
}

export function calcularResumenXp(totalXp: number): XpResumen {
  const xpTotal = Math.max(0, totalXp);
  const nivel = Math.floor(xpTotal / XP_POR_NIVEL) + 1;
  const xpEnNivel = xpTotal % XP_POR_NIVEL;
  return { totalXp: xpTotal, nivel, xpEnNivel, xpParaSubir: XP_POR_NIVEL - xpEnNivel };
}

// 42P01 = undefined_table (Postgres). PGRST205 = PostgREST no encuentra la
// tabla en su schema cache -- mismo criterio que comunidadApi.ts.
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find');
}

// XP total acumulado real de la tabla xp_events. Si esa tabla todavía no
// está desplegada, estima el XP a partir de clases con asistencia real
// (mismo peso que la regla real de +100 por clase en disciplinas
// grupales) -- da el mismo número que el viejo placeholder de nivel
// (floor(clases/5)+1), así que no hay un salto raro el día que se active
// la tabla real.
export async function fetchTotalXp(userId: string): Promise<number> {
  const { data, error } = await supabase.from('xp_events').select('xp_amount').eq('user_id', userId);
  if (!error) return (data ?? []).reduce((acc, row: any) => acc + (row.xp_amount ?? 0), 0);
  if (!isMissingRelationError(error)) throw new Error(error.message);

  const { count, error: countError } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('attended', true);
  if (countError) throw new Error(countError.message);
  return (count ?? 0) * 100;
}

// +150 XP al registrar/superar un PR -- se llama SOLO cuando
// ProgresoMobileView detecta que el valor nuevo es un récord real (primera
// carga de ese PR, o mejora sobre el anterior). Silencioso si xp_events
// todavía no existe: el PR en sí es 100% local y se guarda igual, el XP
// simplemente no suma hasta que se despliegue la migración.
export async function otorgarXpPr(userId: string): Promise<void> {
  const { error } = await supabase.from('xp_events').insert({ user_id: userId, event_type: 'pr', xp_amount: 150 });
  if (error && !isMissingRelationError(error)) throw new Error(error.message);
}

// +25 XP al publicar en el Feed, tope 1 por día -- el índice único
// (user_id, event_date) de la migración hace que el segundo intento del
// mismo día choque con 23505 (unique_violation); eso se trata como "ya se
// ganó hoy", no como un error real.
export async function otorgarXpPost(userId: string): Promise<void> {
  const hoy = formatDateOnly(new Date());
  const { error } = await supabase
    .from('xp_events')
    .insert({ user_id: userId, event_type: 'post', xp_amount: 25, event_date: hoy });
  if (error && error.code !== '23505' && !isMissingRelationError(error)) throw new Error(error.message);
}

// -- Botón "¡Hoy entrené!" -- asistencia autoreportada por el socio, +100 XP,
// tope 1 por día. Comparte el índice único (user_id, event_date) de tipo
// 'asistencia' con la asistencia confirmada por el admin (trigger sobre
// bookings.attended): la que llegue primero ese día gana, no se acredita
// dos veces el mismo día por ninguna de las dos fuentes.

export async function checkXpDisponible(): Promise<boolean> {
  const { error } = await supabase.from('xp_events').select('id').limit(1);
  return !(error && isMissingRelationError(error));
}

function asistenciaHoyKey(userId: string): string {
  return `greenfit:asistencia-hoy:${userId}`;
}

// Si xp_events todavía no existe, el estado "ya registré hoy" se trackea
// local (mismo criterio que Metas/Notificaciones en modo demo) -- no
// otorga XP real, es solo para que el botón no quede como si nada hubiera
// pasado en la demo.
async function fetchAsistenciaHoyDemo(userId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(asistenciaHoyKey(userId));
    return raw === formatDateOnly(new Date());
  } catch {
    return false;
  }
}

export async function fetchAsistenciaHoyRegistrada(userId: string, modoDemo: boolean): Promise<boolean> {
  if (modoDemo) return fetchAsistenciaHoyDemo(userId);
  const hoy = formatDateOnly(new Date());
  const { data, error } = await supabase
    .from('xp_events')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', 'asistencia')
    .eq('event_date', hoy)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) return false;
    throw new Error(error.message);
  }
  return !!data;
}

// -- Racha real + "Clases del mes" -- reemplazan al placeholder fijo de
// PerfilMobileView y al conteo histórico ("Clases" = TODAS las asistencias
// de siempre, no las del mes). Ambas se calculan sobre las mismas fechas de
// 'asistencia' de xp_events (cubre clase confirmada por el admin Y el botón
// "¡Hoy entrené!" autoreportado, sin distinguir entre ambas fuentes -- para
// el socio, cualquiera de las dos es "entrené ese día"), con el mismo
// fallback a bookings.attended si xp_events todavía no existe.

export async function fetchFechasAsistencia(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('xp_events')
    .select('event_date')
    .eq('user_id', userId)
    .eq('event_type', 'asistencia');
  if (!error) return Array.from(new Set((data ?? []).map((row: any) => row.event_date as string)));
  if (!isMissingRelationError(error)) throw new Error(error.message);

  const { data: bookingsData, error: bookingsError } = await supabase
    .from('bookings')
    .select('booking_date')
    .eq('user_id', userId)
    .eq('attended', true);
  if (bookingsError) throw new Error(bookingsError.message);
  return Array.from(new Set((bookingsData ?? []).map((row: any) => row.booking_date as string)));
}

// Días CONSECUTIVOS contando hacia atrás desde hoy. Si hoy todavía no se
// registró nada, arranca a contar desde ayer -- la racha no se "apaga" de
// golpe a la medianoche si todavía queda margen en el día de hoy para
// entrenar y mantenerla; recién se pierde si pasa un día ENTERO sin
// registrar (el primer hueco corta el conteo ahí mismo).
export function calcularRachaDias(fechasAsistencia: string[], hoy: Date = new Date()): number {
  const fechasSet = new Set(fechasAsistencia);
  const cursor = new Date(hoy);
  cursor.setHours(0, 0, 0, 0);
  if (!fechasSet.has(formatDateOnly(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let racha = 0;
  while (fechasSet.has(formatDateOnly(cursor))) {
    racha++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return racha;
}

// "Clases del mes" -- días DISTINTOS con asistencia registrada dentro del
// mes en curso (no clases totales de siempre, ese era el bug: PerfilMobileView
// mostraba fetchClasesRealizadas(), un conteo histórico completo, bajo la
// etiqueta "Clases").
export async function fetchClasesDelMes(userId: string): Promise<number> {
  const now = new Date();
  const inicioMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const hoyStr = formatDateOnly(now);

  const { data, error } = await supabase
    .from('xp_events')
    .select('event_date')
    .eq('user_id', userId)
    .eq('event_type', 'asistencia')
    .gte('event_date', inicioMes)
    .lte('event_date', hoyStr);
  if (!error) return new Set((data ?? []).map((row: any) => row.event_date as string)).size;
  if (!isMissingRelationError(error)) throw new Error(error.message);

  const { count, error: countError } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('attended', true)
    .gte('booking_date', inicioMes)
    .lte('booking_date', hoyStr);
  if (countError) throw new Error(countError.message);
  return count ?? 0;
}

export type ResultadoAsistenciaDiaria = 'otorgado' | 'ya_registrado_hoy';

export async function otorgarXpAsistenciaDiaria(userId: string, modoDemo: boolean): Promise<ResultadoAsistenciaDiaria> {
  if (modoDemo) {
    try {
      await AsyncStorage.setItem(asistenciaHoyKey(userId), formatDateOnly(new Date()));
    } catch {
      // Best-effort -- mismo criterio que el resto de los módulos con AsyncStorage.
    }
    return 'otorgado';
  }
  const hoy = formatDateOnly(new Date());
  const { error } = await supabase
    .from('xp_events')
    .insert({ user_id: userId, event_type: 'asistencia', xp_amount: 100, event_date: hoy });
  if (error) {
    if (error.code === '23505') return 'ya_registrado_hoy';
    if (isMissingRelationError(error)) return 'otorgado'; // sin tabla todavía -- no hay nada que romper
    throw new Error(error.message);
  }
  return 'otorgado';
}
