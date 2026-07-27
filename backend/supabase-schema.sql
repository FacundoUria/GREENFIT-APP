-- ============================================================
-- GREEN FIT — Schema para Supabase (Postgres + Auth + RLS)
-- Pegar y correr entero en el SQL Editor de Supabase.
-- ============================================================

-- ── EXTENSIONES ────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── PROFILES ────────────────────────────────────────────────
-- No creamos una tabla "users" propia: Supabase ya tiene auth.users.
-- "profiles" extiende auth.users con lo que a nosotros nos importa (rol, nombre).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'socio' check (role in ('socio', 'admin')),
  created_at timestamptz default now()
);

-- Trigger: cuando alguien se registra en auth.users, le creamos el profile solo.
-- Sin esto, el registro crea la sesión pero no la fila de rol -> app rota.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Nuevo socio'), 'socio');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── PACKS ───────────────────────────────────────────────────
create table packs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,              -- "Pack 12 clases de Boxeo"
  total_credits int not null,
  validity_days int not null default 30
);

-- ── USER_CREDITS (equivalente a "user_packs" del diseño anterior) ──
create table user_credits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  pack_id uuid not null references packs(id),
  credits_remaining int not null,
  expires_at date not null,
  status text not null default 'active' check (status in ('active', 'expired')),
  created_at timestamptz default now()
);

-- ── CLASSES (tipo de clase) ─────────────────────────────────
create table classes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,              -- Boxeo, Cross, Funcional
  description text
);

-- ── SCHEDULES (turno concreto: clase + horario + capacidad) ─
create table schedules (
  id uuid primary key default uuid_generate_v4(),
  class_id uuid not null references classes(id),
  start_time timestamptz not null,
  capacity int not null,
  status text not null default 'open' check (status in ('open', 'cancelled'))
);

-- ── BOOKINGS ────────────────────────────────────────────────
create table bookings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  schedule_id uuid not null references schedules(id),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'attended', 'no_show')),
  created_at timestamptz default now(),
  unique (user_id, schedule_id) -- evita doble reserva accidental del mismo turno
);

create index idx_bookings_schedule on bookings(schedule_id, status);

-- ============================================================
-- ROW LEVEL SECURITY — sin esto, la anon key expone todo.
-- ============================================================

alter table profiles enable row level security;
alter table packs enable row level security;
alter table user_credits enable row level security;
alter table classes enable row level security;
alter table schedules enable row level security;
alter table bookings enable row level security;

-- Helper: ¿el usuario logueado es admin?
create function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- PROFILES: cada uno ve/edita el suyo, el admin ve todos
create policy "profiles_select_own_or_admin" on profiles
  for select using (auth.uid() = id or public.is_admin());
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

-- PACKS y CLASSES: catálogo público de solo lectura para logueados, solo admin edita
create policy "packs_select_all" on packs for select using (auth.role() = 'authenticated');
create policy "packs_admin_write" on packs for all using (public.is_admin());
create policy "classes_select_all" on classes for select using (auth.role() = 'authenticated');
create policy "classes_admin_write" on classes for all using (public.is_admin());
create policy "schedules_select_all" on schedules for select using (auth.role() = 'authenticated');
create policy "schedules_admin_write" on schedules for all using (public.is_admin());

-- USER_CREDITS: cada uno ve los suyos, solo admin escribe (carga/renueva créditos)
create policy "user_credits_select_own_or_admin" on user_credits
  for select using (auth.uid() = user_id or public.is_admin());
create policy "user_credits_admin_write" on user_credits
  for all using (public.is_admin());

-- BOOKINGS: cada uno gestiona las suyas, admin ve/gestiona todas
create policy "bookings_select_own_or_admin" on bookings
  for select using (auth.uid() = user_id or public.is_admin());
create policy "bookings_insert_own" on bookings
  for insert with check (auth.uid() = user_id);
create policy "bookings_update_own_or_admin" on bookings
  for update using (auth.uid() = user_id or public.is_admin());
