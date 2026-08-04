-- Ejecutar en el SQL Editor de Supabase CUANDO SE QUIERA activar el sistema
-- de XP/Niveles real (500 XP = 1 nivel). Hasta que esto se corra,
-- src/lib/xpApi.ts detecta que `xp_events` no existe y estima el XP a
-- partir de clases con asistencia real (mismo peso que la regla real, +100
-- por clase) -- el número de nivel no "salta" feo el día que se active esto.
--
-- Se descartó el check-in diario para simplificar. Reglas vigentes:
--   1) Asistencia a clase confirmada (disciplinas grupales)  -> +100 XP (automático, trigger sobre bookings.attended)
--   2) Registrar/superar un PR (Aparatos y Clases)           -> +150 XP (client-side, ProgresoMobileView)
--   3) Completar una Meta personal                           -> +300 XP (automático, trigger sobre metas_personales.completed_at)
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
-- trigger disparando dos veces por lo que sea), 1 fila de tipo 'meta' por
-- meta completada, y máximo 1 fila de tipo 'post' por socio por día (el
-- límite de "máx 1 por día" pedido).
create unique index idx_xp_events_asistencia_unica on xp_events(reference_id) where event_type = 'asistencia';
create unique index idx_xp_events_meta_unica on xp_events(reference_id) where event_type = 'meta';
create unique index idx_xp_events_post_por_dia on xp_events(user_id, event_date) where event_type = 'post';

alter table xp_events enable row level security;

create policy "xp_events_select_own" on xp_events
  for select using (auth.uid() = user_id);
-- 'asistencia' y 'meta' NO son insertables por el cliente -- los crean
-- únicamente los triggers de abajo (corren security definer, bypasean esta
-- policy), porque ambos tienen una regla de negocio que hay que validar
-- server-side (asistencia: viene de otra app; meta: los 7 días mínimos).
-- 'pr' y 'post' sí los inserta el propio socio activo directo.
create policy "xp_events_insert_own" on xp_events
  for insert with check (
    auth.uid() = user_id
    and public.is_active_socio()
    and event_type in ('pr', 'post')
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
-- METAS PERSONALES (+300 XP al completarlas)
--
-- Autogestionada por el socio, con 2 frenos anti-abuso simples (decisión
-- del usuario, sin aprobación de admin ni condición numérica):
--   - Solo 1 meta activa (sin completar) a la vez por socio.
--   - No se puede completar antes de 7 días de creada.
-- Ambos frenos se validan server-side (índice único + trigger), no solo en
-- la app, para que no sean saltables editando el request a mano.
-- ============================================================

create table metas_personales (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  texto text not null,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Solo una meta activa (sin completar) por socio.
create unique index idx_metas_personales_activa_unica on metas_personales(user_id) where completed_at is null;

alter table metas_personales enable row level security;

create policy "metas_personales_select_own" on metas_personales
  for select using (auth.uid() = user_id);
create policy "metas_personales_insert_own" on metas_personales
  for insert with check (auth.uid() = user_id and public.is_active_socio());
-- "Completar" es un update de completed_at -- la regla de los 7 días la
-- exige el trigger de abajo, no esta policy (acá solo se valida que sea la
-- propia fila del socio).
create policy "metas_personales_update_own" on metas_personales
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "metas_personales_delete_own" on metas_personales
  for delete using (auth.uid() = user_id);

create or replace function public.completar_meta_personal()
returns trigger as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    if new.completed_at < old.created_at + interval '7 days' then
      raise exception 'Todavía no pasaron 7 días desde que creaste esta meta.';
    end if;
    insert into xp_events (user_id, event_type, xp_amount, reference_id)
    values (new.user_id, 'meta', 300, new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_completar_meta_personal
  before update of completed_at on metas_personales
  for each row execute procedure public.completar_meta_personal();
