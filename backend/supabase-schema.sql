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
  role text not null default 'socio' check (role in ('socio', 'admin')),
  created_at timestamptz default now()
);

-- Trigger: cuando alguien se registra en auth.users, le creamos el profile solo.
-- Sin esto, el registro crea la sesión pero no la fila de rol -> app rota.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', 'Nuevo socio'), 'socio');
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
  credits int not null,
  price numeric not null,
  created_at timestamptz default now()
);

-- ── USER_CREDITS (créditos de un socio sobre un pack comprado) ──
create table user_credits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  pack_id uuid not null references packs(id),
  remaining_credits int not null,
  created_at timestamptz default now()
);

-- ── CLASSES (turno concreto: título, horario, capacidad) ────
create table classes (
  id uuid primary key default uuid_generate_v4(),
  title text not null,              -- Boxeo, Cross, Funcional
  capacity int not null,
  start_time timestamptz not null,
  created_at timestamptz default now()
);

-- ── BOOKINGS ────────────────────────────────────────────────
create table bookings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  class_id uuid not null references classes(id),
  created_at timestamptz default now(),
  unique (user_id, class_id) -- evita doble reserva accidental de la misma clase
);

create index idx_bookings_class on bookings(class_id);

-- ============================================================
-- ROW LEVEL SECURITY — sin esto, la anon key expone todo.
-- ============================================================

alter table profiles enable row level security;
alter table packs enable row level security;
alter table user_credits enable row level security;
alter table classes enable row level security;
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

-- BOOKINGS: cada uno gestiona las suyas, admin ve/gestiona todas
create policy "bookings_select_own_or_admin" on bookings
  for select using (auth.uid() = user_id or public.is_admin());
create policy "bookings_insert_own" on bookings
  for insert with check (auth.uid() = user_id);
create policy "bookings_delete_own_or_admin" on bookings
  for delete using (auth.uid() = user_id or public.is_admin());

-- ============================================================
-- RESERVAS — funciones atómicas (RPC)
-- El cliente no puede tocar remaining_credits directamente (solo admin,
-- ver policy user_credits_admin_write). Reservar/cancelar pasa por estas
-- funciones security definer para que el chequeo de cupo/créditos y el
-- descuento de crédito ocurran en una sola transacción, sin condiciones
-- de carrera entre dos reservas simultáneas.
-- ============================================================

create or replace function public.book_class(p_class_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_capacity int;
  v_booked_count int;
  v_credit_id uuid;
  v_remaining int;
  v_booking_id uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  select capacity into v_capacity from classes where id = p_class_id for update;
  if v_capacity is null then
    raise exception 'La clase no existe';
  end if;

  select count(*) into v_booked_count from bookings where class_id = p_class_id;
  if v_booked_count >= v_capacity then
    raise exception 'Sin cupo';
  end if;

  select id, remaining_credits into v_credit_id, v_remaining
  from user_credits
  where user_id = v_user_id
  order by created_at desc
  limit 1
  for update;

  if v_credit_id is null or v_remaining <= 0 then
    raise exception 'Sin créditos disponibles';
  end if;

  insert into bookings (user_id, class_id) values (v_user_id, p_class_id)
  returning id into v_booking_id;

  update user_credits set remaining_credits = remaining_credits - 1 where id = v_credit_id;

  return v_booking_id;
end;
$$;

create or replace function public.cancel_booking(p_class_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_credit_id uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  delete from bookings where user_id = v_user_id and class_id = p_class_id;
  if not found then
    raise exception 'No tenías una reserva en esta clase';
  end if;

  select id into v_credit_id
  from user_credits
  where user_id = v_user_id
  order by created_at desc
  limit 1
  for update;

  if v_credit_id is not null then
    update user_credits set remaining_credits = remaining_credits + 1 where id = v_credit_id;
  end if;
end;
$$;

grant execute on function public.book_class(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
