-- =====================================================================================
-- PRUEBA de routine_history / finalizar_entrenamiento() -- TODO por SQL, sin la app.
-- Cuenta de prueba: Facundo Uria, DNI 44537978. Mismo formato que prueba_reseteo_expires_at_*.sql.
--
-- REQUISITO: haber corrido backend/supabase_migration_routine_history.sql (la versión CORREGIDA,
-- con gen_random_uuid(); el preflight lo verifica y aborta si encuentra la vieja).
--
-- CÓMO CORRERLO
--   * Pegar TODO el archivo en el SQL Editor y ejecutar UNA vez. El resultado es la ÚLTIMA grilla
--     (log completo: fotos ANTES/DESPUÉS, respuesta del RPC y una línea OK/FALLA por chequeo).
--   * Va envuelto en begin/commit. Las llamadas al RPC corren COMO el socio (auth.uid() = Facundo)
--     seteando request.jwt.claims (ver pg_temp.como). Si falla el preflight, se aborta todo.
--   * Orden de ejecución: 1, 2, 5, 3, 4. El 5 corre pegado al 2 porque pediste que la edición del
--     Admin se haga "después del paso 2", y el paso 4 necesita correr la hora de las filas del 2
--     (ver abajo). El 3 da igual dónde vaya: adentro de una transacción now() no avanza.
--
-- QUÉ SE SIMULA (y qué no)
--   * Cooldown (paso 4): adentro de una transacción now() es constante, así que "esperar 1 hora" no
--     existe. Se simula corriendo 61 minutos para atrás el created_at de las filas del paso 2. Es
--     fiel: la función solo compara max(created_at) contra now(). Lo que NO prueba es el reloj real;
--     para eso, desde la app: finalizá, esperá 1 hora y finalizá de nuevo (ver final del archivo).
--   * Edición del Admin (paso 5): se hace (a) el UPDATE que pediste sobre routine_exercises y
--     además (b) lo que REALMENTE hace el panel al guardar la rutina: borrar todos sus días
--     (cascada a routine_exercises). Las dos cosas corren dentro de un bloque que al final se
--     deshace solo (subtransacción): tu rutina real queda exactamente como estaba. El paso lo
--     verifica al final.
--
-- ESTADO FINAL
--   * Con limpiar_al_final = true (abajo, en _ctx), el script borra las filas de routine_history
--     que creó y verifica que el historial quede igual que al arrancar. Tu rutina no se toca (el
--     paso 5 se deshace solo). Si lo ponés en false, las filas quedan (para verlas en la app) y el
--     log te dice el DELETE exacto para borrarlas después.
-- =====================================================================================
begin;

drop table if exists pg_temp._log;
drop table if exists pg_temp._ctx;
drop table if exists pg_temp._ej;

create temp table _log (n bigserial primary key, paso text, momento text, linea text);

create temp table _ctx as
select
  (select id from profiles where dni = '44537978') as facundo,
  true          as limpiar_al_final,   -- <<< false = dejar las filas de prueba para verlas en la app
  null::uuid    as routine_id,
  null::uuid    as day_id,
  null::text    as day_title,
  null::int     as total_dia,
  null::uuid[]  as ids_iniciales,      -- filas de routine_history que ya existían al arrancar
  null::uuid    as sesion2,
  null::uuid    as sesion4,
  null::text    as huella2;

