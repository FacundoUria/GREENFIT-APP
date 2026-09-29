-- =====================================================================================
-- PRUEBA de routine_history v2 -- TODO por SQL, sin la app.
-- Cuenta de prueba: Facundo Uria, DNI 44537978. Mismo formato que prueba_routine_history.sql.
--
-- REQUISITO: haber corrido backend/supabase_migration_routine_history_v2.sql (el preflight lo
-- verifica y aborta si encuentra la versión vieja de finalizar_entrenamiento o si falta
-- eliminar_sesion_historial).
--
-- CÓMO CORRERLO
--   * Pegar TODO el archivo en el SQL Editor y ejecutar UNA vez. El resultado es la ÚLTIMA grilla
--     (log: fotos, respuesta de cada RPC y una línea OK/FALLA por chequeo, con resumen al final).
--   * Va envuelto en begin/commit. Las llamadas corren COMO el socio (auth.uid() = Facundo)
--     seteando request.jwt.claims (pg_temp.como). Si falla el preflight, se aborta todo.
--
-- QUÉ SE SIMULA
--   * El paso del tiempo: adentro de una transacción now() no avanza. Para "esperar 10 segundos" se
--     corre para atrás el created_at de las filas de ESTA corrida (11 s). Es fiel: la función solo
--     compara la última created_at del socio contra now().
--   * Edición del Admin (paso 5): UPDATE + DELETE de los días de la rutina, adentro de una
--     subtransacción que se deshace sola. Tu rutina real no cambia (el paso lo verifica).
--   * Paso 7c: se intenta borrar una sesión de Facundo COMO OTRO usuario (el primer admin). No se
--     escribe nada en la cuenta de ese otro usuario.
--
-- PASOS (en este orden): 1, 2, 5, 3, 4, 6, 7, LIMPIEZA.
--   1  Finalizar sin ejercicios                      -> error, 0 filas
--   2  Finalizar 2 de 3 (1° con 42.5kg)              -> completo=false, total_ejercicios=3
--   5  Admin edita/borra la rutina                   -> filas del paso 2 intactas
--   3  Finalizar de nuevo enseguida                  -> registrado=false, motivo='reciente', 0 filas
--   4  "Pasan" 11 s y finalizar 3 de 3               -> 2ª sesión el mismo día, completo=true
--   6  Llegar a 20 sesiones hoy y probar la 21ª      -> motivo='tope_diario', 0 filas
--   7  Eliminar: sesión completa / de nuevo / como otro usuario / DELETE directo / sin policy
--
-- ESTADO FINAL: con limpiar_al_final = true (default) se borran TODAS las filas que creó esta
-- corrida y se verifica que el historial quede igual que al arrancar.
-- =====================================================================================
begin;

drop table if exists pg_temp._log;
drop table if exists pg_temp._ctx;
drop table if exists pg_temp._ej;

create temp table _log (n bigserial primary key, paso text, momento text, linea text);

create temp table _ctx as
select
  (select id from profiles where dni = '44537978') as facundo,
  (select id from profiles where role = 'admin' and dni is distinct from '44537978' order by created_at limit 1) as otro_usuario,
  true          as limpiar_al_final,   -- <<< false = dejar las filas de prueba para verlas en la app
  null::uuid    as routine_id,
  null::uuid    as day_id,
  null::text    as day_title,
  null::int     as total_dia,
  null::uuid[]  as ids_iniciales,      -- filas de routine_history que ya existían al arrancar
  null::int     as sesiones_hoy_previas,
  null::uuid    as sesion2,
  null::uuid    as sesion4,
  null::text    as huella2;

-- ---- preflight ----
do $$
declare
  v_user uuid;
  v_col text;
  v_hay_pesos boolean;
  v_routine uuid;
  v_day uuid;
  v_title text;
  v_total int;
  v_ultimo timestamptz;
  v_previas int;
