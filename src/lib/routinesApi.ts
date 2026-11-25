import { supabase } from './supabase';
import { errorConCodigo } from './supabaseErrors';
import { Exercise, Routine, RoutineDay } from '../types';

// 42P01 = undefined_table (Postgres). PGRST205 = PostgREST no encuentra la
// tabla en su schema cache. 42883 = undefined_function, PGRST202 = PostgREST
// no encuentra la función. O sea: "esa migración no corrió en este ambiente".
//
// Regla para ese caso (después de descubrir, el 2026-09-29, que
// routine_exercise_weights nunca se había creado en producción y el guardado
// de pesos fallaba EN SILENCIO):
// - LECTURAS: pueden caer a un valor por defecto (sugerencia del entrenador,
//   historial vacío) sin romper la pantalla, pero siempre con console.warn.
// - ESCRITURAS: nunca en silencio -- se tira un error con un mensaje claro y
//   la pantalla se lo muestra al socio.
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code ?? '')) return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find');
}

// Lectura sin la migración corrida: se sigue, pero queda registrado.
function avisarLecturaSinMigracion(que: string, migracion: string, error: { message?: string }) {
  console.warn(`[GreenFit] ${que}: falta correr ${migracion} en este ambiente -- se usa el valor por defecto.`, error.message);
}

// Escritura sin la migración corrida: error explícito (nunca en silencio).
function errorEscrituraSinMigracion(que: string, migracion: string, error: { message?: string }): Error {
  console.error(`[GreenFit] ${que}: falta correr ${migracion} en este ambiente.`, error.message);
  return new Error(`${que} todavía no está activado en el servidor. Avisale al gimnasio.`);
}

function mapExercise(row: {
  id: string;
  name: string;
  muscle_group: string;
  description: string | null;
  video_url: string | null;
}): Exercise {
  return {
    id: row.id,
    name: row.name,
    muscleGroup: row.muscle_group,
    description: row.description,
    videoUrl: row.video_url,
  };
}

interface FilaRutina {
  id: string;
  user_id: string | null;
  title: string;
  coach_name: string | null;
  notes: string | null;
  created_at: string;
  vigente_desde?: string | null;
  vigente_hasta?: string | null;
}

const COLUMNAS_RUTINA = 'id, user_id, title, coach_name, notes, created_at, vigente_desde, vigente_hasta';

