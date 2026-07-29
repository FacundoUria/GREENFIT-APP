import { supabase } from './supabase';
import { Exercise, Routine, RoutineDay } from '../types';

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
