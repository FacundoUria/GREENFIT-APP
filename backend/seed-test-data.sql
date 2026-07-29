-- ============================================================
-- GREEN FIT — Datos de prueba (socio + créditos + clases de hoy)
-- No crea usuarios de Auth por SQL (el hasheo de password lo maneja
-- Supabase Auth, no se puede simular bien desde acá). Pasos:
--
--   1. Creá el socio de prueba desde la app ("Gestión de socios" > "Nuevo
--      socio"), o desde el SQL Editor con la Edge Function admin-create-socio.
--   2. Ajustá SOCIO_DNI acá abajo al DNI real que usaste.
--   3. Corré este script completo en el SQL Editor de Supabase. Es seguro
--      correrlo varias veces — no duplica clases ni el pack de prueba.
-- ============================================================

do $$
declare
  v_socio_dni text := '44537978'; -- cambiá esto al DNI real del socio de prueba
  v_user_id uuid;
  v_discipline_id uuid;
  v_pack_id uuid;
begin
  select id into v_user_id from profiles where dni = v_socio_dni;
  if v_user_id is null then
    raise exception 'No encontré ningún profile con DNI %. Creá primero ese socio.', v_socio_dni;
  end if;

  select id into v_discipline_id from disciplines where name = 'Boxeo';
  if v_discipline_id is null then
    raise exception 'No existe la disciplina "Boxeo" todavía.';
  end if;

  -- Pack de prueba (se crea una sola vez, se reutiliza en corridas siguientes).
  select id into v_pack_id from packs where name = 'Pack 12 clases (prueba)';
  if v_pack_id is null then
    insert into packs (name, discipline_id, credits, price)
    values ('Pack 12 clases (prueba)', v_discipline_id, 12, 5000)
    returning id into v_pack_id;
  end if;

  -- Le carga un lote nuevo de créditos completo (12/12) al socio de prueba.
  insert into user_credits (user_id, pack_id, discipline_id, remaining_credits)
  values (v_user_id, v_pack_id, v_discipline_id, 12);

  raise notice 'Créditos cargados para DNI % (user_id=%)', v_socio_dni, v_user_id;
end $$;

-- Clases recurrentes de prueba — todos los días (0-6) para que siempre
-- aparezcan sin importar qué día corras esto. Con guard por título+horario.
insert into classes (title, discipline_id, capacity, days_of_week, start_time, end_time)
select v.title, d.id, v.capacity, '{0,1,2,3,4,5,6}', v.start_time, v.end_time
from (
  values
    ('Boxeo', 10, time '18:00', time '19:00'),
    ('Kickboxing', 12, time '19:00', time '20:00'),
    ('CrossFit', 8, time '20:00', time '21:00')
) as v(title, capacity, start_time, end_time)
join disciplines d on d.name = v.title
where not exists (
  select 1 from classes c where c.title = v.title and c.start_time = v.start_time
);
