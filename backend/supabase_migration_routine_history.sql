-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor)
--
-- Historial de entrenamientos de Mi Rutina (pestaña "Historial").
--
-- Cada vez que el socio toca "Finalizar Entrenamiento" se guarda una FOTO de
-- lo que hizo: una fila por ejercicio marcado, todas con el mismo
-- `sesion_id`. Es histórico puro: nunca se edita ni se borra.
--
-- Independiente de routine_exercises A PROPÓSITO (sin FK): cuando el
-- entrenador edita la rutina desde el panel, saveRoutineFull() borra y
-- vuelve a crear todos los ejercicios con IDs nuevos -- con una FK en
-- cascada el historial se borraría en cada edición. Por eso el nombre, el
-- grupo, las series/reps y el peso se COPIAN como texto al momento de
-- finalizar.
--
-- Arranca vacía: no se migra nada de routine_completions (no tiene pesos ni
-- sabe qué tildes pertenecen a qué entrenamiento).
--
-- Se puede volver a correr entera sin romper nada (if not exists / create
-- or replace). Usa gen_random_uuid() (nativa de Postgres) y NO
-- uuid_generate_v4(): en Supabase esa vive en el schema `extensions`, y con
-- `set search_path = public` la función no la encontraba.

create table if not exists routine_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- Agrupa las filas de un mismo "Finalizar" (mañana y tarde del mismo día
  -- quedan como dos sesiones distintas).
  sesion_id uuid not null,
  -- Día calendario en horario de Mendoza (lo calcula el servidor, no el
  -- teléfono del socio). La hora exacta es created_at.
  fecha date not null,
  titulo_dia text,
  nombre_ejercicio text not null,
  grupo_muscular text,
  series int,
  repeticiones text, -- texto libre como en routine_exercises ("10-12", "AMRAP")
  peso text,         -- mismo formato libre que routine_exercise_weights ("25kg")
  orden int not null default 0,
  -- Ejercicios que tenía el día al finalizar (solo se guardan los marcados,
  -- así que sin esto no se puede mostrar "4 de 5 ejercicios").
  total_ejercicios int not null,
  completo boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_routine_history_user_created on routine_history(user_id, created_at desc);

alter table routine_history enable row level security;

-- Solo lectura de lo propio. SIN policies de insert/update/delete: la única
-- forma de escribir es finalizar_entrenamiento() (security definer), así ni
-- la app ni la consola del navegador pueden editar o borrar el historial.
drop policy if exists "routine_history_select_own" on routine_history;
create policy "routine_history_select_own" on routine_history
  for select using (auth.uid() = user_id);

-- Registra un "Finalizar Entrenamiento".
--
-- p_items: array JSON, un objeto por ejercicio MARCADO del día que el socio
--   está viendo: { nombre, grupo, series, repeticiones, peso }.
-- p_total_ejercicios: cuántos ejercicios tiene ese día en total.
--
-- Cooldown de 1 hora, validado ACÁ (no en la app): si la última sesión del
-- socio es de hace menos de 1 hora, no inserta nada y devuelve
-- registrado=false + a partir de cuándo puede volver a finalizar. Un lock por
-- socio evita que un doble toque (dos requests simultáneos) pase dos veces.
--
-- Devuelve jsonb: { registrado, sesion_id, disponible_desde }.
create or replace function public.finalizar_entrenamiento(
  p_titulo_dia text,
  p_total_ejercicios int,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_ahora timestamptz := now();
  v_cantidad int;
  v_ultimo timestamptz;
  v_sesion_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Formato de ejercicios inválido';
  end if;

  v_cantidad := jsonb_array_length(p_items);
  if v_cantidad = 0 then
    raise exception 'Marcá al menos un ejercicio para finalizar';
  end if;
  if v_cantidad > 100 then
    raise exception 'Demasiados ejercicios en un solo entrenamiento';
  end if;
  if p_total_ejercicios is null or p_total_ejercicios < v_cantidad then
    raise exception 'Total de ejercicios inválido';
  end if;

  perform pg_advisory_xact_lock(hashtext('routine_history:' || v_user_id::text));

  select max(created_at) into v_ultimo
  from routine_history
  where user_id = v_user_id;

  if v_ultimo is not null and v_ultimo > v_ahora - interval '1 hour' then
    return jsonb_build_object(
      'registrado', false,
      'sesion_id', null,
      'disponible_desde', v_ultimo + interval '1 hour'
    );
  end if;

  insert into routine_history (
    user_id, sesion_id, fecha, titulo_dia, nombre_ejercicio, grupo_muscular,
    series, repeticiones, peso, orden, total_ejercicios, completo, created_at
  )
  select
    v_user_id,
    v_sesion_id,
    (v_ahora at time zone 'America/Argentina/Mendoza')::date,
    nullif(left(trim(p_titulo_dia), 120), ''),
    coalesce(nullif(left(trim(t.item->>'nombre'), 200), ''), 'Ejercicio'),
    nullif(left(trim(t.item->>'grupo'), 80), ''),
    case when (t.item->>'series') ~ '^\d{1,4}$' then (t.item->>'series')::int end,
    nullif(left(trim(t.item->>'repeticiones'), 40), ''),
    nullif(left(trim(t.item->>'peso'), 40), ''),
    (t.ord - 1)::int,
    p_total_ejercicios,
    v_cantidad = p_total_ejercicios,
    v_ahora
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);

  return jsonb_build_object(
    'registrado', true,
    'sesion_id', v_sesion_id,
    'disponible_desde', v_ahora + interval '1 hour'
  );
end;
$$;

revoke all on function public.finalizar_entrenamiento(text, int, jsonb) from public, anon;
grant execute on function public.finalizar_entrenamiento(text, int, jsonb) to authenticated;
