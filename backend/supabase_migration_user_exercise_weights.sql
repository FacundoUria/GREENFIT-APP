-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor).
--
-- "Última carga usada" por socio y por EJERCICIO en Mi Rutina.
--
-- Reemplaza a supabase_migration_routine_weights.sql (routine_exercise_weights),
-- que NUNCA se corrió en producción (to_regclass = null, 2026-09-29): el
-- guardado de pesos fallaba en silencio. Aquella versión ataba la carga a
-- routine_exercise_id, y el panel Admin regenera esos ids cada vez que Seba
-- guarda una rutina (saveRoutineFull borra y recrea los días) -> la cascada
-- habría borrado los pesos de sus socios en cada edición.
--
-- Esta tabla la ata a exercise_id, que el panel CONSERVA al re-guardar una
-- rutina (mapRoutineFull carga re.exercise_id y saveRoutineFull lo reusa).
-- Consecuencias (aprobadas):
--   * Seba edita/re-guarda la rutina -> el peso se mantiene.
--   * Rutina nueva o plantilla con el mismo ejercicio -> el socio ve su
--     última carga de ese ejercicio.
--   * El mismo ejercicio repetido en una rutina comparte el peso (hoy no hay
--     ningún caso en producción: consulta del 2026-09-29 = 0 filas).
--   * Si se borra el ejercicio del catálogo, se borran sus pesos (cascade).
--
-- Distinta de routine_exercises.weight_suggestion (la carga SUGERIDA por el
-- entrenador): sin fila acá, la app muestra la sugerencia. No necesita datos
-- iniciales. Idempotente: se puede volver a correr entera.

create table if not exists public.user_exercise_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  weight_used text not null,
  updated_at timestamptz not null default now()
);

-- Un solo registro por (socio, ejercicio): cargar de nuevo pisa el valor
-- anterior. El upsert de la app (onConflict: 'user_id,exercise_id') necesita
-- este índice único.
create unique index if not exists idx_user_exercise_weights_unica
  on public.user_exercise_weights(user_id, exercise_id);
create index if not exists idx_user_exercise_weights_user
  on public.user_exercise_weights(user_id);

alter table public.user_exercise_weights enable row level security;

-- Cada socio lee, crea y actualiza SOLO lo suyo. Sin policy de delete: nadie
-- la necesita (la app nunca borra una carga; el cascade de las FKs no pasa
-- por RLS).
drop policy if exists "user_exercise_weights_select_own" on public.user_exercise_weights;
create policy "user_exercise_weights_select_own" on public.user_exercise_weights
  for select using (auth.uid() = user_id);
drop policy if exists "user_exercise_weights_insert_own" on public.user_exercise_weights;
create policy "user_exercise_weights_insert_own" on public.user_exercise_weights
  for insert with check (auth.uid() = user_id);
drop policy if exists "user_exercise_weights_update_own" on public.user_exercise_weights;
create policy "user_exercise_weights_update_own" on public.user_exercise_weights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Que la API (PostgREST) vea la tabla nueva enseguida.
notify pgrst, 'reload schema';
