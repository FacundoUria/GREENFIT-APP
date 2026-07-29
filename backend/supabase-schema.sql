-- ============================================================
-- GREEN FIT — Schema para Supabase (Postgres + Auth + RLS)
-- Refleja el estado ACTUAL de la base en Supabase (ver diagrama del proyecto).
-- Pegar y correr entero en el SQL Editor de Supabase.
-- ============================================================

-- ── EXTENSIONES ────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── PROFILES ────────────────────────────────────────────────
-- No creamos una tabla "users" propia: Supabase ya tiene auth.users.
-- "profiles" extiende auth.users con lo que a nosotros nos importa (rol, nombre, email).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  dni text unique,
  phone text,
  role text not null default 'socio' check (role in ('socio', 'admin')),
  -- Datos de ficha del socio (editables por el propio socio desde Perfil).
  emergency_contact_name text,
  emergency_contact_phone text,
  medical_notes text,
  created_at timestamptz default now()
);

-- Trigger: cuando se crea un auth.users (hoy, únicamente vía la Edge Function
-- admin-create-socio), le creamos el profile solo. dni/phone/full_name salen
-- del user_metadata que manda esa función. El role NUNCA sale de metadata
-- a propósito -- si el trigger confiara en un campo que pone quien crea el
-- usuario, cualquier llamada de creación de cuenta podría auto-asignarse
-- 'admin'. Todo profile nuevo nace 'socio'; el rol admin se asigna a mano
-- con un UPDATE desde el SQL Editor.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, dni, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', 'Nuevo socio'),
    new.raw_user_meta_data->>'dni',
    new.raw_user_meta_data->>'phone',
    'socio'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── DISCIPLINES ─────────────────────────────────────────────
-- Boxeo, Kickboxing, CrossFit son 'credits' (consumen créditos por clase
-- reservada). Aparatos es 'membership': el socio paga un mes libre, no
-- reserva turno ni gasta créditos — solo tiene una vigencia (expires_at
-- en user_credits) que el admin puede ver.
create table disciplines (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,        -- Boxeo, Kickboxing, CrossFit, Aparatos
  kind text not null default 'credits' check (kind in ('credits', 'membership')),
  created_at timestamptz default now()
);

-- ── PACKS ───────────────────────────────────────────────────
-- Un pack pertenece a una única disciplina. `credits` se usa para packs de
-- disciplinas 'credits' (ej: 12 clases de Boxeo); `duration_days` para
-- packs de disciplinas 'membership' (ej: 30 días de Aparatos).
create table packs (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,        -- "Pack 12 clases de Boxeo" / "Mes libre Aparatos"
  discipline_id uuid not null references disciplines(id),
  credits int,                      -- null si la disciplina es 'membership'
  duration_days int,                -- null si la disciplina es 'credits'
  price numeric not null,
  created_at timestamptz default now()
);

-- ── USER_CREDITS (balance de un socio para una disciplina puntual) ──
-- Un socio puede tener un balance por cada disciplina en simultáneo
-- (ej: 5 créditos de Boxeo Y una membresía de Aparatos vigente).
-- 'credits': se usa remaining_credits, expires_at queda null.
-- 'membership': se usa expires_at, remaining_credits queda null.
create table user_credits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  pack_id uuid not null references packs(id),
  discipline_id uuid not null references disciplines(id),
  remaining_credits int,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create index idx_user_credits_user_discipline on user_credits(user_id, discipline_id, created_at desc);

-- ── CREDIT_TRANSACTIONS (historial de cargas/asignaciones de pack) ──
-- Una fila por cada vez que un admin le asigna un pack a un socio.
-- user_credits guarda el balance actual; esta tabla es el historial
-- de auditoría de esas cargas (quién, qué pack, cuándo).
create table credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  pack_id uuid not null references packs(id),
  discipline_id uuid not null references disciplines(id),
  credits_added int,
  expires_at timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz default now()
);

create index idx_credit_transactions_user on credit_transactions(user_id, created_at desc);

