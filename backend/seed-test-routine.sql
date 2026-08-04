-- ============================================================
-- GREEN FIT — Rutina de prueba completa para probar "Mi Rutina"
-- Mismo criterio que seed-test-data.sql: no crea el socio (tiene que existir
-- ya con ese DNI), busca su profile por DNI y es seguro correrlo varias
-- veces -- todo está guardado con "if not exists"/lookup previo, no
-- duplica filas en corridas siguientes.
--
-- Columnas de routine_exercises.routine_day_id: inferidas por convención
-- del resto del schema (todo FK es <tabla>_id) -- si la columna real se
-- llama distinto, Postgres tira el error de columna inexistente apenas
-- corras esto y se ajusta en 1 línea.
-- ============================================================

do $$
declare
  v_socio_dni text := '44537978';
  v_user_id uuid;
  v_routine_id uuid;
  v_day1_id uuid;
  v_day2_id uuid;
  v_day3_id uuid;
  v_ex_sentadilla uuid;
  v_ex_pressbanca uuid;
  v_ex_pesomuerto uuid;
  v_ex_dominadas uuid;
  v_ex_plancha uuid;
  v_ex_zancadas uuid;
  v_ex_remo uuid;
  v_ex_pressmilitar uuid;
begin
  select id into v_user_id from profiles where dni = v_socio_dni;
  if v_user_id is null then
    raise exception 'No encontré ningún profile con DNI %. Creá primero ese socio (ver seed-test-data.sql).', v_socio_dni;
  end if;

  -- Ejercicios reusables -- se crean una sola vez (guard por nombre), quedan
  -- disponibles también para rutinas de otros socios a futuro.
  insert into exercises (name, muscle_group, description)
  select v.name, v.muscle_group, v.description
  from (
    values
      ('Sentadilla', 'Piernas', 'Sentadilla con barra, profundidad completa.'),
      ('Press de Banca', 'Pecho', 'Press plano con barra.'),
      ('Peso Muerto', 'Espalda', 'Peso muerto convencional.'),
      ('Dominadas', 'Espalda', 'Dominadas pronas, rango completo.'),
      ('Plancha', 'Core', 'Plancha isométrica, abdomen contraído.'),
      ('Zancadas', 'Piernas', 'Zancadas alternadas con mancuernas.'),
      ('Remo con Barra', 'Espalda', 'Remo inclinado con barra.'),
      ('Press Militar', 'Hombros', 'Press militar de pie con barra.')
  ) as v(name, muscle_group, description)
  where not exists (select 1 from exercises e where e.name = v.name);

  select id into v_ex_sentadilla from exercises where name = 'Sentadilla';
  select id into v_ex_pressbanca from exercises where name = 'Press de Banca';
  select id into v_ex_pesomuerto from exercises where name = 'Peso Muerto';
  select id into v_ex_dominadas from exercises where name = 'Dominadas';
  select id into v_ex_plancha from exercises where name = 'Plancha';
  select id into v_ex_zancadas from exercises where name = 'Zancadas';
  select id into v_ex_remo from exercises where name = 'Remo con Barra';
  select id into v_ex_pressmilitar from exercises where name = 'Press Militar';

  -- Rutina de prueba (guard por título -- no duplica si ya se corrió antes).
  select id into v_routine_id from routines where user_id = v_user_id and title = 'Rutina de Prueba (demo)';
  if v_routine_id is null then
    insert into routines (user_id, title, coach_name, notes)
    values (v_user_id, 'Rutina de Prueba (demo)', 'Seba', 'Rutina generada para probar la pantalla Mi Rutina.')
    returning id into v_routine_id;
  end if;

  select id into v_day1_id from routine_days where routine_id = v_routine_id and title = 'Día 1 - Tren Inferior';
  if v_day1_id is null then
    insert into routine_days (routine_id, title, order_index)
    values (v_routine_id, 'Día 1 - Tren Inferior', 1)
    returning id into v_day1_id;
  end if;

  select id into v_day2_id from routine_days where routine_id = v_routine_id and title = 'Día 2 - Tren Superior';
  if v_day2_id is null then
    insert into routine_days (routine_id, title, order_index)
    values (v_routine_id, 'Día 2 - Tren Superior', 2)
    returning id into v_day2_id;
  end if;

  select id into v_day3_id from routine_days where routine_id = v_routine_id and title = 'Día 3 - Full Body';
  if v_day3_id is null then
    insert into routine_days (routine_id, title, order_index)
    values (v_routine_id, 'Día 3 - Full Body', 3)
    returning id into v_day3_id;
  end if;

  -- Ejercicios por día, con series/reps/descanso/kilos sugeridos (guard por
  -- día+ejercicio+orden -- no duplica en corridas siguientes).
  insert into routine_exercises (routine_day_id, exercise_id, sets, reps, rest_seconds, weight_suggestion, order_index)
  select v.routine_day_id, v.exercise_id, v.sets, v.reps, v.rest_seconds, v.weight_suggestion, v.order_index
  from (
    values
      (v_day1_id, v_ex_sentadilla, 4, '8-10', 90, '60kg', 1),
      (v_day1_id, v_ex_pesomuerto, 3, '6-8', 120, '80kg', 2),
      (v_day1_id, v_ex_zancadas, 3, '12 c/pierna', 60, '2x14kg', 3),
      (v_day2_id, v_ex_pressbanca, 4, '8-10', 90, '50kg', 1),
      (v_day2_id, v_ex_dominadas, 4, 'Al fallo', 90, 'Peso corporal', 2),
      (v_day2_id, v_ex_remo, 3, '10-12', 75, '40kg', 3),
      (v_day2_id, v_ex_pressmilitar, 3, '8-10', 75, '30kg', 4),
      (v_day3_id, v_ex_sentadilla, 3, '10', 60, '50kg', 1),
      (v_day3_id, v_ex_pressbanca, 3, '10', 60, '40kg', 2),
      (v_day3_id, v_ex_plancha, 3, '45 seg', 45, null, 3)
  ) as v(routine_day_id, exercise_id, sets, reps, rest_seconds, weight_suggestion, order_index)
  where not exists (
    select 1 from routine_exercises re
    where re.routine_day_id = v.routine_day_id and re.exercise_id = v.exercise_id and re.order_index = v.order_index
  );

  raise notice 'Rutina de prueba cargada para DNI % (user_id=%, routine_id=%)', v_socio_dni, v_user_id, v_routine_id;
end $$;

-- Opcional: deja el primer ejercicio del Día 1 marcado como "completado
-- hoy", así se ve también el check tildado sin tener que tocarlo a mano.
do $$
declare
  v_socio_dni text := '44537978';
  v_user_id uuid;
  v_routine_exercise_id uuid;
begin
  select id into v_user_id from profiles where dni = v_socio_dni;

  select re.id into v_routine_exercise_id
  from routine_exercises re
  join routine_days rd on rd.id = re.routine_day_id
  join routines r on r.id = rd.routine_id
  where r.user_id = v_user_id and rd.title = 'Día 1 - Tren Inferior'
  order by re.order_index asc
  limit 1;

  if v_routine_exercise_id is not null then
    insert into routine_completions (user_id, routine_exercise_id, completed_date)
    values (v_user_id, v_routine_exercise_id, current_date)
    on conflict do nothing;
  end if;
end $$;
