-- Ejecutar en el SQL Editor de Supabase CUANDO SE QUIERA activar el registro
-- de "última carga usada" por ejercicio en Mi Rutina.
--
-- Distinta de routine_exercises.weight_suggestion (la carga SUGERIDA por el
-- entrenador, una sola por rutina, igual para cualquier socio que la tenga
-- asignada) -- esta tabla guarda la carga REAL que CADA socio fue cargando a
-- mano en cada ejercicio, para que la próxima vez que abra Mi Rutina la vea
-- precargada en vez de tener que escribirla de cero. Independiente del
-- checklist diario (routine_completions): tildar/destildar un ejercicio hoy
-- no debe borrar el peso que el socio ya cargó ahí.
create table routine_exercise_weights (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  routine_exercise_id uuid not null references routine_exercises(id) on delete cascade,
  weight_used text not null,
  updated_at timestamptz not null default now()
);

-- Un solo registro por (socio, ejercicio de la rutina) -- cargar de nuevo
-- pisa el valor anterior (upsert), no acumula historial.
create unique index idx_routine_exercise_weights_unica on routine_exercise_weights(user_id, routine_exercise_id);
create index idx_routine_exercise_weights_user on routine_exercise_weights(user_id);

alter table routine_exercise_weights enable row level security;

create policy "routine_exercise_weights_select_own" on routine_exercise_weights
  for select using (auth.uid() = user_id);
create policy "routine_exercise_weights_insert_own" on routine_exercise_weights
  for insert with check (auth.uid() = user_id);
create policy "routine_exercise_weights_update_own" on routine_exercise_weights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
