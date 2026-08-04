-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor) CUANDO SE
-- QUIERA activar el Módulo 6 (Comunidad) en modo real. Hasta que esto se
-- corra, ComunidadMobileView.tsx detecta que estas tablas no existen y
-- funciona en "modo demo" (datos de ejemplo, local al dispositivo) para no
-- mostrar una pantalla en blanco ni romper el build -- ver src/lib/comunidadApi.ts.
--
-- No se ejecutó automáticamente: es un cambio de schema sobre la base de
-- producción y hay que revisarlo antes de correrlo a mano.

-- Reusa el mismo criterio que ya bloquea a socios dados de baja en el resto
-- de la app (Home/Reservas) -- nadie inactivo debería poder publicar,
-- reaccionar, comentar ni crear grupos.
create or replace function public.is_active_socio()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'socio' and active = true
  );
$$ language sql security definer stable;

-- ============================================================
-- FEED
-- ============================================================

create table community_posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  media_url text,
  media_type text check (media_type in ('image', 'video')),
  -- Snapshot del nivel/disciplina del autor AL MOMENTO de publicar (mismo
  -- placeholder de nivel que usa PerfilMobileView, calculado client-side con
  -- SUS PROPIOS datos). Se guarda desnormalizado a propósito: un socio no
  -- puede leer las reservas de OTRO socio (RLS de `bookings` es
  -- auth.uid() = user_id), así que no hay forma de resolver "nivel del
  -- autor" en el momento de leer el feed sin este snapshot.
  author_nivel int,
  author_discipline text,
  created_at timestamptz default now()
);

create index idx_community_posts_created on community_posts(created_at desc);

alter table community_posts enable row level security;

create policy "community_posts_select_all" on community_posts
  for select using (true);
create policy "community_posts_insert_own" on community_posts
  for insert with check (auth.uid() = author_id and public.is_active_socio());
create policy "community_posts_delete_own" on community_posts
  for delete using (auth.uid() = author_id);

create table community_reactions (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references community_posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (post_id, user_id) -- un "¡A tope!" por socio por posteo, tipo Like
);

alter table community_reactions enable row level security;

create policy "community_reactions_select_all" on community_reactions
  for select using (true);
create policy "community_reactions_insert_own" on community_reactions
  for insert with check (auth.uid() = user_id and public.is_active_socio());
create policy "community_reactions_delete_own" on community_reactions
  for delete using (auth.uid() = user_id);

create table community_comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references community_posts(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

create index idx_community_comments_post on community_comments(post_id, created_at);

alter table community_comments enable row level security;

create policy "community_comments_select_all" on community_comments
  for select using (true);
create policy "community_comments_insert_own" on community_comments
  for insert with check (auth.uid() = author_id and public.is_active_socio());
create policy "community_comments_delete_own" on community_comments
  for delete using (auth.uid() = author_id);

-- ============================================================
-- GRUPOS ("Mi Box")
-- ============================================================

create table community_groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_by uuid not null references profiles(id) on delete cascade,
  -- Opcional -- null = grupo abierto ("grupo reducido entre amigos", como
  -- pedía la spec original). Si se carga, solo puede sumarse un socio que
  -- tenga algo cargado en user_credits para ESA disciplina (ver policy de
  -- insert en community_group_members más abajo) -- así "CrossFit Mañana"
  -- no se llena de gente de Aparatos/pase libre.
  discipline_id uuid references disciplines(id),
  created_at timestamptz default now()
);

alter table community_groups enable row level security;

-- Los nombres de grupo no son sensibles -- select abierto para poder
-- descubrir/unirse a grupos existentes en vez de solo ver los propios.
create policy "community_groups_select_all" on community_groups
  for select using (true);
create policy "community_groups_insert_own" on community_groups
  for insert with check (auth.uid() = created_by and public.is_active_socio());
-- El creador borra su propio grupo; el admin puede limpiar cualquiera.
create policy "community_groups_delete_own_or_admin" on community_groups
  for delete using (auth.uid() = created_by or public.is_admin());