begin
  select facundo into v_user from pg_temp._ctx;
  if v_user is null then raise exception 'No existe el perfil con DNI 44537978'; end if;
  if (select otro_usuario from pg_temp._ctx) is null then
    raise exception 'No hay otro profile con role = admin (hace falta para el paso 7c: borrar como otro usuario)';
  end if;

  if to_regclass('public.routine_history') is null then
    raise exception 'Falta correr supabase_migration_routine_history.sql';
  end if;
  if to_regprocedure('public.eliminar_sesion_historial(uuid)') is null
     or pg_get_functiondef('public.finalizar_entrenamiento(text,integer,jsonb)'::regprocedure) not like '%tope_diario%' then
    raise exception 'Falta correr supabase_migration_routine_history_v2.sql (finalizar_entrenamiento sigue siendo la versión con cooldown de 1 hora, o no existe eliminar_sesion_historial)';
  end if;

  select column_name into v_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'routine_exercises' and column_name in ('day_id', 'routine_day_id')
  order by (column_name = 'day_id') desc
  limit 1;
  if v_col is null then raise exception 'routine_exercises no tiene columna day_id ni routine_day_id'; end if;

  select id into v_routine from routines where user_id = v_user order by created_at desc limit 1;
  if v_routine is null then raise exception 'El socio no tiene ninguna rutina asignada'; end if;

  execute format($f$
    select rd.id, rd.title, count(re.id)::int
    from routine_days rd join routine_exercises re on re.%I = rd.id
    where rd.routine_id = %L
    group by rd.id, rd.title, rd.order_index
    having count(re.id) >= 3
    order by (count(re.id) = 3) desc, rd.order_index
    limit 1
  $f$, v_col, v_routine) into v_day, v_title, v_total;
  if v_day is null then raise exception 'La rutina vigente no tiene ningún día con 3 o más ejercicios'; end if;

  v_hay_pesos := to_regclass('public.user_exercise_weights') is not null;  -- carga por EJERCICIO (supabase_migration_user_exercise_weights.sql)
  execute format($f$
    create temp table _ej as
    select re.id as re_id, e.name as nombre, e.muscle_group as grupo, re.sets as series, re.reps as reps,
           re.weight_suggestion as sugerida, %s as guardada,
           row_number() over (order by re.order_index, re.id)::int as rn
    from routine_exercises re
    join exercises e on e.id = re.exercise_id
    %s
    where re.%I = %L
  $f$,
    case when v_hay_pesos then 'w.weight_used' else 'null::text' end,
    case when v_hay_pesos then format('left join user_exercise_weights w on w.exercise_id = re.exercise_id and w.user_id = %L', v_user) else '' end,
    v_col, v_day);

  select max(created_at) into v_ultimo from routine_history where user_id = v_user;
  if v_ultimo is not null and v_ultimo > now() - interval '10 seconds' then
    raise exception 'Acabás de finalizar un entrenamiento (hace menos de 10 s). Esperá unos segundos y volvé a correr esto.';
  end if;

  select count(distinct sesion_id) into v_previas
  from routine_history
  where user_id = v_user and fecha = (now() at time zone 'America/Argentina/Mendoza')::date;
  if v_previas > 18 then
    raise exception 'Ya tenés % entrenamientos registrados hoy: el tope de 20 no deja lugar para los pasos 2 y 4. Borrá algunos desde la app o corré esto mañana.', v_previas;
  end if;

  update pg_temp._ctx set
    routine_id = v_routine,
    day_id = v_day,
    day_title = v_title,
    total_dia = v_total,
    sesiones_hoy_previas = v_previas,
    ids_iniciales = coalesce((select array_agg(id) from routine_history where user_id = v_user), '{}');
end $$;

-- ---- helpers ----