-- ---- preflight: si algo falta, aborta ANTES de tocar nada ----
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
begin
  select facundo into v_user from pg_temp._ctx;
  if v_user is null then raise exception 'No existe el perfil con DNI 44537978'; end if;

  if to_regclass('public.routine_history') is null
     or to_regprocedure('public.finalizar_entrenamiento(text,integer,jsonb)') is null then
    raise exception 'Falta correr backend/supabase_migration_routine_history.sql';
  end if;
  if pg_get_functiondef('public.finalizar_entrenamiento(text,integer,jsonb)'::regprocedure) like '%uuid_generate_v4%' then
    raise exception 'finalizar_entrenamiento() es la versión VIEJA (usa uuid_generate_v4, que no encuentra con search_path=public). Volvé a correr la migración corregida entera -- es idempotente.';
  end if;

  -- routine_exercises -> routine_days: el Admin usa day_id; el seed viejo asumía routine_day_id.
  select column_name into v_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'routine_exercises' and column_name in ('day_id', 'routine_day_id')
  order by (column_name = 'day_id') desc
  limit 1;
  if v_col is null then raise exception 'routine_exercises no tiene columna day_id ni routine_day_id'; end if;

  select id into v_routine from routines where user_id = v_user order by created_at desc limit 1;
  if v_routine is null then raise exception 'El socio no tiene ninguna rutina asignada'; end if;

  -- Día a usar: preferentemente uno con EXACTAMENTE 3 ejercicios; si no hay, el primero con 3 o más.
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

  v_hay_pesos := to_regclass('public.routine_exercise_weights') is not null;
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
    case when v_hay_pesos then format('left join routine_exercise_weights w on w.routine_exercise_id = re.id and w.user_id = %L', v_user) else '' end,
    v_col, v_day);

  -- Si ya finalizaste algo en la última hora (ej. probando desde la app), el paso 2 chocaría
  -- con el cooldown real y la prueba no tendría sentido.
  select max(created_at) into v_ultimo from routine_history where user_id = v_user;
  if v_ultimo is not null and v_ultimo > now() - interval '1 hour' then
    raise exception 'Ya hay un entrenamiento finalizado a las % (hora AR) -- el cooldown real está activo hasta las %. Esperá o corré esto después.',
      to_char(v_ultimo at time zone 'America/Argentina/Mendoza', 'HH24:MI'),
      to_char((v_ultimo + interval '1 hour') at time zone 'America/Argentina/Mendoza', 'HH24:MI');
  end if;

  update pg_temp._ctx set
    routine_id = v_routine,
    day_id = v_day,
    day_title = v_title,
    total_dia = v_total,
    ids_iniciales = coalesce((select array_agg(id) from routine_history where user_id = v_user), '{}');
end $$;

-- ---- helpers ----

-- Contexto de sesión: auth.uid() lee request.jwt.claims. `true` = solo esta transacción.
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

-- La "foto": total de filas del socio + cada fila creada en esta corrida.
create or replace function pg_temp.foto_lineas() returns text[] language sql as $f$
  select array[format('  routine_history del socio: %s filas (%s ya estaban antes de esta corrida)',
                      count(h.id), count(h.id) filter (where h.id = any(c.ids_iniciales)))]
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

-- Huella de TODAS las columnas de las filas de una sesión (para probar que no cambió nada).
create or replace function pg_temp.huella(p_sesion uuid) returns text language sql as $f$
  select md5(coalesce(string_agg(concat_ws('|', id, sesion_id, fecha, titulo_dia, nombre_ejercicio, grupo_muscular,
                                           series, repeticiones, peso, orden, total_ejercicios, completo, created_at),
                                 ';' order by id), ''))
         || format(' (%s filas)', count(*))
  from routine_history where sesion_id = p_sesion;
$f$;

-- Los primeros N ejercicios del día, tal cual los manda la app. El 1° lleva un peso de prueba
-- puesto a mano (42.5kg); el resto, el peso que la app mostraría (guardado > sugerido).
create or replace function pg_temp.items(p_cuantos int) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nombre', nombre, 'grupo', grupo, 'series', series, 'repeticiones', reps,
           'peso', case when rn = 1 then '42.5kg' else coalesce(guardada, sugerida) end) order by rn), '[]'::jsonb)
  from pg_temp._ej where rn <= p_cuantos;
$f$;

-- Llama al RPC COMO el socio. Devuelve su respuesta, o null si tiró error (queda en el log).
create or replace function pg_temp.finalizar(p_paso text, p_items jsonb) returns jsonb language plpgsql as $f$
declare c record; r jsonb;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.como(c.facundo);
  begin
    r := public.finalizar_entrenamiento(c.day_title, c.total_dia, p_items);
    perform pg_temp.log(p_paso, 'RESULTADO', 'RPC devolvió: ' || r::text);
  exception when others then
    r := null;
    perform pg_temp.log(p_paso, 'RESULTADO', 'RPC tiró ERROR: ' || sqlerrm);
  end;
  perform pg_temp.como(null);
  return r;