// La rutina VIGENTE de un socio (vigente_hasta null: la base garantiza una sola), con sus
// días y ejercicios en orden. null si todavía no tiene ninguna asignada.
// Sin la migración del historial de rutinas (columnas nuevas inexistentes) cae a lo de
// antes -- la más nueva por created_at, que es la misma -- con console.warn.
export async function getUserRoutine(userId: string): Promise<Routine | null> {
  let { data: routine, error: routineError } = await supabase
    .from('routines')
    .select(COLUMNAS_RUTINA)
    .eq('user_id', userId)
    .is('vigente_hasta', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (routineError && isMissingRelationError(routineError)) {
    avisarLecturaSinMigracion('Rutina vigente', 'supabase_migration_historial_rutinas_f1.sql', routineError);
    ({ data: routine, error: routineError } = await supabase
      .from('routines')
      .select('id, user_id, title, coach_name, notes, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle());
  }
  if (routineError) throw new Error(routineError.message);
  if (!routine) return null;
  return cargarRutina(routine as FilaRutina);
}

// Una rutina del socio que llama (la vigente o una de su historial), en solo lectura.
// La RLS solo deja leer las propias.
export async function getRutina(routineId: string): Promise<Routine | null> {
  const { data, error } = await supabase.from('routines').select(COLUMNAS_RUTINA).eq('id', routineId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return cargarRutina(data as FilaRutina);
}

async function cargarRutina(routine: FilaRutina): Promise<Routine> {
  const { data: days, error: daysError } = await supabase
    .from('routine_days')
    .select(
      'id, title, order_index, routine_exercises(id, sets, reps, rest_seconds, weight_suggestion, notes, order_index, exercise:exercises(id, name, muscle_group, description, video_url))'
    )
    .eq('routine_id', routine.id)
    .order('order_index', { ascending: true });
  if (daysError) throw new Error(daysError.message);

  const mappedDays: RoutineDay[] = (days ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    orderIndex: d.order_index,
    exercises: (d.routine_exercises ?? [])
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((re) => {
        const exercise = Array.isArray(re.exercise) ? re.exercise[0] : re.exercise;
        return {
          id: re.id,
          exercise: mapExercise(exercise),
          sets: re.sets,
          reps: re.reps,
          restSeconds: re.rest_seconds,
          weightSuggestion: re.weight_suggestion,
          notes: re.notes,
          orderIndex: re.order_index,
        };
      }),
  }));

  return {
    id: routine.id,
    userId: routine.user_id,
    title: routine.title,
    coachName: routine.coach_name,
    notes: routine.notes,
    createdAt: routine.created_at,
    vigenteDesde: routine.vigente_desde ?? null,
    vigenteHasta: routine.vigente_hasta ?? null,
    days: mappedDays,
  };
}

// -- "Mis rutinas": el historial de rutinas del socio (solo lectura) --

export interface RutinaAnterior {
  id: string;
  title: string;
  coachName: string | null;
  vigenteDesde: string;
  vigenteHasta: string;
  entrenamientos: number; // "Finalizar" registrados en esa rutina (sin los que ocultó)
}

// Las rutinas anteriores del socio, la más nueva primero. Las archivadas (copias vacías
// que dejó el panel viejo) no aparecen. Sin la migración, lista vacía con console.warn.
export async function getMisRutinasAnteriores(userId: string): Promise<RutinaAnterior[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('id, title, coach_name, created_at, vigente_desde, vigente_hasta')
    .eq('user_id', userId)
    .is('archivada_en', null)
    .order('vigente_desde', { ascending: false });
  if (error) {
    if (isMissingRelationError(error)) {
      avisarLecturaSinMigracion('Historial de rutinas', 'supabase_migration_historial_rutinas_f1.sql', error);
      return [];
    }
    throw new Error(error.message);
  }
  const anteriores = ((data ?? []) as FilaRutina[]).filter((r) => !!r.vigente_hasta);
  if (anteriores.length === 0) return [];

  // Cuántos entrenamientos registró en cada una. Si falla, la lista se muestra igual.
  const conteo = new Map<string, Set<string>>();
  const { data: sesiones, error: sesionesError } = await supabase
    .from('routine_history')
    .select('routine_id, sesion_id')
    .eq('user_id', userId)
    .is('oculta_en', null);
  if (sesionesError) {
    console.warn('[GreenFit] No se pudieron contar los entrenamientos por rutina:', sesionesError.message);
  } else {
    for (const s of (sesiones ?? []) as { routine_id: string | null; sesion_id: string }[]) {
      if (!s.routine_id) continue;
      if (!conteo.has(s.routine_id)) conteo.set(s.routine_id, new Set());
      conteo.get(s.routine_id)!.add(s.sesion_id);
    }
  }

  return anteriores
    .map((r) => ({
      id: r.id,
      title: r.title,
      coachName: r.coach_name,
      vigenteDesde: r.vigente_desde ?? r.created_at,
      vigenteHasta: r.vigente_hasta as string,
      entrenamientos: conteo.get(r.id)?.size ?? 0,
    }))
    .sort((a, b) => (a.vigenteDesde < b.vigenteDesde ? 1 : a.vigenteDesde > b.vigenteDesde ? -1 : 0));
}

// Los entrenamientos que el socio registró en UNA rutina (sin los que ocultó), agrupados
// igual que la pestaña Historial: con la carga que usó en cada uno.
export async function getSesionesDeRutina(routineId: string): Promise<DiaHistorial[]> {
  const { data, error } = await supabase
    .from('routine_history')
    .select(
      'id, sesion_id, fecha, titulo_dia, nombre_ejercicio, grupo_muscular, series, repeticiones, peso, orden, total_ejercicios, completo, created_at'
    )
    .eq('routine_id', routineId)
    .is('oculta_en', null)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingRelationError(error)) {
      avisarLecturaSinMigracion('Entrenamientos por rutina', 'supabase_migration_historial_rutinas_f1.sql', error);
      return [];
    }
    throw new Error(error.message);
  }
  return agruparHistorial((data ?? []) as FilaHistorial[]);
}

