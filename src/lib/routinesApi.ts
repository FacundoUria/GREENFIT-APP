import { supabase } from './supabase';
import { Exercise, Routine, RoutineDay } from '../types';

// 42P01 = undefined_table (Postgres). PGRST205 = PostgREST no encuentra la
// tabla en su schema cache -- mismo criterio que xpApi.ts/avatarApi.ts: si
// `routine_exercise_weights` (backend/supabase_migration_routine_weights.sql)
// todavía no se desplegó en este ambiente, la carga real simplemente no se
// precarga/guarda todavía, sin romper el resto de la pantalla.
// Mismo criterio para `finalizar_entrenamiento` (42883 = undefined_function,
// PGRST202 = PostgREST no encuentra la función).
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code ?? '')) return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find');
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

// La rutina vigente de un socio (la más reciente asignada), con sus días y
// ejercicios en orden. null si todavía no tiene ninguna asignada.
export async function getUserRoutine(userId: string): Promise<Routine | null> {
  const { data: routine, error: routineError } = await supabase
    .from('routines')
    .select('id, user_id, title, coach_name, notes, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (routineError) throw new Error(routineError.message);
  if (!routine) return null;

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
    days: mappedDays,
  };
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
  // checkbox ya estaba en el estado que se quería dejar.
  if (error && error.code !== '23505') throw new Error(error.message);
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
  if (error) throw new Error(error.message);
}

// -- Carga real por ejercicio (Módulo "Registro dinámico de peso") --
//
// Independiente del checklist diario de arriba: acá se guarda la ÚLTIMA
// carga que el socio usó en cada ejercicio, para que la próxima vez que
// entre a Mi Rutina la vea precargada en vez de escribirla de cero.
// `weight_suggestion` (routine_exercises, cargado por el entrenador) sigue
// siendo el valor por defecto mientras el socio no haya guardado el suyo.

// routine_exercise_id -> última carga que el socio cargó a mano ahí.
export async function getUserExerciseWeights(userId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('routine_exercise_weights')
    .select('routine_exercise_id, weight_used')
    .eq('user_id', userId);
  if (error) {
    if (isMissingRelationError(error)) return new Map();
    throw new Error(error.message);
  }
  return new Map((data ?? []).map((row) => [row.routine_exercise_id as string, row.weight_used as string]));
}

// Upsert por (user_id, routine_exercise_id) -- pisa el valor anterior, no
// acumula historial (ver índice único de la migración). Silencioso si la
// tabla todavía no existe: el socio puede seguir editando el campo en
// pantalla, simplemente no persiste todavía entre sesiones.
export async function saveExerciseWeight(userId: string, routineExerciseId: string, weight: string): Promise<void> {
  const { error } = await supabase.from('routine_exercise_weights').upsert(
    {
      user_id: userId,
      routine_exercise_id: routineExerciseId,
      weight_used: weight,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,routine_exercise_id' }
  );
  if (error && !isMissingRelationError(error)) throw new Error(error.message);
}

// -- Historial de entrenamientos (pestaña "Historial" de Mi Rutina) --
//
// Tabla `routine_history` (backend/supabase_migration_routine_history.sql):
// una FOTO de cada "Finalizar Entrenamiento", independiente de la rutina
// vigente (nombre/series/reps/peso copiados como texto, sin FK a
// routine_exercises) para que sobreviva a que el entrenador la edite. Solo
// se escribe vía el RPC `finalizar_entrenamiento`, que además aplica el
// cooldown de 1 hora del lado del servidor. Cambiar un peso sin finalizar
// NO pasa por acá (eso sigue siendo saveExerciseWeight, de arriba).

export interface ItemEntrenamiento {
  nombre: string;
  grupo: string | null;
  series: number | null;
  repeticiones: string | null;
  peso: string | null;
}

export type ResultadoFinalizar =
  | { estado: 'registrado' }
  // Ya finalizó hace menos de 1 hora -- `disponibleDesde` es el instante
  // (ISO) a partir del cual puede volver a finalizar.
  | { estado: 'cooldown'; disponibleDesde: string }
  // La migración todavía no corrió en este ambiente: el socio igual ve el
  // cierre, simplemente no queda en el historial.
  | { estado: 'no_disponible' };

export async function finalizarEntrenamiento(
  tituloDia: string | null,
  totalEjercicios: number,
  items: ItemEntrenamiento[]
): Promise<ResultadoFinalizar> {
  const { data, error } = await supabase.rpc('finalizar_entrenamiento', {
    p_titulo_dia: tituloDia,
    p_total_ejercicios: totalEjercicios,
    p_items: items,
  });
  if (error) {
    if (isMissingRelationError(error)) {
      console.warn(
        '[GreenFit] Historial de rutina no disponible (¿falta correr supabase_migration_routine_history.sql?):',
        error.message
      );
      return { estado: 'no_disponible' };
    }
    throw new Error(error.message);
  }
  const resultado = data as { registrado: boolean; disponible_desde: string | null } | null;
  if (resultado && resultado.registrado === false && resultado.disponible_desde) {
    return { estado: 'cooldown', disponibleDesde: resultado.disponible_desde };
  }
  return { estado: 'registrado' };
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

// Solo lectura. Si la tabla todavía no existe, devuelve un historial vacío
// en vez de romper la pantalla.
export async function getRoutineHistory(userId: string): Promise<DiaHistorial[]> {
  const { data, error } = await supabase
    .from('routine_history')
    .select(
      'id, sesion_id, fecha, titulo_dia, nombre_ejercicio, grupo_muscular, series, repeticiones, peso, orden, total_ejercicios, completo, created_at'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }
  return agruparHistorial((data ?? []) as FilaHistorial[]);
}
