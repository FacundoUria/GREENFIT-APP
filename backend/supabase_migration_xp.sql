-- Ejecutar en el SQL Editor de Supabase CUANDO SE QUIERA activar el sistema
-- de XP/Niveles real (500 XP = 1 nivel). Hasta que esto se corra,
-- src/lib/xpApi.ts detecta que `xp_events` no existe y estima el XP a
-- partir de clases con asistencia real (mismo peso que la regla real, +100
-- por clase) -- el número de nivel no "salta" feo el día que se active esto.
--
-- Se descartó el check-in diario para simplificar. Reglas vigentes:
--   1) Asistencia a clase confirmada (disciplinas grupales)  -> +100 XP (automático, trigger sobre bookings.attended)
--   2) Registrar/superar un PR (Aparatos y Clases)           -> +150 XP (client-side, ProgresoMobileView)
--   3) Completar una Meta personal                           -> +300 XP (pendiente -- ver nota al final)
--   4) Publicar en el Feed/Comunidad (máx 1 por día)         -> +25 XP (client-side, ComunidadMobileView)

create table xp_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  event_type text not null check (event_type in ('asistencia', 'pr', 'meta', 'post')),
  xp_amount int not null,
  -- Referencia informativa (booking/pr/meta/post) -- nullable porque los
  -- PRs hoy son 100% locales (AsyncStorage), no hay una fila real a apuntar.
  reference_id uuid,
  event_date date not null default current_date,
  created_at timestamptz default now()
);

create index idx_xp_events_user on xp_events(user_id);

-- Como máximo 1 fila de tipo 'asistencia' por reserva (protege contra el
-- trigger disparando dos veces por lo que sea) y máximo 1 fila de tipo
-- 'post' por socio por día (el límite de "máx 1 por día" pedido).
create unique index idx_xp_events_asistencia_unica on xp_events(reference_id) where event_type = 'asistencia';
create unique index idx_xp_events_post_por_dia on xp_events(user_id, event_date) where event_type = 'post';

alter table xp_events enable row level security;

create policy "xp_events_select_own" on xp_events
  for select using (auth.uid() = user_id);
-- El evento 'asistencia' NO es insertable por el cliente -- solo lo crea el
-- trigger de abajo (corre security definer, bypasea esta policy). Los otros
-- tres tipos sí los inserta el propio socio activo.
create policy "xp_events_insert_own" on xp_events
  for insert with check (
    auth.uid() = user_id
    and public.is_active_socio()
    and event_type in ('pr', 'meta', 'post')
  );

-- ============================================================
-- +100 XP automático al confirmarse asistencia (solo disciplinas grupales,
-- kind='credits' -- mismo criterio que ya usa community_ranking_mes():
-- Musculación/Aparatos son pase libre y no "reservan" una clase puntual).
-- Corre pase lo que pase quién marcó `attended` (el admin, desde el panel
-- web) -- un trigger es la única forma correcta de capturar esto, porque el
-- socio puede no tener la PWA abierta en el momento exacto.
-- ============================================================

create or replace function public.award_xp_asistencia()
returns trigger as $$
declare
  v_kind text;
begin
  select d.kind into v_kind
  from classes c
  join disciplines d on d.id = c.discipline_id
  where c.id = new.class_id;

  if v_kind = 'credits' and new.attended = true and (old.attended is distinct from true) then
    insert into xp_events (user_id, event_type, xp_amount, reference_id)
    values (new.user_id, 'asistencia', 100, new.id)
    on conflict do nothing;
  elsif new.attended is distinct from true and old.attended = true then
    -- Si el admin corrige una asistencia mal marcada, se revierte el XP.
    delete from xp_events where reference_id = new.id and event_type = 'asistencia';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_award_xp_asistencia
  after update of attended on bookings
  for each row execute procedure public.award_xp_asistencia();

-- ============================================================
-- Pendiente: "Completar una Meta personal" (+300 XP). Todavía no existe
-- ninguna tabla/UI de "Metas" en la app -- event_type='meta' ya está
-- habilitado en xp_events para cuando se defina esa mecánica (cómo se crea
-- una meta, quién confirma que se cumplió, límites anti-abuso dado que es
-- el premio más grande de los 4). No se creó ninguna tabla `metas` en esta
-- migración a propósito, para no adivinar un modelo que después haya que
-- migrar de nuevo.