end $f$;

-- ---- contexto de la corrida ----
do $$
declare c record; e record;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.log('0', 'CONTEXTO', format('socio=%s  rutina=%s  día elegido="%s" (%s ejercicios)', c.facundo, c.routine_id, c.day_title, c.total_dia));
  for e in select * from pg_temp._ej order by rn loop
    perform pg_temp.log('0', 'CONTEXTO', format('  #%s %s (%s)  %sx%s  peso guardado=%s  sugerido=%s',
      e.rn, e.nombre, coalesce(e.grupo, '-'), coalesce(e.series::text, '-'), coalesce(e.reps, '-'),
      coalesce(e.guardada, '-'), coalesce(e.sugerida, '-')));
  end loop;
  if c.total_dia <> 3 then
    perform pg_temp.log('0', 'NOTA', format('Tu rutina no tiene ningún día con exactamente 3 ejercicios: se usa uno con %s, así que en el paso 2 el total esperado es %s (no 3).', c.total_dia, c.total_dia));
  end if;
end $$;

-- =====================================================================================
-- PASOS
-- =====================================================================================

-- ── PASO 1 ── Finalizar SIN ejercicios marcados.
--    ESPERADO: el RPC tira "Marcá al menos un ejercicio para finalizar" y no se guarda nada.
do $$
declare r jsonb; n_antes int; n_desp int; v_user uuid;
begin
  select facundo into v_user from pg_temp._ctx;
  perform pg_temp.foto('1', 'ANTES');
  select count(*) into n_antes from routine_history where user_id = v_user;

  r := pg_temp.finalizar('1', '[]'::jsonb);

  select count(*) into n_desp from routine_history where user_id = v_user;
  perform pg_temp.foto('1', 'DESPUES');
  perform pg_temp.verificar('1', r is null, 'el RPC rechazó la llamada (tiró error, no devolvió resultado)');
  perform pg_temp.verificar('1', n_desp = n_antes, format('no se guardó ninguna fila (antes=%s, después=%s)', n_antes, n_desp));
end $$;

-- ── PASO 2 ── Finalizar con 2 de los 3 ejercicios del día, el 1° con peso 42.5kg.
--    ESPERADO: 2 filas nuevas con el mismo sesion_id, completo=false, total_ejercicios=3,
--    fecha = hoy (horario AR), peso del 1° = 42.5kg.
do $$
declare c record; r jsonb; v_sesion uuid; v_filas int; v_mal_completo int; v_mal_total int; v_mal_fecha int; v_peso1 text;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.foto('2', 'ANTES');

  r := pg_temp.finalizar('2', pg_temp.items(2));

  v_sesion := (r->>'sesion_id')::uuid;
  update pg_temp._ctx set sesion2 = v_sesion, huella2 = pg_temp.huella(v_sesion);
  perform pg_temp.foto('2', 'DESPUES');

  select count(*),
         count(*) filter (where completo is distinct from false),
         count(*) filter (where total_ejercicios is distinct from c.total_dia),
         count(*) filter (where fecha is distinct from (now() at time zone 'America/Argentina/Mendoza')::date),
         max(peso) filter (where orden = 0)
    into v_filas, v_mal_completo, v_mal_total, v_mal_fecha, v_peso1
  from routine_history where sesion_id = v_sesion;

  perform pg_temp.verificar('2', (r->>'registrado')::boolean, 'el RPC respondió registrado=true');
  perform pg_temp.verificar('2', v_filas = 2, format('se guardaron 2 filas con el mismo sesion_id (hay %s)', v_filas));
  perform pg_temp.verificar('2', v_filas > 0 and v_mal_completo = 0, 'completo=false en todas');
  perform pg_temp.verificar('2', v_filas > 0 and v_mal_total = 0, format('total_ejercicios=%s en todas', c.total_dia));
  perform pg_temp.verificar('2', v_filas > 0 and v_mal_fecha = 0, 'fecha = hoy en horario de Argentina');
  perform pg_temp.verificar('2', v_peso1 = '42.5kg', format('el peso puesto a mano quedó guardado (peso del 1° = %s)', coalesce(v_peso1, '-')));
  perform pg_temp.log('2', 'NOTA', 'Huella de las filas del paso 2 (se compara en el paso 5): ' || coalesce(pg_temp.huella(v_sesion), '-'));
