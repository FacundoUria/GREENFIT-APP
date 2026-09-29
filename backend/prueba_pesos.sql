-- =====================================================================================
-- PRUEBA de user_exercise_weights (carga por socio y por EJERCICIO) -- TODO por SQL, sin la app.
-- Cuenta de prueba: Facundo Uria, DNI 44537978. Mismo formato que prueba_routine_history_v2.sql.
--
-- REQUISITO: haber corrido backend/supabase_migration_user_exercise_weights.sql (el preflight lo
-- verifica y aborta si la tabla no existe).
--
-- CÓMO CORRERLO
--   * Pegar TODO el archivo en el SQL Editor y ejecutar UNA vez. El resultado es la ÚLTIMA grilla
--     (log con una línea OK/FALLA por chequeo y resumen al final).
--   * Va envuelto en begin/commit. Lo que hace "el socio" corre con el rol `authenticated` y
--     auth.uid() = Facundo (pg_temp.como_socio): o sea, con RLS de verdad, igual que la app.
--
-- PASOS
--   1  El socio guarda 42.5kg en un ejercicio de su rutina (upsert, como la app)
--   2  Lo cambia a 45kg -> se pisa (sigue habiendo UNA fila)
--   3  El socio lee su carga
--   4  Otro usuario (el primer admin): no la ve, no puede guardar a nombre de Facundo ni pisarla
--   5  EL CASO IMPORTANTE: Seba re-guarda la rutina (borra y recrea días/ejercicios con ids
--      NUEVOS, igual que saveRoutineFull del panel) -> la carga sigue ahí y la app la encuentra
--      para el ejercicio nuevo. Se hace de verdad y se deshace sola (subtransacción).
--   6  Borrar un ejercicio del catálogo arrastra sus cargas (con un ejercicio TEMPORAL de
--      prueba, también dentro de una subtransacción que se deshace).
--   7  La tabla no tiene policy de delete.
--
-- ESTADO FINAL: se borra la fila de prueba (o, si Facundo ya tenía una carga en ese ejercicio,
-- se le devuelve el valor original). La rutina y el catálogo no cambian (pasos 5 y 6 se deshacen).
-- =====================================================================================
begin;

drop table if exists pg_temp._log;
drop table if exists pg_temp._ctx;

create temp table _log (n bigserial primary key, paso text, momento text, linea text);

create temp table _ctx as
select
  (select id from profiles where dni = '44537978') as facundo,
  (select id from profiles where role = 'admin' and dni is distinct from '44537978' order by created_at limit 1) as otro_usuario,
  null::text  as col_dia,
  null::uuid  as routine_id,
  null::uuid  as exercise_id,          -- ejercicio de la rutina de Facundo que se usa en la prueba
  null::text  as exercise_name,
  null::text  as peso_original,        -- si Facundo ya tenía carga en ese ejercicio, se restaura
  null::timestamptz as updated_original;

-- ---- preflight ----
do $$
declare
  v_user uuid; v_col text; v_routine uuid; v_ex uuid; v_nombre text; v_peso text; v_upd timestamptz;
begin
  select facundo into v_user from pg_temp._ctx;
  if v_user is null then raise exception 'No existe el perfil con DNI 44537978'; end if;
  if (select otro_usuario from pg_temp._ctx) is null then
    raise exception 'No hay otro profile con role = admin (hace falta para el paso 4)';
  end if;
  if to_regclass('public.user_exercise_weights') is null then
    raise exception 'Falta correr supabase_migration_user_exercise_weights.sql';
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
    select e.id, e.name
    from routine_days rd
    join routine_exercises re on re.%I = rd.id
    join exercises e on e.id = re.exercise_id
    where rd.routine_id = %L
    order by rd.order_index, re.order_index
    limit 1
  $f$, v_col, v_routine) into v_ex, v_nombre;
  if v_ex is null then raise exception 'La rutina vigente no tiene ejercicios'; end if;

  select weight_used, updated_at into v_peso, v_upd
  from user_exercise_weights where user_id = v_user and exercise_id = v_ex;

  update pg_temp._ctx set col_dia = v_col, routine_id = v_routine, exercise_id = v_ex,
    exercise_name = v_nombre, peso_original = v_peso, updated_original = v_upd;