create table community_group_members (
  group_id uuid not null references community_groups(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

alter table community_group_members enable row level security;

create policy "community_group_members_select_all" on community_group_members
  for select using (true);
-- Solo autounirse -- nadie puede meter a otro socio a un grupo por él. Si el
-- grupo tiene discipline_id cargado, además exige que el socio tenga (o haya
-- tenido) créditos cargados en esa disciplina -- no valida vigencia/expiración
-- puntual (eso queda para una revisión futura), es un gate básico contra
-- "cualquiera se mete a cualquier grupo de disciplina".
create policy "community_group_members_insert_self" on community_group_members
  for insert with check (
    auth.uid() = user_id
    and public.is_active_socio()
    and (
      (select g.discipline_id from community_groups g where g.id = group_id) is null
      or exists (
        select 1 from user_credits uc
        where uc.user_id = auth.uid()
          and uc.discipline_id = (select g.discipline_id from community_groups g where g.id = group_id)
      )
    )
  );
create policy "community_group_members_delete_self" on community_group_members
  for delete using (auth.uid() = user_id);

create table community_group_messages (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references community_groups(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

create index idx_community_group_messages_group on community_group_messages(group_id, created_at);

alter table community_group_messages enable row level security;

-- A diferencia del feed, el chat de un grupo SOLO lo ven sus miembros.
create policy "community_group_messages_select_members" on community_group_messages
  for select using (
    exists (
      select 1 from community_group_members m
      where m.group_id = community_group_messages.group_id and m.user_id = auth.uid()
    )
  );
create policy "community_group_messages_insert_members" on community_group_messages
  for insert with check (
    auth.uid() = author_id
    and public.is_active_socio()
    and exists (
      select 1 from community_group_members m
      where m.group_id = community_group_messages.group_id and m.user_id = auth.uid()
    )
  );

-- ============================================================
-- RANKING DEL MES
-- ============================================================

-- Un socio no puede leer las reservas de otro (bookings_select_own_or_admin
-- es auth.uid() = user_id), así que el ranking necesita un RPC
-- security definer que agregue server-side y devuelva SOLO nombre + conteo
-- -- mismo patrón que ya usa debtor_user_ids() para necesidades parecidas.
--
-- Solo cuenta disciplinas kind='credits' (CrossFit, Funcional, Boxeo, etc)
-- -- Musculación/Aparatos son membership (pase libre): no reservan clases
-- puntuales, así que no tiene sentido "competir" en este ranking y de paso
-- evita que una clase suelta cargada por error bajo una disciplina
-- membership contamine el conteo. `p_discipline_id` es opcional -- null
-- (default) trae el ranking general de todas las disciplinas grupales
-- juntas; pasando un id filtra a esa sola disciplina (selector en la UI).
create or replace function public.community_ranking_mes(p_discipline_id uuid default null)
returns table (user_id uuid, full_name text, clases int)
language sql
security definer
stable
as $$
  select b.user_id, p.full_name, count(*)::int as clases
  from bookings b
  join profiles p on p.id = b.user_id
  join classes c on c.id = b.class_id
  join disciplines d on d.id = c.discipline_id
  where b.attended = true
    and d.kind = 'credits'
    and (p_discipline_id is null or d.id = p_discipline_id)
    and b.booking_date >= date_trunc('month', current_date)::date
    and b.booking_date <= current_date
  group by b.user_id, p.full_name
  order by clases desc
  limit 20;
$$;

grant execute on function public.community_ranking_mes(uuid) to authenticated;

-- ============================================================
-- STORAGE (fotos de posteos)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('community-media', 'community-media', true)
on conflict (id) do nothing;

-- Lectura pública (son fotos de un feed social, no hace falta URL firmada);
-- solo el socio activo dueño de la carpeta `<su user_id>/...` puede subir/
-- borrar sus propios archivos -- mismo criterio de "cada uno lo suyo" que
-- el resto de las policies de este módulo.
create policy "community_media_select_all" on storage.objects
  for select using (bucket_id = 'community-media');
create policy "community_media_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'community-media'
    and public.is_active_socio()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "community_media_delete_own" on storage.objects
  for delete using (bucket_id = 'community-media' and (storage.foldername(name))[1] = auth.uid()::text);