end $$;

-- ── PASO 5 ── (corre acá, pegado al 2) El Admin edita la rutina: routine_history NO debe cambiar.
--    5a: UPDATE de routine_exercises (el 1° ejercicio del día: reps, series y peso sugerido).
--    5b: lo que hace de verdad el panel al guardar: DELETE de todos los días de la rutina
--        (cascada a routine_exercises, y de ahí a routine_completions / routine_exercise_weights).
--    Todo adentro de una subtransacción que se deshace al final: la rutina real queda intacta.
--    ESPERADO: huella de las filas del paso 2 idéntica antes, después del UPDATE y después del DELETE.
do $$
declare
  c record;
  v_ex1 uuid; v_reps_orig text; v_series_orig int; v_sug_orig text;
  v_h_upd text; v_h_del text; v_lin_upd text[]; v_lin_del text[];
  v_re_upd int; v_dias_borrados int; v_re_quedan int; v_err text;
  v_re_final int; v_reps_final text; v_series_final int; v_sug_final text;
begin
  select * into c from pg_temp._ctx;
  if c.sesion2 is null then
    perform pg_temp.log('5', 'NOTA', 'SALTEADO: el paso 2 no guardó nada, no hay filas que proteger.');
    return;
  end if;

  select re_id, reps, series, sugerida into v_ex1, v_reps_orig, v_series_orig, v_sug_orig from pg_temp._ej where rn = 1;
  perform pg_temp.log('5', 'ANTES', 'Huella filas del paso 2: ' || c.huella2);

  begin
    update routine_exercises
       set reps = coalesce(reps, '') || ' [EDITADO POR PRUEBA]',
           sets = coalesce(sets, 0) + 1,
           weight_suggestion = '999kg'
     where id = v_ex1;
    get diagnostics v_re_upd = row_count;
    v_h_upd := pg_temp.huella(c.sesion2);
    v_lin_upd := pg_temp.foto_lineas();

    delete from routine_days where routine_id = c.routine_id;
    get diagnostics v_dias_borrados = row_count;
    select count(*) into v_re_quedan from routine_exercises where id in (select re_id from pg_temp._ej);
    v_h_del := pg_temp.huella(c.sesion2);
    v_lin_del := pg_temp.foto_lineas();

    raise exception 'ROLLBACK_SIMULACION';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SIMULACION' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    perform pg_temp.log('5', 'RESULTADO', 'ERROR simulando la edición (se deshizo igual): ' || v_err);
  end if;

  perform pg_temp.log('5a', 'RESULTADO', format('UPDATE routine_exercises: %s fila editada (reps "%s" -> "%s [EDITADO POR PRUEBA]", series %s -> %s, sugerido %s -> 999kg)',
    coalesce(v_re_upd, 0), coalesce(v_reps_orig, ''), coalesce(v_reps_orig, ''), coalesce(v_series_orig::text, '-'), coalesce(v_series_orig, 0) + 1, coalesce(v_sug_orig, '-')));
  insert into pg_temp._log(paso, momento, linea) select '5a', 'DESPUES DEL UPDATE', unnest(coalesce(v_lin_upd, array['  (no llegó a correr)']));
  perform pg_temp.verificar('5a', v_re_upd = 1, 'el UPDATE sobre routine_exercises se aplicó');
  perform pg_temp.verificar('5a', v_h_upd = c.huella2, format('filas del paso 2 intactas después del UPDATE (huella %s)', coalesce(v_h_upd, '-')));

  perform pg_temp.log('5b', 'RESULTADO', format('DELETE routine_days de la rutina: %s días borrados; ejercicios del día que quedaron: %s (cascada)',
    coalesce(v_dias_borrados, 0), coalesce(v_re_quedan::text, '-')));
  insert into pg_temp._log(paso, momento, linea) select '5b', 'DESPUES DEL DELETE', unnest(coalesce(v_lin_del, array['  (no llegó a correr)']));
  perform pg_temp.verificar('5b', v_dias_borrados > 0 and v_re_quedan = 0, 'la rutina quedó borrada de verdad (la cascada se llevó los ejercicios)');
  perform pg_temp.verificar('5b', v_h_del = c.huella2, format('filas del paso 2 intactas después del DELETE (huella %s)', coalesce(v_h_del, '-')));

  -- La edición se deshizo: la rutina real tiene que estar exactamente como antes.
  select count(*) into v_re_final from routine_exercises where id in (select re_id from pg_temp._ej);
  select reps, sets, weight_suggestion into v_reps_final, v_series_final, v_sug_final from routine_exercises where id = v_ex1;
  perform pg_temp.verificar('5', v_re_final = c.total_dia
      and v_reps_final is not distinct from v_reps_orig
      and v_series_final is not distinct from v_series_orig
      and v_sug_final is not distinct from v_sug_orig,
    format('la edición simulada se deshizo: tu rutina real está intacta (%s de %s ejercicios, reps/series/sugerido originales)', v_re_final, c.total_dia));