// IDs de routine_exercises marcados como completados HOY por este socio.
export async function getTodayCompletions(userId: string, todayStr: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('routine_completions')
    .select('routine_exercise_id')
    .eq('user_id', userId)
    .eq('completed_date', todayStr);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.routine_exercise_id));
}

export async function markExerciseCompleted(
  userId: string,
  routineExerciseId: string,
  todayStr: string
): Promise<void> {
  const { error } = await supabase
    .from('routine_completions')
    .insert({ user_id: userId, routine_exercise_id: routineExerciseId, completed_date: todayStr });
  // Ya marcado (choque del unique constraint) no es un error real -- el
  // checkbox ya estaba en el estado que se quería dejar. Cualquier otro error
  // se lanza CON su código: un 23503 (el ejercicio ya no existe porque el
  // entrenador re-guardó la rutina) lo maneja la pantalla recargando.
  if (error && error.code !== '23505') throw errorConCodigo(error);
}

export async function unmarkExerciseCompleted(
  userId: string,
  routineExerciseId: string,
  todayStr: string
): Promise<void> {
  const { error } = await supabase
    .from('routine_completions')
    .delete()
    .eq('user_id', userId)
    .eq('routine_exercise_id', routineExerciseId)
    .eq('completed_date', todayStr);
  // Mismo criterio que markExerciseCompleted (en la práctica un DELETE no da
  // 23503: si la fila ya no existe, borra 0 filas sin error).
  if (error) throw errorConCodigo(error);
}

// -- Carga real por ejercicio (Módulo "Registro dinámico de peso") --
//
// Independiente del checklist diario de arriba: acá se guarda la ÚLTIMA
// carga que el socio usó en cada EJERCICIO, para que la próxima vez que
// entre a Mi Rutina la vea precargada en vez de escribirla de cero.
// `weight_suggestion` (routine_exercises, cargado por el entrenador) sigue
// siendo el valor por defecto mientras el socio no haya guardado el suyo.
//
// Tabla `user_exercise_weights` (backend/supabase_migration_user_exercise_weights.sql),
// atada a exercise_id y NO a routine_exercise_id: el panel Admin regenera
// los routine_exercises cada vez que Seba guarda una rutina, pero conserva el
// exercise_id -> la carga sobrevive a las ediciones de la rutina. Si el mismo
// ejercicio aparece dos veces en una rutina, comparte la carga.

// exercise_id -> última carga que el socio usó en ese ejercicio.
export async function getUserExerciseWeights(userId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('user_exercise_weights')
    .select('exercise_id, weight_used')
    .eq('user_id', userId);
  if (error) {
    if (isMissingRelationError(error)) {
      // Sin la tabla, la pantalla muestra la sugerencia del entrenador.
      avisarLecturaSinMigracion('Cargas guardadas', 'supabase_migration_user_exercise_weights.sql', error);
      return new Map();
    }
    throw new Error(error.message);
  }
  return new Map((data ?? []).map((row) => [row.exercise_id as string, row.weight_used as string]));
}

