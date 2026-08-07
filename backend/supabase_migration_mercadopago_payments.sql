-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor)
--
-- Integración de Mercado Pago (Checkout Pro) -- soporte de base de datos
-- para las Edge Functions create-payment-preference/mp-webhook
-- (supabase/functions/, este mismo repo).
--
-- `pagos_socio` (creada en "PAGINA SUPABASE"/supabase_migration_ficha360.sql,
-- el otro repo) YA tenía las columnas pensadas para esto desde esa ronda
-- ("Listo para la futura automatización"): metodo_pago admite
-- 'mercado_pago', origen admite 'mercado_pago', y ya existe
-- mercado_pago_payment_id. No hace falta ninguna columna nueva ahí -- solo
-- un índice único para poder procesar el webhook de forma idempotente.

-- ============================================================
-- 1) Idempotencia real: dos notificaciones del mismo pago (MP reintenta
--    webhooks agresivamente, y a veces manda el mismo evento más de una
--    vez) nunca deben generar dos filas ni acreditar el crédito dos veces.
-- ============================================================
create unique index if not exists idx_pagos_socio_mp_payment_id
  on pagos_socio (mercado_pago_payment_id)
  where mercado_pago_payment_id is not null;

-- ============================================================
-- 2) RPC atómica que procesa un pago de Mercado Pago -- security definer
--    porque quien la llama es la Edge Function con Service Role (bypasea
--    RLS a propósito, mismo patrón que admin_otorgar_checkin_musculacion
--    en el otro repo), nunca el cliente directo.
--
--    Mapea el status real de MP (consultado por la Edge Function contra
--    /v1/payments/{id}, NUNCA se confía en el body del webhook) al
--    vocabulario ya usado por pagos_socio.estado:
--      approved                    -> 'pagado'
--      pending / in_process /
--      authorized                  -> 'pendiente'
--      cualquier otro (rejected,
--      cancelled, refunded, etc.)  -> 'anulado'
--
--    Los créditos/vencimiento SOLO se otorgan en la transición real hacia
--    'pagado' (nunca de nuevo si ya estaba 'pagado' antes) -- así una
--    notificación repetida de un pago ya aprobado no duplica el crédito.
--    Serializado contra llegadas casi simultáneas del mismo payment_id:
--    el primer intento de INSERT gana la fila; si ya existía, se bloquea
--    esa fila puntual con `for update` antes de decidir si corresponde
--    otorgar, así una segunda notificación concurrente para EL MISMO pago
--    espera a que la primera termine en vez de correr en paralelo.
-- ============================================================
create or replace function public.mp_process_payment(
  p_user_id uuid,
  p_pack_id uuid,
  p_discipline_id uuid,
  p_credits int,        -- no nulo si el pack es de créditos
  p_duration_days int,  -- no nulo si el pack es de membresía (Aparatos, etc.)
  p_amount numeric,
  p_paquete text,        -- nombre del pack, para el historial (pagos_socio.paquete)
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
    case when p_duration_days is not null then current_date else null end,
    case when p_duration_days is not null then current_date + (p_duration_days || ' days')::interval else null end
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
    if p_credits is not null then
      insert into user_credits (user_id, pack_id, discipline_id, remaining_credits, expires_at)
      select
        p_user_id, p_pack_id, p_discipline_id,
        coalesce(
          (select remaining_credits from user_credits
           where user_id = p_user_id and discipline_id = p_discipline_id
           order by created_at desc limit 1),
          0
        ) + p_credits,
        now() + interval '30 days';
    elsif p_duration_days is not null then
      insert into user_credits (user_id, pack_id, discipline_id, remaining_credits, expires_at)
      select
        p_user_id, p_pack_id, p_discipline_id, null,
        greatest(
          coalesce(
            (select expires_at from user_credits
             where user_id = p_user_id and discipline_id = p_discipline_id
             order by created_at desc limit 1),
            now()
          ),
          now()
        ) + (p_duration_days || ' days')::interval;
    end if;
  end if;

  return query select v_otorgar;
end;
$$;

-- Verificación opcional (correr aparte, service role -- bypasea RLS):
--   select * from pagos_socio where origen = 'mercado_pago' order by created_at desc limit 20;
