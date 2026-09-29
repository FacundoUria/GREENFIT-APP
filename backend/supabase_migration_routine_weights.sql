-- ⛔ OBSOLETA -- NO CORRER. Reemplazada por
-- supabase_migration_user_exercise_weights.sql (2026-09-29).
--
-- Esta versión ata la carga a routine_exercise_id, que el panel Admin
-- regenera cada vez que Seba guarda una rutina (saveRoutineFull borra y
-- recrea los días) -> la cascada borraría todos los pesos de sus socios. La
-- tabla nueva la ata a exercise_id (estable). Se deja el archivo solo como
-- registro de por qué se descartó.
--
-- Ejecutar en el SQL Editor de Supabase para activar el registro de "última
-- carga usada" por ejercicio en Mi Rutina. Hasta hoy la tabla NO existía en
-- producción (to_regclass = null) y el guardado fallaba en silencio.
--
-- Distinta de routine_exercises.weight_suggestion (la carga SUGERIDA por el
-- entrenador, una sola por rutina, igual para cualquier socio que la tenga
-- asignada) -- esta tabla guarda la carga REAL que CADA socio fue cargando a
-- mano en cada ejercicio, para que la próxima vez que abra Mi Rutina la vea
-- precargada en vez de tener que escribirla de cero. Independiente del
-- checklist diario (routine_completions): tildar/destildar un ejercicio hoy
-- no debe borrar el peso que el socio ya cargó ahí.
--
-- Idempotente: se puede volver a correr sin romper nada. Usa gen_random_uuid()
-- (nativa de Postgres) y no uuid_generate_v4(), que en Supabase vive en el
-- schema `extensions`. No necesita datos iniciales: sin fila, la app muestra
-- la sugerencia del entrenador.
create table if not exists public.routine_exercise_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  routine_exercise_id uuid not null references public.routine_exercises(id) on delete cascade,
  weight_used text not null,
  updated_at timestamptz not null default now()
);

-- Un solo registro por (socio, ejercicio de la rutina) -- cargar de nuevo
-- pisa el valor anterior (upsert), no acumula historial. El upsert de la app
-- (onConflict: 'user_id,routine_exercise_id') necesita este índice único.
create unique index if not exists idx_routine_exercise_weights_unica
  on public.routine_exercise_weights(user_id, routine_exercise_id);
create index if not exists idx_routine_exercise_weights_user
  on public.routine_exercise_weights(user_id);

alter table public.routine_exercise_weights enable row level security;

drop policy if exists "routine_exercise_weights_select_own" on public.routine_exercise_weights;
create policy "routine_exercise_weights_select_own" on public.routine_exercise_weights
  for select using (auth.uid() = user_id);
drop policy if exists "routine_exercise_weights_insert_own" on public.routine_exercise_weights;
create policy "routine_exercise_weights_insert_own" on public.routine_exercise_weights
  for insert with check (auth.uid() = user_id);
drop policy if exists "routine_exercise_weights_update_own" on public.routine_exercise_weights;
create policy "routine_exercise_weights_update_own" on public.routine_exercise_weights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Que la API (PostgREST) vea la tabla nueva enseguida.
notify pgrst, 'reload schema';
