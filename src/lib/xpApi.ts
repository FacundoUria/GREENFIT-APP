import { supabase } from './supabase';
import { formatDateOnly } from './classesApi';

// Sistema de XP/Niveles real (500 XP = 1 nivel) -- ver
// backend/supabase_migration_xp.sql para el esquema base,
// backend/supabase_migration_xp_solo_asistencia.sql para la regla que sacó
// TODO autoreporte del socio (¡Hoy entrené!, publicar en la Comunidad, PR,
// Meta) y PAGINA SUPABASE/supabase_migration_hoy_entrene.sql para la
// reincorporación puntual y limitada de "Hoy Entrené" (con un límite
// diario real -- tantos clics como disciplinas activas tenga, no
// autoreporte libre). Las demás fuentes de autoreporte siguen sin existir.
// Esa migración todavía puede no estar corrida, así que fetchTotalXp() cae
// a una estimación (ver más abajo) hasta que se despliegue.
//
// TODA acción positiva de gamificación otorga SIEMPRE Y EXACTAMENTE 100 XP
// -- reserva (+100), asistencia real (+100), Check-in Rápido de Musculación
// (+100), y ahora "Hoy Entrené" (+100). Ninguna otorga un valor distinto.

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

// Asistencia de HOY -- de solo lectura: refleja si el Admin (o el trigger de
// clase reservada) ya acreditó los +100 XP de hoy, sin ninguna acción que el
// socio pueda disparar desde acá. Si xp_events todavía no existe, no hay
// forma real de saberlo -- se responde `false` (no hay nada que fingir).
export async function fetchAsistenciaHoyRegistrada(userId: string): Promise<boolean> {
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
// 'asistencia' de xp_events (asistencia acreditada por el Admin, cualquiera
// sea la disciplina), con el mismo fallback a bookings.attended si
// xp_events todavía no existe.

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

// `created_at` de `profiles` (fecha de alta real) -- no lo trae AuthContext
// (solo pide id/full_name/dni/phone/role/active/avatar_url), se pide acá
// aparte. Usada por la tarjeta de perfil gamificada (AthleteProfileCard),
// tanto desde Mi Perfil como desde Inicio.
export async function fetchMiembroDesde(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('created_at').eq('id', userId).single();
  if (error || !data?.created_at) return null;
  return data.created_at as string;
}

// -- "Hoy Entrené" (autoreporte con límite diario = disciplinas activas) --
// ver PAGINA SUPABASE/supabase_migration_hoy_entrene.sql para el detalle
// completo del RPC y por qué hace falta (reemplazó al índice único viejo
// de "1 por día" fijo, que no admitía un límite variable).

// De solo lectura -- para pintar el estado inicial del botón (cuántos
// autoreportes ya se usaron hoy) sin gastar ningún intento. El límite REAL
// lo vuelve a calcular el RPC del lado servidor en cada click -- esto es
// nada más para que la UI no arranque siempre en "0 usados" aunque el
// socio ya haya tocado el botón antes hoy y haya recargado la pantalla.
export async function fetchEntrenamientosHoy(userId: string): Promise<number> {
  const hoy = formatDateOnly(new Date());
  const { data, error } = await supabase
    .from('xp_events')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', 'asistencia')
    .is('discipline_id', null)
    .eq('event_date', hoy);
  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw new Error(error.message);
  }
  return (data ?? []).length;
}

export interface ResultadoHoyEntrene {
  otorgado: boolean;
  xpOtorgado: number;
  entrenamientosHoy: number;
  entrenamientosMaximos: number;
}

// Único punto de escritura para "Hoy Entrené" -- todo el enforcement real
// (cupo diario, disciplinas activas) vive en el RPC, server-side, nunca
// confiando en lo que calculó el cliente. Puede tirar (sin ninguna
// disciplina activa, sin sesión) -- el llamador decide cómo mostrarlo.
export async function registrarHoyEntrene(): Promise<ResultadoHoyEntrene> {
  const { data, error } = await supabase.rpc('registrar_hoy_entrene').single();
  if (error) throw new Error(error.message);
  const fila = data as {
    otorgado: boolean;
    xp_otorgado: number;
    entrenamientos_hoy: number;
    entrenamientos_maximos: number;
  };
  return {
    otorgado: fila.otorgado,
    xpOtorgado: fila.xp_otorgado,
    entrenamientosHoy: fila.entrenamientos_hoy,
    entrenamientosMaximos: fila.entrenamientos_maximos,
  };
}