create or replace function pg_temp.como(p_user uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $f$;

create or replace function pg_temp.log(p_paso text, p_momento text, p_linea text) returns void language sql as $f$
  insert into pg_temp._log(paso, momento, linea) values (p_paso, p_momento, p_linea);
$f$;

create or replace function pg_temp.verificar(p_paso text, p_ok boolean, p_texto text) returns void language sql as $f$
  insert into pg_temp._log(paso, momento, linea)
  values (p_paso, 'CHEQUEO', case when coalesce(p_ok, false) then 'OK     ' else 'FALLA  ' end || p_texto);
$f$;

-- Foto: total del socio + cada fila creada en esta corrida (en el paso 6 se usa la versión corta).
create or replace function pg_temp.foto_lineas() returns text[] language sql as $f$
  select array[format('  routine_history del socio: %s filas en %s sesiones (%s filas ya estaban antes de esta corrida)',
                      count(h.id), count(distinct h.sesion_id), count(h.id) filter (where h.id = any(c.ids_iniciales)))]
      || coalesce(
           array_agg(
             format('  sesion=%s fecha=%s hora_AR=%s dia="%s" | #%s %s  %sx%s  peso=%s | total_ejercicios=%s completo=%s',
                    left(h.sesion_id::text, 8), h.fecha,
                    to_char(h.created_at at time zone 'America/Argentina/Mendoza', 'HH24:MI:SS'),
                    coalesce(h.titulo_dia, '-'), h.orden, h.nombre_ejercicio,
                    coalesce(h.series::text, '-'), coalesce(h.repeticiones, '-'), coalesce(h.peso, '-'),
                    h.total_ejercicios, h.completo)
             order by h.created_at, h.sesion_id, h.orden
           ) filter (where h.id is not null and not (h.id = any(c.ids_iniciales))),
           array['  (ninguna fila de esta corrida)'])
  from pg_temp._ctx c
  left join routine_history h on h.user_id = c.facundo;
$f$;

create or replace function pg_temp.foto(p_paso text, p_momento text) returns void language sql as $f$
  insert into pg_temp._log(paso, momento, linea) select p_paso, p_momento, unnest(pg_temp.foto_lineas());
$f$;

create or replace function pg_temp.foto_corta(p_paso text, p_momento text) returns void language sql as $f$
  insert into pg_temp._log(paso, momento, linea)
  select p_paso, p_momento, format('  routine_history del socio: %s filas; sesiones con fecha de hoy: %s',
    (select count(*) from routine_history where user_id = c.facundo),
    (select count(distinct sesion_id) from routine_history
      where user_id = c.facundo and fecha = (now() at time zone 'America/Argentina/Mendoza')::date))
  from pg_temp._ctx c;
$f$;

create or replace function pg_temp.huella(p_sesion uuid) returns text language sql as $f$
  select md5(coalesce(string_agg(concat_ws('|', id, sesion_id, fecha, titulo_dia, nombre_ejercicio, grupo_muscular,
                                           series, repeticiones, peso, orden, total_ejercicios, completo, created_at),
                                 ';' order by id), ''))
         || format(' (%s filas)', count(*))
  from routine_history where sesion_id = p_sesion;
$f$;

create or replace function pg_temp.items(p_cuantos int) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nombre', nombre, 'grupo', grupo, 'series', series, 'repeticiones', reps,
           'peso', case when rn = 1 then '42.5kg' else coalesce(guardada, sugerida) end) order by rn), '[]'::jsonb)
  from pg_temp._ej where rn <= p_cuantos;
$f$;

-- Llama a finalizar_entrenamiento COMO el socio. p_loguear=false para el loop del paso 6.
create or replace function pg_temp.finalizar(p_paso text, p_items jsonb, p_loguear boolean default true) returns jsonb language plpgsql as $f$
declare c record; r jsonb;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.como(c.facundo);
  begin
    r := public.finalizar_entrenamiento(c.day_title, c.total_dia, p_items);
    if p_loguear then perform pg_temp.log(p_paso, 'RESULTADO', 'finalizar_entrenamiento devolvió: ' || r::text); end if;
  exception when others then
    r := null;
    perform pg_temp.log(p_paso, 'RESULTADO', 'finalizar_entrenamiento tiró ERROR: ' || sqlerrm);
  end;
  perform pg_temp.como(null);
  return r;
end $f$;

-- "Pasan 11 segundos": corre para atrás todas las filas de ESTA corrida.
create or replace function pg_temp.pasan_11_segundos() returns int language plpgsql as $f$
declare c record; n int;
begin
  select * into c from pg_temp._ctx;
  update routine_history set created_at = created_at - interval '11 seconds'
  where user_id = c.facundo and not (id = any(c.ids_iniciales));
  get diagnostics n = row_count;
  return n;
end $f$;

-- Llama a eliminar_sesion_historial COMO p_user. Devuelve lo que devolvió, o null si tiró error.
create or replace function pg_temp.eliminar(p_paso text, p_user uuid, p_sesion uuid) returns int language plpgsql as $f$
declare r int;
begin
  perform pg_temp.como(p_user);
  begin
    r := public.eliminar_sesion_historial(p_sesion);
    perform pg_temp.log(p_paso, 'RESULTADO', format('eliminar_sesion_historial(%s) devolvió: %s', left(coalesce(p_sesion::text, 'null'), 8), r));
  exception when others then
    r := null;
    perform pg_temp.log(p_paso, 'RESULTADO', 'eliminar_sesion_historial tiró ERROR: ' || sqlerrm);
  end;
  perform pg_temp.como(null);
  return r;