end $$;

-- ---- helpers ----

create or replace function pg_temp.log(p_paso text, p_momento text, p_linea text) returns void language sql as $f$
  insert into pg_temp._log(paso, momento, linea) values (p_paso, p_momento, p_linea);
$f$;

create or replace function pg_temp.verificar(p_paso text, p_ok boolean, p_texto text) returns void language sql as $f$
  insert into pg_temp._log(paso, momento, linea)
  values (p_paso, 'CHEQUEO', case when coalesce(p_ok, false) then 'OK     ' else 'FALLA  ' end || p_texto);
$f$;

-- Ejecuta p_sql COMO p_user con el rol `authenticated` (RLS activo, como la app). Devuelve cuántas
-- filas afectó, el primer valor que devolvió (si es un select) y el error, si hubo.
create or replace function pg_temp.como_socio(p_user uuid, p_sql text, out filas int, out valor text, out err text)
language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    execute 'set local role authenticated';
    if p_sql ~* '^\s*select' then
      execute p_sql into valor;
      filas := case when valor is null then 0 else 1 end;
    else
      execute p_sql;
      get diagnostics filas = row_count;
    end if;
    execute 'reset role';
  exception when others then
    err := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $f$;

-- El mismo upsert que hace saveExerciseWeight() desde la app.
create or replace function pg_temp.sql_guardar(p_user uuid, p_ex uuid, p_peso text) returns text language sql as $f$
  select format($q$insert into public.user_exercise_weights (user_id, exercise_id, weight_used, updated_at)
                  values (%L, %L, %L, now())
                  on conflict (user_id, exercise_id)
                  do update set weight_used = excluded.weight_used, updated_at = excluded.updated_at$q$,
                p_user, p_ex, p_peso);
$f$;

create or replace function pg_temp.huella_peso() returns text language sql as $f$
  select md5(coalesce(string_agg(concat_ws('|', w.id, w.user_id, w.exercise_id, w.weight_used, w.updated_at), ';' order by w.id), ''))
         || format(' (%s filas)', count(*))
  from user_exercise_weights w, pg_temp._ctx c
  where w.user_id = c.facundo and w.exercise_id = c.exercise_id;
$f$;

do $$
declare c record;
begin
  select * into c from pg_temp._ctx;
  perform pg_temp.log('0', 'CONTEXTO', format('socio=%s  otro_usuario(4)=%s  rutina=%s', c.facundo, c.otro_usuario, c.routine_id));
  perform pg_temp.log('0', 'CONTEXTO', format('ejercicio de prueba: "%s" (%s); carga que ya tenías ahí: %s',
    c.exercise_name, c.exercise_id, coalesce(c.peso_original, 'ninguna')));
end $$;

-- =====================================================================================
-- PASOS
-- =====================================================================================

-- ── PASO 1 ── El socio guarda 42.5kg.
do $$
declare c record; r record; v_filas int;
begin
  select * into c from pg_temp._ctx;
  r := pg_temp.como_socio(c.facundo, pg_temp.sql_guardar(c.facundo, c.exercise_id, '42.5kg'));
  perform pg_temp.log('1', 'RESULTADO', coalesce('ERROR: ' || r.err, format('upsert OK (%s fila)', r.filas)));
  select count(*) into v_filas from user_exercise_weights where user_id = c.facundo and exercise_id = c.exercise_id;
  perform pg_temp.verificar('1', r.err is null and r.filas = 1, 'el socio puede guardar su carga (RLS insert propio)');
  perform pg_temp.verificar('1', v_filas = 1 and (select weight_used from user_exercise_weights
    where user_id = c.facundo and exercise_id = c.exercise_id) = '42.5kg', 'quedó 1 fila con 42.5kg');