// Upsert por (user_id, exercise_id) -- pisa el valor anterior, no acumula
// historial (ver índice único de la migración). Si la tabla no existe, tira
// error: la pantalla le avisa al socio que la carga NO se guardó.
export async function saveExerciseWeight(userId: string, exerciseId: string, weight: string): Promise<void> {
  const { error } = await supabase.from('user_exercise_weights').upsert(
    {
      user_id: userId,
      exercise_id: exerciseId,
      weight_used: weight,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,exercise_id' }
  );
  if (error) {
    if (isMissingRelationError(error)) {
      throw errorEscrituraSinMigracion('El guardado de cargas', 'supabase_migration_user_exercise_weights.sql', error);
    }
    throw new Error(error.message);
  }
}

// -- Historial de entrenamientos (pestaña "Entrenamientos" de Mi Rutina) --
//
// Tabla `routine_history` (backend/supabase_migration_routine_history.sql):
// una FOTO de cada "Finalizar Entrenamiento", independiente de la rutina
// vigente (nombre/series/reps/peso copiados como texto, sin FK a
// routine_exercises) para que sobreviva a que el entrenador la edite. Solo
// se escribe vía RPCs (supabase_migration_routine_history_v2.sql):
// `finalizar_entrenamiento` (ventana anti doble-toque de 10 s + tope de 20
// por día, del lado del servidor) y `eliminar_sesion_historial` (desde la F1 del historial de rutinas OCULTA una
// sesión completa, nunca parcial). Cambiar un peso sin finalizar NO pasa por
// acá (eso sigue siendo saveExerciseWeight, de arriba).

export interface ItemEntrenamiento {
  nombre: string;
  grupo: string | null;
  series: number | null;
  repeticiones: string | null;
  peso: string | null;
}

export type ResultadoFinalizar =
  | { estado: 'registrado' }
  // Ya finalizó hace menos de 10 segundos (doble toque, reintento, otro
  // dispositivo): no se guardó de nuevo.
  | { estado: 'reciente' }
  // Ya registró 20 entrenamientos hoy.
  | { estado: 'tope_diario' };

// `routineId`: la rutina que el socio está viendo (historial de rutinas: cada
// entrenamiento queda vinculado a la rutina en la que se hizo). El servidor valida que
// sea suya. Si el servidor todavía no tiene la versión con p_routine_id (migración sin
// correr), se reintenta sin ella, con console.warn: finalizar nunca se rompe por esto.
export async function finalizarEntrenamiento(
  tituloDia: string | null,
  totalEjercicios: number,
  items: ItemEntrenamiento[],
  routineId: string | null = null
): Promise<ResultadoFinalizar> {
  const base = { p_titulo_dia: tituloDia, p_total_ejercicios: totalEjercicios, p_items: items };
  let { data, error } = await supabase.rpc(
    'finalizar_entrenamiento',
    routineId ? { ...base, p_routine_id: routineId } : base
  );
  if (error && routineId && isMissingRelationError(error)) {
    avisarLecturaSinMigracion('Finalizar con rutina', 'supabase_migration_historial_rutinas_f1.sql', error);
    ({ data, error } = await supabase.rpc('finalizar_entrenamiento', base));
  }
  if (error) {
    if (isMissingRelationError(error)) {
      // Antes esto devolvía 'no_disponible' y la pantalla festejaba igual,
      // sin que nada quedara guardado. Ahora es un error visible.
      throw errorEscrituraSinMigracion('El historial de entrenamientos', 'supabase_migration_routine_history.sql', error);
    }
    throw new Error(error.message);
  }
  const resultado = data as { registrado: boolean; motivo?: string | null } | null;
  if (resultado && resultado.registrado === false) {
    // Sin `motivo` = versión vieja de la función (cooldown de 1 hora, antes
    // de correr la v2): se trata igual que "reciente".
    return resultado.motivo === 'tope_diario' ? { estado: 'tope_diario' } : { estado: 'reciente' };
  }
  return { estado: 'registrado' };
}

// "Eliminar" una sesión COMPLETA del historial (todas sus filas). Desde el historial de
// rutinas (F1) el servidor ya no la borra: la OCULTA (oculta_en) -- el socio deja de
// verla y el gimnasio la sigue viendo. Solo si es del socio que llama; devuelve cuántas
// filas ocultó (0 = no existía o ya estaba oculta).
export async function eliminarSesionHistorial(sesionId: string): Promise<number> {
  const { data, error } = await supabase.rpc('eliminar_sesion_historial', { p_sesion_id: sesionId });
  if (error) {
    if (isMissingRelationError(error)) {
      throw errorEscrituraSinMigracion('El borrado de entrenamientos', 'supabase_migration_routine_history_v2.sql', error);
    }
    throw new Error(error.message);
  }
  return typeof data === 'number' ? data : 0;
}

export interface EjercicioHistorial {
  id: string;
  nombre: string;
  grupo: string | null;
  series: number | null;
  repeticiones: string | null;
  peso: string | null;
}

export interface SesionHistorial {
  sesionId: string;
  creadoEn: string; // timestamptz ISO -- la hora de la entrada
  tituloDia: string | null;
  totalEjercicios: number;
  completo: boolean;
  ejercicios: EjercicioHistorial[];
}

export interface DiaHistorial {
  fecha: string; // YYYY-MM-DD (día en horario de Mendoza, calculado por el servidor)
  sesiones: SesionHistorial[];
}

interface FilaHistorial {
  id: string;
  sesion_id: string;
  fecha: string;
  titulo_dia: string | null;
  nombre_ejercicio: string;
  grupo_muscular: string | null;
  series: number | null;
  repeticiones: string | null;
  peso: string | null;
  orden: number;
  total_ejercicios: number;
  completo: boolean;
  created_at: string;
}

// Filas planas -> días (más reciente primero) -> sesiones (más reciente
// primero) -> ejercicios (en el orden en que estaban en la rutina). No
// depende del orden en que lleguen las filas.
export function agruparHistorial(filas: FilaHistorial[]): DiaHistorial[] {
  const sesiones = new Map<string, SesionHistorial & { fecha: string; ordenes: number[] }>();
  for (const f of filas) {
    let s = sesiones.get(f.sesion_id);
    if (!s) {
      s = {
        sesionId: f.sesion_id,
        fecha: f.fecha,
        creadoEn: f.created_at,
        tituloDia: f.titulo_dia,
        totalEjercicios: f.total_ejercicios,
        completo: f.completo,
        ejercicios: [],
        ordenes: [],
      };
      sesiones.set(f.sesion_id, s);
    }
    s.ejercicios.push({
      id: f.id,
      nombre: f.nombre_ejercicio,
      grupo: f.grupo_muscular,
      series: f.series,
      repeticiones: f.repeticiones,
      peso: f.peso,
    });
    s.ordenes.push(f.orden);
  }

  const ordenadas = Array.from(sesiones.values()).sort(
    (a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime()
  );

  const dias: DiaHistorial[] = [];
  for (const { fecha, ordenes, ...sesion } of ordenadas) {
    const indices = sesion.ejercicios.map((_, i) => i).sort((a, b) => ordenes[a] - ordenes[b]);
    sesion.ejercicios = indices.map((i) => sesion.ejercicios[i]);

    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.fecha === fecha) ultimo.sesiones.push(sesion);
    else dias.push({ fecha, sesiones: [sesion] });
  }
  return dias;
}

// Solo lectura, sin las sesiones que el socio ocultó ("Eliminar"). Si la tabla todavía no
// existe, devuelve un historial vacío en vez de romper la pantalla. Sin la columna
// oculta_en (migración del historial de rutinas sin correr) se lee como antes.
const COLUMNAS_HISTORIAL =
  'id, sesion_id, fecha, titulo_dia, nombre_ejercicio, grupo_muscular, series, repeticiones, peso, orden, total_ejercicios, completo, created_at';

export async function getRoutineHistory(userId: string): Promise<DiaHistorial[]> {
  let { data, error } = await supabase
    .from('routine_history')
    .select(COLUMNAS_HISTORIAL)
    .eq('user_id', userId)
    .is('oculta_en', null)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error && isMissingRelationError(error) && (error.message ?? '').includes('oculta_en')) {
    avisarLecturaSinMigracion('Sesiones ocultas', 'supabase_migration_historial_rutinas_f1.sql', error);
    ({ data, error } = await supabase
      .from('routine_history')
      .select(COLUMNAS_HISTORIAL)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1000));
  }
  if (error) {
    if (isMissingRelationError(error)) {
      avisarLecturaSinMigracion('Historial de entrenamientos', 'supabase_migration_routine_history.sql', error);
      return [];
    }
    throw new Error(error.message);
  }
  return agruparHistorial((data ?? []) as FilaHistorial[]);
}