end $$;

-- ── PASO 3 ── Finalizar de nuevo "inmediatamente".
--    ESPERADO: NO es un error SQL -- la función responde registrado=false + disponible_desde (hora del
--    paso 2 + 1 h). Es lo que la app muestra como "Ya registraste un entrenamiento hace poco. Podés
--    volver a finalizar a partir de las HH:MM." No se guarda nada.
do $$
declare c record; r jsonb; n_antes int; n_desp int; v_creado timestamptz;
begin
  select * into c from pg_temp._ctx;
  if c.sesion2 is null then
    perform pg_temp.log('3', 'NOTA', 'SALTEADO: el paso 2 no guardó nada, no hay cooldown que probar.');
    return;
  end if;
  perform pg_temp.foto('3', 'ANTES');
  select count(*) into n_antes from routine_history where user_id = c.facundo;

  r := pg_temp.finalizar('3', pg_temp.items(2));

  select count(*) into n_desp from routine_history where user_id = c.facundo;
  perform pg_temp.foto('3', 'DESPUES');
  select min(created_at) into v_creado from routine_history where sesion_id = c.sesion2;

  perform pg_temp.verificar('3', r is not null and (r->>'registrado')::boolean = false, 'cooldown: el RPC respondió registrado=false');
  perform pg_temp.verificar('3', (r->>'disponible_desde')::timestamptz = v_creado + interval '1 hour',
    format('disponible_desde = hora del paso 2 + 1 h (la app diría "a partir de las %s")',
           to_char(((r->>'disponible_desde')::timestamptz) at time zone 'America/Argentina/Mendoza', 'HH24:MI')));
  perform pg_temp.verificar('3', n_desp = n_antes, format('no se guardó ninguna fila (antes=%s, después=%s)', n_antes, n_desp));
end $$;

