-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor), DESPUÉS de
-- supabase_migration_routine_history.sql (ya aplicada en producción).
--
-- Cambios de reglas del historial de Mi Rutina:
--
-- 1) finalizar_entrenamiento(): se saca el cooldown de 1 hora. En su lugar:
--    * ventana anti doble-toque de 10 segundos (la app además bloquea el
--      botón 8 s; esto cubre reintentos, dos dispositivos o llamadas al RPC
--      por fuera de la app) -> motivo 'reciente';
--    * tope de 20 finalizaciones por día (horario AR) por socio, para que
--      nadie pueda llenar la tabla con un script -> motivo 'tope_diario'.
--    Respuesta: { registrado, sesion_id, motivo, disponible_desde }.
--
-- 2) eliminar_sesion_historial(p_sesion_id): el ÚNICO borrado permitido. Borra
--    la sesión COMPLETA (todas sus filas) y solo si es del socio que llama.
--    NO se agrega ninguna policy de delete: la tabla sigue siendo de solo
--    lectura para el socio; toda escritura pasa por estas dos funciones
--    (security definer). Nunca se edita ni se borra parcialmente.
--
-- Idempotente: se puede volver a correr entera.

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
  v_hoy date := (now() at time zone 'America/Argentina/Mendoza')::date;
  v_cantidad int;
  v_ultimo timestamptz;
  v_sesiones_hoy int;
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

  -- Serializa las llamadas del mismo socio: dos requests simultáneos no
  -- pueden pasar los dos el chequeo de abajo.
  perform pg_advisory_xact_lock(hashtext('routine_history:' || v_user_id::text));

  select max(created_at) into v_ultimo
  from routine_history
  where user_id = v_user_id;

  if v_ultimo is not null and v_ultimo > v_ahora - interval '10 seconds' then
    return jsonb_build_object(
      'registrado', false,
      'sesion_id', null,
      'motivo', 'reciente',
      'disponible_desde', v_ultimo + interval '10 seconds'
    );
  end if;

  select count(distinct sesion_id) into v_sesiones_hoy
  from routine_history
  where user_id = v_user_id and fecha = v_hoy;

  if v_sesiones_hoy >= 20 then
    return jsonb_build_object(
      'registrado', false,
      'sesion_id', null,
      'motivo', 'tope_diario',
      'disponible_desde', null
    );
  end if;

  insert into routine_history (
    user_id, sesion_id, fecha, titulo_dia, nombre_ejercicio, grupo_muscular,
    series, repeticiones, peso, orden, total_ejercicios, completo, created_at
  )
  select
    v_user_id,
    v_sesion_id,
    v_hoy,
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
    'motivo', null,
    'disponible_desde', v_ahora + interval '10 seconds'
  );
end;
$$;

revoke all on function public.finalizar_entrenamiento(text, int, jsonb) from public, anon;
grant execute on function public.finalizar_entrenamiento(text, int, jsonb) to authenticated;

-- Borra UNA sesión completa del socio que llama. Devuelve cuántas filas
-- borró: 0 si esa sesión no existe o es de otro socio (no se distingue a
-- propósito: no le confirma a nadie la existencia de sesiones ajenas).
create or replace function public.eliminar_sesion_historial(p_sesion_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_borradas int;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;
  if p_sesion_id is null then
    raise exception 'Falta la sesión a eliminar';
  end if;

  delete from routine_history
  where sesion_id = p_sesion_id
    and user_id = v_user_id;
  get diagnostics v_borradas = row_count;

  return v_borradas;
end;
$$;

revoke all on function public.eliminar_sesion_historial(uuid) from public, anon;
grant execute on function public.eliminar_sesion_historial(uuid) to authenticated;
