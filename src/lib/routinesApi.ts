import { supabase } from './supabase';
import { Exercise, Routine, RoutineDay } from '../types';

// 42P01 = undefined_table (Postgres). PGRST205 = PostgREST no encuentra la
// tabla en su schema cache -- mismo criterio que xpApi.ts/avatarApi.ts: si
// `routine_exercise_weights` (backend/supabase_migration_routine_weights.sql)
// todavía no se desplegó en este ambiente, la carga real simplemente no se
// precarga/guarda todavía, sin romper el resto de la pantalla.
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
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