-- ── PASO 4 ── Simular que pasó más de 1 hora y finalizar otra vez (ahora con los 3 ejercicios).
--    SIMULADO: se corre 61 min para atrás el created_at de las filas del paso 2 (ver encabezado).
--    ESPERADO: registrado=true, sesión NUEVA (otro sesion_id) el MISMO día, con completo=true
--    (3 de 3, así de paso se prueba también el caso completo).
do $$
declare c record; r jsonb; v_movidas int; v_sesion uuid; v_filas int; v_mal_completo int; v_sesiones_hoy int;
begin
  select * into c from pg_temp._ctx;
  if c.sesion2 is null then
    perform pg_temp.log('4', 'NOTA', 'SALTEADO: el paso 2 no guardó nada.');
    return;
  end if;

  update routine_history set created_at = created_at - interval '61 minutes' where sesion_id = c.sesion2;
  get diagnostics v_movidas = row_count;
  perform pg_temp.log('4', 'NOTA', format('SIMULADO: created_at de las %s filas del paso 2 corrido 61 min para atrás (= "pasó 1 hora y 1 minuto").', v_movidas));
  perform pg_temp.foto('4', 'ANTES');

  r := pg_temp.finalizar('4', pg_temp.items(c.total_dia));

  v_sesion := (r->>'sesion_id')::uuid;
  update pg_temp._ctx set sesion4 = v_sesion;
  perform pg_temp.foto('4', 'DESPUES');

  select count(*), count(*) filter (where completo is distinct from true)
    into v_filas, v_mal_completo
  from routine_history where sesion_id = v_sesion;
  select count(distinct sesion_id) into v_sesiones_hoy
  from routine_history
  where sesion_id in (c.sesion2, v_sesion)
    and fecha = (now() at time zone 'America/Argentina/Mendoza')::date;

  perform pg_temp.verificar('4', (r->>'registrado')::boolean, 'pasada la hora, el RPC volvió a aceptar (registrado=true)');
  perform pg_temp.verificar('4', v_sesion is not null and v_sesion <> c.sesion2, 'es una sesión NUEVA (otro sesion_id), no se mezcló con la del paso 2');
  perform pg_temp.verificar('4', v_filas = c.total_dia, format('se guardaron %s filas (hay %s)', c.total_dia, v_filas));
  perform pg_temp.verificar('4', v_filas > 0 and v_mal_completo = 0, 'con todos marcados queda completo=true');
  perform pg_temp.verificar('4', v_sesiones_hoy = 2, format('hay 2 entradas separadas con la fecha de hoy (hay %s)', v_sesiones_hoy));
end $$;

-- ── LIMPIEZA ──
do $$
declare c record; v_borradas int; v_total int;
begin
  select * into c from pg_temp._ctx;
  if c.limpiar_al_final then
    delete from routine_history where sesion_id in (c.sesion2, c.sesion4);
    get diagnostics v_borradas = row_count;
    select count(*) into v_total from routine_history where user_id = c.facundo;
    perform pg_temp.log('LIMPIEZA', 'RESULTADO', format('borradas las %s filas de prueba de routine_history', v_borradas));
    perform pg_temp.foto('LIMPIEZA', 'DESPUES');
    perform pg_temp.verificar('LIMPIEZA', v_total = cardinality(c.ids_iniciales),
      format('el historial quedó igual que al arrancar (%s filas)', v_total));
  else
    perform pg_temp.log('LIMPIEZA', 'NOTA', format('limpiar_al_final=false: quedaron las filas de prueba. Para borrarlas: delete from routine_history where sesion_id in (%L, %L);', c.sesion2, c.sesion4));
  end if;
  perform pg_temp.log('LIMPIEZA', 'NOTA', 'Tu rutina (routine_days / routine_exercises) no se modificó: el paso 5 se deshizo solo.');
end $$;

-- ── RESUMEN ──
insert into pg_temp._log(paso, momento, linea)
select 'RESUMEN', '', format('%s chequeos OK, %s FALLA', count(*) filter (where linea like 'OK%'), count(*) filter (where linea like 'FALLA%'))
from pg_temp._log where momento = 'CHEQUEO';

commit;

-- =====================================================================================
-- RESULTADO: log completo.
-- =====================================================================================
select paso, momento, linea from pg_temp._log order by n;

-- =====================================================================================
-- COOLDOWN CON RELOJ REAL (lo único que este script no puede probar) -- desde la app:
--   1. Mi Rutina > marcá 1 ejercicio > Finalizar  -> festejo.
--   2. Finalizar de nuevo enseguida               -> "Ya registraste un entrenamiento hace poco.
--                                                     Podés volver a finalizar a partir de las HH:MM."
--   3. Pasada esa hora, Finalizar otra vez         -> festejo; en Historial, ese día muestra
--                                                     "2 entrenamientos" con las dos horas.
-- Para no esperar la hora en ese paso 3, se puede correr esto en el SQL Editor (mismo truco que el
-- paso 4, sobre tu última sesión real) y volver a tocar Finalizar:
--   update routine_history set created_at = created_at - interval '61 minutes'
--   where sesion_id = (select sesion_id from routine_history
--                      where user_id = (select id from profiles where dni = '44537978')
--                      order by created_at desc limit 1);
-- =====================================================================================