end $f$;

-- ---- contexto ----
do $$
declare c record; e record;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.log('0', 'CONTEXTO', format('socio=%s  otro_usuario(7c)=%s  rutina=%s', c.facundo, c.otro_usuario, c.routine_id));
  perform pg_temp.log('0', 'CONTEXTO', format('día elegido="%s" (%s ejercicios); sesiones que ya tenías hoy: %s', c.day_title, c.total_dia, c.sesiones_hoy_previas));
  for e in select * from pg_temp._ej order by rn loop
    perform pg_temp.log('0', 'CONTEXTO', format('  #%s %s (%s)  %sx%s  peso guardado=%s  sugerido=%s',
      e.rn, e.nombre, coalesce(e.grupo, '-'), coalesce(e.series::text, '-'), coalesce(e.reps, '-'),
      coalesce(e.guardada, '-'), coalesce(e.sugerida, '-')));
  end loop;
end $$;

-- =====================================================================================
-- PASOS
-- =====================================================================================

-- ── PASO 1 ── Finalizar SIN ejercicios -> error, no se guarda nada.
do $$
declare r jsonb; n_antes int; n_desp int; v_user uuid;
begin
  select facundo into v_user from pg_temp._ctx;
  select count(*) into n_antes from routine_history where user_id = v_user;
  r := pg_temp.finalizar('1', '[]'::jsonb);
  select count(*) into n_desp from routine_history where user_id = v_user;
  perform pg_temp.verificar('1', r is null, 'el RPC rechazó la llamada (tiró error)');
  perform pg_temp.verificar('1', n_desp = n_antes, format('no se guardó ninguna fila (antes=%s, después=%s)', n_antes, n_desp));
end $$;

-- ── PASO 2 ── Finalizar 2 de 3 -> 2 filas, completo=false, total_ejercicios=3.
do $$
declare c record; r jsonb; v_sesion uuid; v_filas int; v_mal_completo int; v_mal_total int; v_peso1 text;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.foto('2', 'ANTES');
  r := pg_temp.finalizar('2', pg_temp.items(2));
  v_sesion := (r->>'sesion_id')::uuid;
  update pg_temp._ctx set sesion2 = v_sesion, huella2 = pg_temp.huella(v_sesion);
  perform pg_temp.foto('2', 'DESPUES');

  select count(*), count(*) filter (where completo is distinct from false),
         count(*) filter (where total_ejercicios is distinct from c.total_dia), max(peso) filter (where orden = 0)
    into v_filas, v_mal_completo, v_mal_total, v_peso1
  from routine_history where sesion_id = v_sesion;

  perform pg_temp.verificar('2', (r->>'registrado')::boolean, 'registrado=true');
  perform pg_temp.verificar('2', v_filas = 2, format('2 filas con el mismo sesion_id (hay %s)', v_filas));
  perform pg_temp.verificar('2', v_filas > 0 and v_mal_completo = 0, 'completo=false en todas');
  perform pg_temp.verificar('2', v_filas > 0 and v_mal_total = 0, format('total_ejercicios=%s en todas', c.total_dia));
  perform pg_temp.verificar('2', v_peso1 = '42.5kg', format('peso puesto a mano guardado (1° = %s)', coalesce(v_peso1, '-')));
end $$;

-- ── PASO 5 ── (pegado al 2) El Admin edita y borra la rutina -> filas del paso 2 intactas.
do $$
declare
  c record;
  v_ex1 uuid; v_reps_orig text; v_series_orig int; v_sug_orig text;
  v_h_upd text; v_h_del text; v_re_upd int; v_dias_borrados int; v_re_quedan int; v_err text;
  v_re_final int; v_reps_final text; v_series_final int; v_sug_final text;