end $$;

-- ── PASO 2 ── Lo cambia a 45kg -> se pisa.
do $$
declare c record; r record; v_filas int; v_peso text;
begin
  select * into c from pg_temp._ctx;
  r := pg_temp.como_socio(c.facundo, pg_temp.sql_guardar(c.facundo, c.exercise_id, '45kg'));
  perform pg_temp.log('2', 'RESULTADO', coalesce('ERROR: ' || r.err, format('upsert OK (%s fila)', r.filas)));
  select count(*), max(weight_used) into v_filas, v_peso
  from user_exercise_weights where user_id = c.facundo and exercise_id = c.exercise_id;
  perform pg_temp.verificar('2', r.err is null, 'el socio puede cambiar su carga (RLS update propio)');
  perform pg_temp.verificar('2', v_filas = 1 and v_peso = '45kg', format('se pisó: sigue habiendo 1 fila, ahora con %s', v_peso));
end $$;

-- ── PASO 3 ── El socio lee su carga (lo que hace getUserExerciseWeights).
do $$
declare c record; r record;
begin
  select * into c from pg_temp._ctx;
  r := pg_temp.como_socio(c.facundo, format(
    'select weight_used from public.user_exercise_weights where user_id = %L and exercise_id = %L', c.facundo, c.exercise_id));
  perform pg_temp.log('3', 'RESULTADO', coalesce('ERROR: ' || r.err, 'el socio lee: ' || coalesce(r.valor, '(nada)')));
  perform pg_temp.verificar('3', r.valor = '45kg', 'el socio lee su carga (RLS select propio)');
end $$;

-- ── PASO 4 ── Otro usuario no ve, no guarda a nombre de Facundo, no pisa.
do $$
declare c record; r record; v_antes text;
begin
  select * into c from pg_temp._ctx;
  v_antes := pg_temp.huella_peso();

  r := pg_temp.como_socio(c.otro_usuario, format(
    'select count(*)::text from public.user_exercise_weights where user_id = %L', c.facundo));
  perform pg_temp.verificar('4', r.valor = '0', format('otro usuario NO ve las cargas de Facundo (ve %s)', coalesce(r.valor, r.err)));

  r := pg_temp.como_socio(c.otro_usuario, pg_temp.sql_guardar(c.facundo, c.exercise_id, '999kg'));
  perform pg_temp.log('4', 'RESULTADO', 'guardar a nombre de Facundo: ' || coalesce('ERROR: ' || r.err, format('%s filas', r.filas)));
  perform pg_temp.verificar('4', r.err is not null, 'otro usuario NO puede guardar a nombre de Facundo (RLS lo rechaza)');

  r := pg_temp.como_socio(c.otro_usuario, format(
    'update public.user_exercise_weights set weight_used = %L where user_id = %L', '999kg', c.facundo));
  perform pg_temp.verificar('4', r.err is not null or r.filas = 0, 'otro usuario NO puede pisar la carga de Facundo (0 filas)');

  perform pg_temp.verificar('4', pg_temp.huella_peso() = v_antes, 'la carga de Facundo quedó intacta (45kg)');
end $$;

-- ── PASO 5 ── Seba re-guarda la rutina: borra y recrea días/ejercicios con ids NUEVOS (mismo
--    exercise_id), exactamente como saveRoutineFull. La carga tiene que seguir y la app tiene
--    que encontrarla para el ejercicio nuevo. Todo se deshace al final (subtransacción).
do $$
declare
  c record; r record;
  v_antes text; v_despues text; v_ids_viejos uuid[]; v_ids_nuevos uuid[]; v_quedan_viejos int;
  v_ejercicios_antes int; v_ejercicios_despues int; v_peso_app text; v_err text;
  v_rutina_antes text; v_rutina_final text; v_re_final int;