-- ── CLASSES (turno concreto: título, horario, capacidad) ────
-- Solo existen clases para disciplinas 'credits' — Aparatos nunca
-- tiene turnos, es acceso libre mientras la membresía esté vigente.
-- Plantilla recurrente semanal: NO es un turno puntual. `start_time`/`end_time`
-- son horas del día (sin fecha) y `days_of_week` dice qué días de la semana
-- se repite (0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb — mismo criterio
-- que Date.getDay() en JS, para no tener que traducir en el cliente).
create table classes (
  id uuid primary key default uuid_generate_v4(),
  title text not null,              -- Boxeo, Kickboxing, CrossFit
  discipline_id uuid not null references disciplines(id),
  instructor text,
  location text,
  capacity int not null,
  days_of_week integer[] not null default '{}',
  start_time time not null,
  end_time time,
  created_at timestamptz default now()
);

-- ── BOOKINGS ────────────────────────────────────────────────
-- Como `classes` ahora es una plantilla recurrente, una reserva puntual se
-- identifica por class_id + booking_date (la ocurrencia exacta reservada),
-- no solo por class_id.
create table bookings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  class_id uuid not null references classes(id),
  booking_date date not null,
  attended boolean not null default false,
  created_at timestamptz default now(),
  unique (user_id, class_id, booking_date) -- evita doble reserva de la misma ocurrencia
);

create index idx_bookings_class on bookings(class_id);

-- ============================================================
-- ROW LEVEL SECURITY — sin esto, la anon key expone todo.
-- ============================================================

alter table profiles enable row level security;
alter table disciplines enable row level security;
alter table packs enable row level security;
alter table user_credits enable row level security;
alter table credit_transactions enable row level security;
alter table classes enable row level security;
alter table bookings enable row level security;

-- Helper: ¿el usuario logueado es admin?
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- PROFILES: cada uno ve/edita el suyo, el admin ve todos
create policy "profiles_select_own_or_admin" on profiles
  for select using (auth.uid() = id or public.is_admin());
create policy "profiles_update_own_or_admin" on profiles
  for update using (auth.uid() = id or public.is_admin());

-- DISCIPLINES: catálogo público de solo lectura para logueados, solo admin edita
create policy "disciplines_select_all" on disciplines for select using (auth.role() = 'authenticated');
create policy "disciplines_admin_write" on disciplines for all using (public.is_admin());

-- PACKS: catálogo público de solo lectura para logueados, solo admin edita
create policy "packs_select_all" on packs for select using (auth.role() = 'authenticated');
create policy "packs_admin_write" on packs for all using (public.is_admin());

-- CLASSES: catálogo público de solo lectura para logueados, solo admin edita
create policy "classes_select_all" on classes for select using (auth.role() = 'authenticated');
create policy "classes_admin_write" on classes for all using (public.is_admin());

-- USER_CREDITS: cada uno ve los suyos, solo admin escribe (carga/renueva créditos)
create policy "user_credits_select_own_or_admin" on user_credits
  for select using (auth.uid() = user_id or public.is_admin());
create policy "user_credits_admin_write" on user_credits
  for all using (public.is_admin());

-- CREDIT_TRANSACTIONS: cada uno ve las suyas, solo admin inserta (es el historial de cargas)
create policy "credit_transactions_select_own_or_admin" on credit_transactions
  for select using (auth.uid() = user_id or public.is_admin());
create policy "credit_transactions_admin_insert" on credit_transactions
  for insert with check (public.is_admin());

-- BOOKINGS: cada uno gestiona las suyas, admin ve/gestiona todas
create policy "bookings_select_own_or_admin" on bookings
  for select using (auth.uid() = user_id or public.is_admin());
create policy "bookings_insert_own" on bookings
  for insert with check (auth.uid() = user_id);
create policy "bookings_delete_own_or_admin" on bookings
  for delete using (auth.uid() = user_id or public.is_admin());
-- Solo el admin marca asistencia (columna `attended`) — el socio no puede
-- auto-marcarse presente.
create policy "bookings_update_admin" on bookings
  for update using (public.is_admin());

-- ============================================================
-- RESERVAS — funciones atómicas (RPC)
-- El cliente no puede tocar remaining_credits directamente (solo admin,
-- ver policy user_credits_admin_write). Reservar/cancelar pasa por estas
-- funciones security definer para que el chequeo de cupo/créditos y el
-- descuento de crédito ocurran en una sola transacción, sin condiciones
-- de carrera entre dos reservas simultáneas.
-- ============================================================