begin
  select * into c from pg_temp._ctx;
  if c.sesion2 is null then
    perform pg_temp.log('5', 'NOTA', 'SALTEADO: el paso 2 no guardó nada.');
    return;
  end if;
  select re_id, reps, series, sugerida into v_ex1, v_reps_orig, v_series_orig, v_sug_orig from pg_temp._ej where rn = 1;

  begin
    update routine_exercises
       set reps = coalesce(reps, '') || ' [EDITADO POR PRUEBA]', sets = coalesce(sets, 0) + 1, weight_suggestion = '999kg'
     where id = v_ex1;
    get diagnostics v_re_upd = row_count;
    v_h_upd := pg_temp.huella(c.sesion2);

    delete from routine_days where routine_id = c.routine_id;
    get diagnostics v_dias_borrados = row_count;
    select count(*) into v_re_quedan from routine_exercises where id in (select re_id from pg_temp._ej);
    v_h_del := pg_temp.huella(c.sesion2);

    raise exception 'ROLLBACK_SIMULACION';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SIMULACION' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    perform pg_temp.log('5', 'RESULTADO', 'ERROR simulando la edición (se deshizo igual): ' || v_err);
  end if;
  perform pg_temp.log('5', 'RESULTADO', format('UPDATE: %s fila; DELETE: %s días borrados, ejercicios que quedaron: %s',
    coalesce(v_re_upd, 0), coalesce(v_dias_borrados, 0), coalesce(v_re_quedan::text, '-')));
  perform pg_temp.verificar('5', v_h_upd = c.huella2, 'filas del paso 2 intactas después del UPDATE de la rutina');
  perform pg_temp.verificar('5', v_dias_borrados > 0 and v_re_quedan = 0 and v_h_del = c.huella2,
    'filas del paso 2 intactas después de BORRAR la rutina (cascada)');

  select count(*) into v_re_final from routine_exercises where id in (select re_id from pg_temp._ej);
  select reps, sets, weight_suggestion into v_reps_final, v_series_final, v_sug_final from routine_exercises where id = v_ex1;
  perform pg_temp.verificar('5', v_re_final = c.total_dia
      and v_reps_final is not distinct from v_reps_orig
      and v_series_final is not distinct from v_series_orig
      and v_sug_final is not distinct from v_sug_orig,
    'la edición simulada se deshizo: tu rutina real está intacta');
end $$;

-- ── PASO 3 ── Finalizar de nuevo enseguida -> registrado=false, motivo='reciente'.
--    (Es lo que la app muestra como "Ya registraste este entrenamiento recién.")
do $$
declare c record; r jsonb; n_antes int; n_desp int; v_creado timestamptz;
begin
  select * into c from pg_temp._ctx;
  if c.sesion2 is null then perform pg_temp.log('3', 'NOTA', 'SALTEADO: el paso 2 no guardó nada.'); return; end if;
  select count(*) into n_antes from routine_history where user_id = c.facundo;
  r := pg_temp.finalizar('3', pg_temp.items(2));
  select count(*) into n_desp from routine_history where user_id = c.facundo;
  select min(created_at) into v_creado from routine_history where sesion_id = c.sesion2;

  perform pg_temp.verificar('3', r is not null and (r->>'registrado')::boolean = false and r->>'motivo' = 'reciente',
    'registrado=false con motivo="reciente"');
  perform pg_temp.verificar('3', (r->>'disponible_desde')::timestamptz = v_creado + interval '10 seconds',
    'disponible_desde = hora del paso 2 + 10 s (ya NO es 1 hora)');
  perform pg_temp.verificar('3', n_desp = n_antes, format('no se guardó ninguna fila (antes=%s, después=%s)', n_antes, n_desp));
end $$;

-- ── PASO 4 ── "Pasan" 11 segundos y finalizar 3 de 3 -> 2ª sesión el mismo día, completo=true.
do $$
declare c record; r jsonb; v_movidas int; v_sesion uuid; v_filas int; v_mal int; v_sesiones_hoy int;
begin
  select * into c from pg_temp._ctx;
  if c.sesion2 is null then perform pg_temp.log('4', 'NOTA', 'SALTEADO: el paso 2 no guardó nada.'); return; end if;

  v_movidas := pg_temp.pasan_11_segundos();
  perform pg_temp.log('4', 'NOTA', format('SIMULADO: %s filas de esta corrida corridas 11 s para atrás (= "pasaron 11 segundos").', v_movidas));
  r := pg_temp.finalizar('4', pg_temp.items(c.total_dia));
  v_sesion := (r->>'sesion_id')::uuid;
  update pg_temp._ctx set sesion4 = v_sesion;
  perform pg_temp.foto('4', 'DESPUES');

  select count(*), count(*) filter (where completo is distinct from true) into v_filas, v_mal
  from routine_history where sesion_id = v_sesion;
  select count(distinct sesion_id) into v_sesiones_hoy
  from routine_history where sesion_id in (c.sesion2, v_sesion)
    and fecha = (now() at time zone 'America/Argentina/Mendoza')::date;

  perform pg_temp.verificar('4', (r->>'registrado')::boolean, 'pasados 10 s, vuelve a aceptar (registrado=true)');
  perform pg_temp.verificar('4', v_sesion is not null and v_sesion <> c.sesion2, 'es una sesión NUEVA (otro sesion_id)');
  perform pg_temp.verificar('4', v_filas = c.total_dia and v_mal = 0, format('%s filas con completo=true', c.total_dia));
  perform pg_temp.verificar('4', v_sesiones_hoy = 2, format('2 entradas separadas con la fecha de hoy (hay %s)', v_sesiones_hoy));