begin
  select * into c from pg_temp._ctx;
  v_antes := pg_temp.huella_peso();
  execute format($f$
    select array_agg(re.id), count(*)::int from routine_exercises re
    join routine_days rd on rd.id = re.%I where rd.routine_id = %L
  $f$, c.col_dia, c.routine_id) into v_ids_viejos, v_ejercicios_antes;
  execute format($f$
    select md5(string_agg(to_jsonb(re)::text, ';' order by re.id)) from routine_exercises re
    join routine_days rd on rd.id = re.%I where rd.routine_id = %L
  $f$, c.col_dia, c.routine_id) into v_rutina_antes;

  begin
    -- Copia de lo que Seba tiene en el formulario.
    create temp table _rd_copia on commit drop as select * from routine_days where routine_id = c.routine_id;
    execute format('create temp table _re_copia on commit drop as select re.* from routine_exercises re where re.%I in (select id from _rd_copia)', c.col_dia);
    create temp table _mapa on commit drop as select id as viejo, gen_random_uuid() as nuevo from _rd_copia;

    -- saveRoutineFull: borra todos los días (cascada a routine_exercises)...
    delete from routine_days where routine_id = c.routine_id;
    -- ...y los vuelve a crear con ids nuevos, reusando el exercise_id de cada fila.
    insert into routine_days
      select (jsonb_populate_record(null::routine_days, to_jsonb(d) || jsonb_build_object('id', m.nuevo))).*
      from _rd_copia d join _mapa m on m.viejo = d.id;
    execute format($f$
      insert into routine_exercises
        select (jsonb_populate_record(null::routine_exercises,
                  to_jsonb(e) || jsonb_build_object('id', gen_random_uuid(), %L, m.nuevo))).*
        from _re_copia e join _mapa m on m.viejo = e.%I
    $f$, c.col_dia, c.col_dia);

    execute format($f$
      select array_agg(re.id), count(*)::int from routine_exercises re
      join routine_days rd on rd.id = re.%I where rd.routine_id = %L
    $f$, c.col_dia, c.routine_id) into v_ids_nuevos, v_ejercicios_despues;
    select count(*) into v_quedan_viejos from routine_exercises where id = any(v_ids_viejos);
    v_despues := pg_temp.huella_peso();

    -- Lo que hace la app: para cada ejercicio de la rutina (ids NUEVOS), busca la carga por exercise_id.
    r := pg_temp.como_socio(c.facundo, format($f$
      select w.weight_used from public.routine_exercises re
      join public.user_exercise_weights w on w.exercise_id = re.exercise_id and w.user_id = %L
      where re.id = any(%L::uuid[]) and re.exercise_id = %L limit 1
    $f$, c.facundo, v_ids_nuevos, c.exercise_id));
    v_peso_app := coalesce(r.valor, 'ERROR: ' || r.err);

    raise exception 'ROLLBACK_SIMULACION';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SIMULACION' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    perform pg_temp.log('5', 'RESULTADO', 'ERROR simulando el re-guardado de la rutina (se deshizo igual): ' || v_err);
  end if;
  perform pg_temp.log('5', 'RESULTADO', format('rutina re-guardada: %s ejercicios antes, %s después; ids viejos que quedan: %s',
    v_ejercicios_antes, coalesce(v_ejercicios_despues::text, '-'), coalesce(v_quedan_viejos::text, '-')));
  perform pg_temp.verificar('5', v_ejercicios_despues = v_ejercicios_antes and v_quedan_viejos = 0,
    'la rutina se recreó de verdad con ids NUEVOS (como el panel)');
  perform pg_temp.verificar('5', v_despues = v_antes, 'la carga de Facundo NO se borró al re-guardar la rutina');
  perform pg_temp.verificar('5', v_peso_app = '45kg',
    format('la app la encuentra para el ejercicio re-creado (lee: %s)', coalesce(v_peso_app, '(nada)')));

  -- La simulación se deshizo: la rutina real tiene que estar exactamente igual.
  execute format($f$
    select md5(string_agg(to_jsonb(re)::text, ';' order by re.id)), count(*)::int from routine_exercises re
    join routine_days rd on rd.id = re.%I where rd.routine_id = %L
  $f$, c.col_dia, c.routine_id) into v_rutina_final, v_re_final;
  perform pg_temp.verificar('5', v_rutina_final = v_rutina_antes,
    format('la simulación se deshizo: tu rutina real está intacta (%s ejercicios)', v_re_final));
