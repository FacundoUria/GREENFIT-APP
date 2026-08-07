-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor)
--
-- Planes/Packs/Combos 100% dinámicos multi-disciplina -- hasta ahora un
-- pack solo podía tener UNA disciplina (`packs.discipline_id` not null).
-- Esta migración reemplaza ese modelo por uno que soporta combos reales
-- (ej. "8 créditos Boxeo + 8 créditos CrossFit") y una membresía de
-- Aparatos con vigencia en días CONFIGURABLE por pack (no fija), activable
-- con un switch + un número. No se tocan las columnas viejas
-- (discipline_id/credits/duration_days quedan sin uso, no se borran -- no
-- hay forma de saber desde acá si algún pack viejo en producción todavía
-- las necesita).
--
-- ============================================================
-- 1) packs: `creditos` (jsonb) reemplaza la relación 1 disciplina <-> 1
--    pack por una lista [{discipline_id, credits}, ...] de 0 a N filas.
--    `incluye_aparatos` + `dias_vigencia` reemplazan a duration_days --
--    dias_vigencia es la cantidad EXACTA de días que se le suma al socio
--    (30 = 1 mes, 60 = 2 meses, 90 = 3 meses, o cualquier otro valor que
--    cargue Seba), nunca un número fijo hardcodeado acá ni en la RPC.
-- ============================================================
alter table packs
  alter column discipline_id drop not null,
  add column if not exists incluye_aparatos boolean not null default false,
  add column if not exists dias_vigencia int,
  add column if not exists creditos jsonb not null default '[]'::jsonb;

alter table packs
  add constraint packs_dias_vigencia_check
    check (incluye_aparatos = false or (dias_vigencia is not null and dias_vigencia > 0));

comment on column packs.creditos is
  'Array [{"discipline_id": uuid, "credits": int}, ...] -- créditos que se acreditan por disciplina al aprobarse una compra de este pack. Reemplaza a discipline_id/credits (columnas legacy, sin uso en packs nuevos).';
comment on column packs.incluye_aparatos is
  'Si true, aprobar una compra de este pack extiende dias_vigencia días la membresía de Aparatos del socio (ver mp_process_payment).';
comment on column packs.dias_vigencia is
  'Cantidad exacta de días a extender la membresía de Aparatos -- obligatorio (>0) cuando incluye_aparatos=true, ignorado si es false. Reemplaza a duration_days (columna legacy, sin uso en packs nuevos).';

-- ============================================================
-- 2) mp_process_payment: firma nueva -- p_creditos (jsonb, un elemento por
--    disciplina del combo) + p_incluye_aparatos + p_dias_vigencia +
--    p_aparatos_discipline_id (lo resuelve la Edge Function, que ya tiene
--    `disciplines` a mano; evita depender acá de un nombre/kind
--    hardcodeado en SQL). Reemplaza la firma anterior (un solo par
--    disciplina/cantidad + duration_days fijo) -- "create or replace" con
--    parámetros distintos requiere borrar la versión vieja primero.
-- ============================================================
drop function if exists public.mp_process_payment(uuid, uuid, uuid, int, int, numeric, text, text, text);
drop function if exists public.mp_process_payment(uuid, uuid, jsonb, boolean, uuid, numeric, text, text, text);

create or replace function public.mp_process_payment(
  p_user_id uuid,
  p_pack_id uuid,
  p_creditos jsonb,               -- [{"discipline_id": uuid, "credits": int}, ...]
  p_incluye_aparatos boolean,
  p_dias_vigencia int,            -- null/ignorado si p_incluye_aparatos es false
  p_aparatos_discipline_id uuid,  -- null si p_incluye_aparatos es false
  p_amount numeric,
  p_paquete text,
  p_mp_payment_id text,
  p_mp_status text
)
returns table (credito_otorgado boolean)
language plpgsql
security definer
as $$
declare
  v_estado text;
  v_estado_previo text;
  v_otorgar boolean := false;
  v_credito jsonb;
  v_discipline_id uuid;
  v_credits int;
begin
  v_estado := case
    when p_mp_status = 'approved' then 'pagado'
    when p_mp_status in ('pending', 'in_process', 'authorized') then 'pendiente'
    else 'anulado'
  end;

  insert into pagos_socio (
    user_id, paquete, monto, metodo_pago, estado, origen, mercado_pago_payment_id,
    periodo_desde, periodo_hasta
  )
  values (
    p_user_id, p_paquete, p_amount, 'mercado_pago', v_estado, 'mercado_pago', p_mp_payment_id,
    case when p_incluye_aparatos then current_date else null end,
    case when p_incluye_aparatos then current_date + (coalesce(p_dias_vigencia, 0) || ' days')::interval else null end
  )
  on conflict (mercado_pago_payment_id) do nothing;

  if found then
    -- Fila nueva -- MP puede notificar directo en 'approved' sin pasar
    -- antes por 'pending' (pago con tarjeta, aprobación instantánea).
    v_otorgar := (v_estado = 'pagado');
  else
    -- Ya existía una notificación previa para este payment_id -- se
    -- bloquea ESA fila puntual antes de decidir (serializa a cualquier
    -- otra llamada concurrente para el mismo pago).
    select estado into v_estado_previo from pagos_socio where mercado_pago_payment_id = p_mp_payment_id for update;

    if v_estado_previo is distinct from 'pagado' then
      update pagos_socio set estado = v_estado where mercado_pago_payment_id = p_mp_payment_id;
    end if;

    v_otorgar := (v_estado = 'pagado') and (v_estado_previo is distinct from 'pagado');
  end if;

  if v_otorgar then
    -- Un combo puede incluir N disciplinas -- una fila de user_credits por
    -- cada una, sumando sobre el balance previo de ESA disciplina puntual
    -- (igual que el modelo de un solo crédito de antes, ahora en loop).
    for v_credito in select * from jsonb_array_elements(coalesce(p_creditos, '[]'::jsonb))
    loop
      v_discipline_id := (v_credito->>'discipline_id')::uuid;
      v_credits := (v_credito->>'credits')::int;
      if v_discipline_id is not null and v_credits is not null and v_credits > 0 then
        insert into user_credits (user_id, pack_id, discipline_id, remaining_credits, expires_at)
        select
          p_user_id, p_pack_id, v_discipline_id,
          coalesce(
            (select remaining_credits from user_credits
             where user_id = p_user_id and discipline_id = v_discipline_id
             order by created_at desc limit 1),
            0
          ) + v_credits,
          now() + interval '30 days';
      end if;
    end loop;

    if p_incluye_aparatos and p_aparatos_discipline_id is not null and p_dias_vigencia is not null and p_dias_vigencia > 0 then
      insert into user_credits (user_id, pack_id, discipline_id, remaining_credits, expires_at)
      select
        p_user_id, p_pack_id, p_aparatos_discipline_id, null,
        greatest(
          coalesce(
            (select expires_at from user_credits
             where user_id = p_user_id and discipline_id = p_aparatos_discipline_id
             order by created_at desc limit 1),
            now()
          ),
          now()
        ) + (p_dias_vigencia || ' days')::interval;
    end if;
  end if;

  return query select v_otorgar;
end;
$$;

-- Verificación opcional (correr aparte, service role -- bypasea RLS):
--   select id, name, price, incluye_aparatos, dias_vigencia, creditos, is_active from packs order by created_at desc limit 20;