end $$;

-- ── PASO 6 ── Tope diario: se completan 20 sesiones hoy (cada llamada separada por 11 s simulados)
--    y la 21ª tiene que rebotar con motivo='tope_diario' sin guardar nada.
do $$
declare
  c record; r jsonb; v_hoy int; v_llamadas int := 0; v_rechazadas int := 0; n_antes int; n_desp int;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.foto_corta('6', 'ANTES');

  loop
    select count(distinct sesion_id) into v_hoy from routine_history
    where user_id = c.facundo and fecha = (now() at time zone 'America/Argentina/Mendoza')::date;
    exit when v_hoy >= 20 or v_llamadas >= 25;
    perform pg_temp.pasan_11_segundos();
    r := pg_temp.finalizar('6', pg_temp.items(1), false);
    v_llamadas := v_llamadas + 1;
    if r is null or (r->>'registrado')::boolean is not true then v_rechazadas := v_rechazadas + 1; end if;
  end loop;
  perform pg_temp.log('6', 'RESULTADO', format('%s finalizaciones extra para llegar a 20 hoy (%s rechazadas antes de llegar)', v_llamadas, v_rechazadas));
  perform pg_temp.foto_corta('6', 'CON 20 HOY');
  perform pg_temp.verificar('6', v_hoy = 20 and v_rechazadas = 0, format('se aceptaron todas hasta la 20ª (sesiones hoy = %s)', v_hoy));

  perform pg_temp.pasan_11_segundos();
  select count(*) into n_antes from routine_history where user_id = c.facundo;
  r := pg_temp.finalizar('6', pg_temp.items(1));
  select count(*) into n_desp from routine_history where user_id = c.facundo;
  perform pg_temp.verificar('6', r is not null and (r->>'registrado')::boolean = false and r->>'motivo' = 'tope_diario',
    'la 21ª rebota con motivo="tope_diario" (la app: "Llegaste al máximo de 20 entrenamientos registrados por hoy.")');
  perform pg_temp.verificar('6', n_desp = n_antes, format('no se guardó ninguna fila (antes=%s, después=%s)', n_antes, n_desp));
end $$;

-- ── PASO 7 ── Eliminar.
--    7a: el socio borra la sesión del paso 2 -> devuelve 2, se van SUS 2 filas y nada más.
--    7b: borrarla de nuevo -> 0 (ya no existe), sin error.
--    7c: OTRO usuario intenta borrar la sesión del paso 4 -> 0 y la sesión sigue entera.
--    7d: DELETE directo sobre la tabla como rol authenticated (lo que haría un .delete() desde la
--        app o la consola) -> 0 filas: sin policy de delete, RLS no deja borrar nada.
--    7e: no existe ninguna policy de DELETE/ALL en routine_history.
--    7f: sin sesion_id -> error.
do $$
declare
  c record; r int; v_total_antes int; v_total_desp int; v_quedan2 int; v_h4_antes text; v_h4_desp text;
  v_directo int; v_directo_err text; v_policies int;
