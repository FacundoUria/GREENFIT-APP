import { supabase } from './supabase';
import { Exercise, Routine } from '../types';

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

// La rutina vigente de un socio (la más reciente), con sus ejercicios en
// orden. null si todavía no tiene ninguna asignada.
export async function getUserRoutine(userId: string): Promise<Routine | null> {
  const { data: routine, error: routineError } = await supabase
    .from('routines')
    .select('id, user_id, title, notes, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (routineError) throw new Error(routineError.message);
  if (!routine) return null;

  const { data: routineExercises, error: exercisesError } = await supabase
    .from('routine_exercises')
    .select('id, sets, reps, rest_seconds, order_index, exercise:exercises(id, name, muscle_group, description, video_url)')
    .eq('routine_id', routine.id)
    .order('order_index', { ascending: true });
  if (exercisesError) throw new Error(exercisesError.message);

  return {
    id: routine.id,
    userId: routine.user_id,
    title: routine.title,
    notes: routine.notes,
    createdAt: routine.created_at,
    exercises: (routineExercises ?? []).map((re) => {
      const exercise = Array.isArray(re.exercise) ? re.exercise[0] : re.exercise;
      return {
        id: re.id,
        exercise: mapExercise(exercise),
        sets: re.sets,
        reps: re.reps,
        restSeconds: re.rest_seconds,
        orderIndex: re.order_index,
      };
    }),
  };
}