-- Firmas viejas (classes ya no tiene turnos puntuales, todo pasa por
-- class_id + booking_date) — hay que dropearlas antes de crear las nuevas
-- porque cambia la cantidad de argumentos.
drop function if exists public.book_class(uuid);
drop function if exists public.cancel_booking(uuid, text);

create or replace function public.book_class(p_class_id uuid, p_booking_date date)
returns uuid
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_capacity int;
  v_discipline_id uuid;
  v_days_of_week integer[];
  v_booked_count int;
  v_credit_id uuid;
  v_remaining int;
  v_booking_id uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select capacity, discipline_id, days_of_week into v_capacity, v_discipline_id, v_days_of_week
  from classes where id = p_class_id for update;
  if v_capacity is null then
    raise exception 'La clase no existe';
  end if;

  if not (extract(dow from p_booking_date)::int = any(v_days_of_week)) then
    raise exception 'Esta clase no se dicta ese día.';
  end if;

  -- El cupo se cuenta por ocurrencia puntual (class_id + booking_date), no
  -- para toda la vida de la plantilla recurrente.
  select count(*) into v_booked_count
  from bookings where class_id = p_class_id and booking_date = p_booking_date;
  if v_booked_count >= v_capacity then
    raise exception 'Sin cupo';
  end if;

  -- El balance de créditos es por disciplina: reservar Boxeo descuenta del
  -- pack de Boxeo, no del de Kickboxing aunque el socio tenga los dos.
  select id, remaining_credits into v_credit_id, v_remaining
  from user_credits
  where user_id = v_user_id and discipline_id = v_discipline_id
  order by created_at desc
  limit 1
  for update;

  if v_credit_id is null or coalesce(v_remaining, 0) <= 0 then
    raise exception 'Sin créditos disponibles para esta disciplina';
  end if;

  insert into bookings (user_id, class_id, booking_date) values (v_user_id, p_class_id, p_booking_date)
  returning id into v_booking_id;

  update user_credits set remaining_credits = remaining_credits - 1 where id = v_credit_id;

  return v_booking_id;
end;
$$;

create or replace function public.cancel_booking(p_class_id uuid, p_booking_date date, p_reason text default null)
returns void
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_discipline_id uuid;
  v_credit_id uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select discipline_id into v_discipline_id from classes where id = p_class_id;

  delete from bookings
  where user_id = v_user_id and class_id = p_class_id and booking_date = p_booking_date;
  if not found then
    raise exception 'No tenías una reserva en esta clase';
  end if;

  insert into booking_cancellations (user_id, class_id, booking_date, reason)
  values (v_user_id, p_class_id, p_booking_date, nullif(trim(p_reason), ''));

  select id into v_credit_id
  from user_credits
  where user_id = v_user_id and discipline_id = v_discipline_id
  order by created_at desc
  limit 1
  for update;

  if v_credit_id is not null then
    update user_credits set remaining_credits = remaining_credits + 1 where id = v_credit_id;
  end if;
end;
$$;

grant execute on function public.book_class(uuid, date) to authenticated;
grant execute on function public.cancel_booking(uuid, date, text) to authenticated;

-- ============================================================
-- BOOKING_CANCELLATIONS — log de cancelaciones con motivo opcional.
-- No vive como columna en `bookings` porque cancelar borra esa fila
-- (libera cupo y devuelve el crédito); esto es lo que el admin ve en
-- la sección "cancelados" del roster de una clase.
-- ============================================================

create table booking_cancellations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  booking_date date not null,
  reason text,
  cancelled_at timestamptz default now()
);

create index idx_booking_cancellations_class on booking_cancellations(class_id, booking_date, cancelled_at desc);

alter table booking_cancellations enable row level security;

create policy "booking_cancellations_select_own_or_admin" on booking_cancellations
  for select using (auth.uid() = user_id or public.is_admin());

-- cancel_booking() es security definer e inserta por su cuenta, pero dejamos
-- esta policy por si en el futuro se inserta directo desde el cliente.
create policy "booking_cancellations_insert_own" on booking_cancellations
  for insert with check (auth.uid() = user_id);