begin
  select * into c from pg_temp._ctx;
  if c.sesion2 is null or c.sesion4 is null then
    perform pg_temp.log('7', 'NOTA', 'SALTEADO: faltan las sesiones de los pasos 2 y 4.');
    return;
  end if;

  -- 7a
  select count(*) into v_total_antes from routine_history where user_id = c.facundo;
  r := pg_temp.eliminar('7a', c.facundo, c.sesion2);
  select count(*) into v_total_desp from routine_history where user_id = c.facundo;
  select count(*) into v_quedan2 from routine_history where sesion_id = c.sesion2;
  perform pg_temp.verificar('7a', r = 2, format('devolvió 2 (filas borradas = %s)', coalesce(r::text, 'ERROR')));
  perform pg_temp.verificar('7a', v_quedan2 = 0, 'no quedó ninguna fila de esa sesión (se borró COMPLETA)');
  perform pg_temp.verificar('7a', v_total_antes - v_total_desp = 2, format('solo se borraron esas 2 filas (antes=%s, después=%s)', v_total_antes, v_total_desp));

  -- 7b
  r := pg_temp.eliminar('7b', c.facundo, c.sesion2);
  perform pg_temp.verificar('7b', r = 0, 'borrar una sesión que ya no existe devuelve 0, sin error');

  -- 7c
  v_h4_antes := pg_temp.huella(c.sesion4);
  r := pg_temp.eliminar('7c', c.otro_usuario, c.sesion4);
  v_h4_desp := pg_temp.huella(c.sesion4);
  perform pg_temp.verificar('7c', r = 0, 'otro usuario NO puede borrar la sesión de Facundo (devolvió 0)');
  perform pg_temp.verificar('7c', v_h4_desp = v_h4_antes, format('la sesión del paso 4 sigue entera (huella %s)', v_h4_desp));

  -- 7d
  begin
    perform pg_temp.como(c.facundo);
    execute 'set local role authenticated';
    execute format('delete from public.routine_history where sesion_id = %L', c.sesion4);
    get diagnostics v_directo = row_count;
    execute 'reset role';
  exception when others then
    v_directo_err := sqlerrm;
    execute 'reset role';
  end;
  perform pg_temp.como(null);
  perform pg_temp.log('7d', 'RESULTADO', coalesce('DELETE directo tiró ERROR: ' || v_directo_err, format('DELETE directo borró %s filas', v_directo)));
  perform pg_temp.verificar('7d', v_directo_err is not null or v_directo = 0,
    'un DELETE directo sobre la tabla (como el socio) no borra nada');
  perform pg_temp.verificar('7d', pg_temp.huella(c.sesion4) = v_h4_antes, 'la sesión del paso 4 sigue entera');

  -- 7e
  select count(*) into v_policies from pg_policies
  where schemaname = 'public' and tablename = 'routine_history' and cmd in ('DELETE', 'ALL', 'UPDATE', 'INSERT');
  perform pg_temp.verificar('7e', v_policies = 0, format('routine_history no tiene policies de escritura (hay %s); solo la de lectura', v_policies));

  -- 7f
  r := pg_temp.eliminar('7f', c.facundo, null);
  perform pg_temp.verificar('7f', r is null, 'sin sesion_id -> error');

  perform pg_temp.foto_corta('7', 'DESPUES');
end $$;

-- ── LIMPIEZA ──
do $$
declare c record; v_borradas int; v_total int;
begin
  select * into c from pg_temp._ctx;
  if c.limpiar_al_final then
    delete from routine_history where user_id = c.facundo and not (id = any(c.ids_iniciales));
    get diagnostics v_borradas = row_count;
    select count(*) into v_total from routine_history where user_id = c.facundo;
    perform pg_temp.log('LIMPIEZA', 'RESULTADO', format('borradas las %s filas de prueba que quedaban', v_borradas));
    perform pg_temp.verificar('LIMPIEZA', v_total = cardinality(c.ids_iniciales),
      format('el historial quedó igual que al arrancar (%s filas)', v_total));
  else
    perform pg_temp.log('LIMPIEZA', 'NOTA', format(
      'limpiar_al_final=false: quedaron las filas de prueba. Para borrarlas: delete from routine_history where user_id = %L and created_at >= %L;',
      c.facundo, now() - interval '10 minutes'));
  end if;
  perform pg_temp.log('LIMPIEZA', 'NOTA', 'Tu rutina (routine_days / routine_exercises) no se modificó: el paso 5 se deshizo solo.');
end $$;

insert into pg_temp._log(paso, momento, linea)
select 'RESUMEN', '', format('%s chequeos OK, %s FALLA', count(*) filter (where linea like 'OK%'), count(*) filter (where linea like 'FALLA%'))
from pg_temp._log where momento = 'CHEQUEO';

commit;

select paso, momento, linea from pg_temp._log order by n;