end $$;

-- ── PASO 6 ── Borrar un ejercicio del catálogo arrastra sus cargas. Con un ejercicio TEMPORAL
--    creado solo para esto, adentro de una subtransacción que se deshace.
do $$
declare c record; r record; v_ex uuid; v_antes int; v_despues int; v_err text; v_existe_despues int;
begin
  select * into c from pg_temp._ctx;
  begin
    insert into exercises (name, muscle_group) values ('ZZ PRUEBA pesos (temporal)', 'Otros') returning id into v_ex;
    r := pg_temp.como_socio(c.facundo, pg_temp.sql_guardar(c.facundo, v_ex, '10kg'));
    select count(*) into v_antes from user_exercise_weights where exercise_id = v_ex;
    delete from exercises where id = v_ex;
    select count(*) into v_despues from user_exercise_weights where exercise_id = v_ex;
    raise exception 'ROLLBACK_SIMULACION';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SIMULACION' then v_err := sqlerrm; end if;
  end;
  if v_err is not null then perform pg_temp.log('6', 'RESULTADO', 'ERROR (se deshizo igual): ' || v_err); end if;
  select count(*) into v_existe_despues from exercises where name = 'ZZ PRUEBA pesos (temporal)';
  perform pg_temp.verificar('6', v_antes = 1 and v_despues = 0,
    format('al borrar el ejercicio, su carga se borró (antes=%s, después=%s)', coalesce(v_antes::text, '-'), coalesce(v_despues::text, '-')));
  perform pg_temp.verificar('6', v_existe_despues = 0, 'el ejercicio temporal no quedó en el catálogo');
end $$;

-- ── PASO 7 ── Sin policy de delete (ni de ALL).
do $$
declare v_pol int; v_cmds text;
begin
  select count(*) filter (where cmd in ('DELETE', 'ALL')), string_agg(cmd, ', ' order by cmd)
    into v_pol, v_cmds
  from pg_policies where schemaname = 'public' and tablename = 'user_exercise_weights';
  perform pg_temp.log('7', 'RESULTADO', 'policies: ' || coalesce(v_cmds, '(ninguna)'));
  perform pg_temp.verificar('7', v_pol = 0 and v_cmds = 'INSERT, SELECT, UPDATE', 'solo select / insert / update propios; sin delete');
end $$;

-- ── LIMPIEZA ──
do $$
declare c record; v_final text;
begin
  select * into c from pg_temp._ctx;
  if c.peso_original is null then
    delete from user_exercise_weights where user_id = c.facundo and exercise_id = c.exercise_id;
  else
    update user_exercise_weights set weight_used = c.peso_original, updated_at = c.updated_original
    where user_id = c.facundo and exercise_id = c.exercise_id;
  end if;
  select weight_used into v_final from user_exercise_weights where user_id = c.facundo and exercise_id = c.exercise_id;
  perform pg_temp.verificar('LIMPIEZA', v_final is not distinct from c.peso_original,
    format('la carga de "%s" quedó como estaba (%s)', c.exercise_name, coalesce(v_final, 'sin carga')));
  perform pg_temp.log('LIMPIEZA', 'NOTA', 'Tu rutina y el catálogo de ejercicios no se modificaron: los pasos 5 y 6 se deshicieron solos.');
end $$;

insert into pg_temp._log(paso, momento, linea)
select 'RESUMEN', '', format('%s chequeos OK, %s FALLA', count(*) filter (where linea like 'OK%'), count(*) filter (where linea like 'FALLA%'))
from pg_temp._log where momento = 'CHEQUEO';

commit;

select paso, momento, linea from pg_temp._log order by n;