-- ============================================================
-- NOTIFICATIONS — segmentación de audiencia (admin)
-- No hay tabla de "fan-out" (una fila por destinatario): guardamos el
-- descriptor de audiencia y cada socio ve sus propias notificaciones
-- resueltas dinámicamente vía RLS contra bookings/user_credits reales.
-- ============================================================

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  sender_id uuid not null references profiles(id),
  audience_type text not null check (audience_type in ('all', 'class', 'user', 'debtors')),
  target_class_id uuid references classes(id),
  -- on delete set null: si se borra el socio destinatario, el envío queda
  -- en el historial del admin pero sin destinatario (no bloquea el borrado).
  target_user_id uuid references profiles(id) on delete set null,
  title text not null,
  body text not null,
  created_at timestamptz default now()
);

create index idx_notifications_sender on notifications(sender_id, created_at desc);

alter table notifications enable row level security;

-- "Deudor" = tiene alguna disciplina de tipo 'credits' cuyo último pack
-- llegó a 0. Las membresías ('membership', ej. Aparatos) no cuentan acá
-- -- eso se controla por vigencia (expires_at), no por deuda de créditos.
create or replace function public.debtor_user_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select distinct user_id from (
    select distinct on (uc.user_id, uc.discipline_id)
      uc.user_id, uc.remaining_credits
    from user_credits uc
    join disciplines d on d.id = uc.discipline_id
    where d.kind = 'credits'
    order by uc.user_id, uc.discipline_id, uc.created_at desc
  ) latest
  where coalesce(remaining_credits, 0) <= 0;
$$;

grant execute on function public.debtor_user_ids() to authenticated;

-- "Socio activo" = tiene algo usable ahora mismo: créditos > 0 en alguna
-- disciplina 'credits', o una membresía 'membership' todavía vigente.
create or replace function public.active_socio_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select distinct user_id from (
    select distinct on (uc.user_id, uc.discipline_id)
      uc.user_id, uc.remaining_credits, uc.expires_at, d.kind
    from user_credits uc
    join disciplines d on d.id = uc.discipline_id
    order by uc.user_id, uc.discipline_id, uc.created_at desc
  ) latest
  where (kind = 'credits' and coalesce(remaining_credits, 0) > 0)
     or (kind = 'membership' and expires_at >= now());
$$;

grant execute on function public.active_socio_ids() to authenticated;

-- El admin gestiona todo (crear, ver su historial de envíos, etc.)
create policy "notifications_admin_write" on notifications
  for all using (public.is_admin()) with check (public.is_admin());

-- Cada socio ve solo las notificaciones cuya audiencia lo incluye a él:
-- 'all' siempre, 'user' si es el destinatario, 'class' si tiene una reserva
-- en esa clase, 'debtors' si su último pack está en 0 créditos.
create policy "notifications_select_recipient" on notifications
  for select using (
    audience_type = 'all'
    or (audience_type = 'user' and target_user_id = auth.uid())
    or (audience_type = 'class' and exists (
      select 1 from bookings
      where bookings.user_id = auth.uid() and bookings.class_id = notifications.target_class_id
    ))
    or (audience_type = 'debtors' and auth.uid() in (select public.debtor_user_ids()))
  );

-- ── PUSH_SUBSCRIPTIONS (Web Push / VAPID) ──────────────────────
-- Un socio puede tener más de una fila (distintos navegadores/dispositivos
-- PWA instalados) — por eso no hay unique(user_id), sino unique(endpoint):
-- cada endpoint identifica una única suscripción del navegador, y volver a
-- suscribirse desde el mismo browser hace upsert sobre esa fila en vez de
-- duplicarla.
create table push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now()
);

create index idx_push_subscriptions_user on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- El socio administra únicamente sus propias suscripciones (alta al activar
-- el switch, baja al desactivarlo o al hacer logout).
create policy "push_subscriptions_own" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- El admin (o la función de envío del dashboard web) necesita leer todos
-- los endpoints para poder mandar el push real vía la API de Web Push.
create policy "push_subscriptions_admin_read" on push_subscriptions
  for select using (public.is_admin());
