-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor)
--
-- Regla de negocio: cancelar con más de 2 horas de anticipación al inicio
-- de la clase devuelve el crédito; cancelar con menos de 2 horas (o con la
-- clase ya empezada) borra la reserva pero NO reintegra el crédito. Antes,
-- cancel_booking() siempre devolvía el crédito sin mirar la hora.
--
-- classes.start_time es una hora del día (sin fecha, es una plantilla
-- semanal recurrente) — se combina acá con booking_date y se interpreta en
-- horario de Mendoza (America/Argentina/Mendoza, sin horario de verano en
-- Argentina desde 2009, así que no hay ambigüedad de DST) para comparar
-- contra el instante real `now()`. Mismo criterio que combineDateAndTime()
-- en src/lib/classesApi.ts del lado del cliente.
--
-- Cambia el tipo de retorno de void a boolean: true = se reintegró el
-- crédito, false = se canceló sin reintegro. El cliente (BookingScreen /
-- HomeScreen) lo usa para mostrarle al socio el mensaje correcto.

drop function if exists public.cancel_booking(uuid, date, text);

create or replace function public.cancel_booking(p_class_id uuid, p_booking_date date, p_reason text default null)
returns boolean
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_discipline_id uuid;
  v_start_time time;
  v_credit_id uuid;
  v_class_start timestamptz;
  v_dentro_del_limite boolean;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select discipline_id, start_time into v_discipline_id, v_start_time
  from classes where id = p_class_id;

  v_class_start := (p_booking_date::text || ' ' || v_start_time::text)::timestamp
    at time zone 'America/Argentina/Mendoza';
  v_dentro_del_limite := now() <= (v_class_start - interval '2 hours');

  delete from bookings
  where user_id = v_user_id and class_id = p_class_id and booking_date = p_booking_date;
  if not found then
    raise exception 'No tenías una reserva en esta clase';
  end if;

  insert into booking_cancellations (user_id, class_id, booking_date, reason)
  values (v_user_id, p_class_id, p_booking_date, nullif(trim(p_reason), ''));

  if v_dentro_del_limite then
    select id into v_credit_id
    from user_credits
    where user_id = v_user_id and discipline_id = v_discipline_id
    order by created_at desc
    limit 1
    for update;

    if v_credit_id is not null then
      update user_credits set remaining_credits = remaining_credits + 1 where id = v_credit_id;
    end if;
  end if;

  return v_dentro_del_limite;
end;
$$;

grant execute on function public.cancel_booking(uuid, date, text) to authenticated;
