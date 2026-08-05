-- Ejecutar en el SQL Editor de Supabase CUANDO SE QUIERA activar los chats
-- privados 1 a 1 ("Mensajes", reemplaza a "Mi Box"/Grupos en la UI --
-- decisión explícita: las tablas community_groups* de
-- supabase_migration_comunidad.sql NO se tocan ni se borran acá, solo dejan
-- de estar enganchadas desde ComunidadMobileView.tsx, por si se reactivan
-- más adelante). Hasta que esto se corra, src/lib/comunidadApi.ts detecta
-- que estas tablas no existen y cae a modo demo (AsyncStorage), mismo
-- criterio que el resto del módulo Comunidad.
--
-- Requiere profiles.avatar_url (backend/supabase_migration_avatar.sql) --
-- correr esa migración ANTES que esta.
--
-- No se ejecuta automáticamente: es un cambio de schema sobre producción.

-- ============================================================
-- HILOS (un hilo por PAR de socios -- nunca se duplica: el índice único de
-- abajo usa least/greatest sobre (user_a, user_b) para que da igual quién
-- haya iniciado la conversación primero, siempre resuelve al mismo hilo).
-- ============================================================

create table community_dm_threads (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  check (user_a <> user_b)
);

create unique index idx_community_dm_threads_par on community_dm_threads (
  least(user_a, user_b), greatest(user_a, user_b)
);

alter table community_dm_threads enable row level security;

-- Sin policy de insert/update/delete a propósito: el hilo SOLO se crea a
-- través del RPC community_dm_get_or_create() (security definer, más abajo)
-- -- así se garantiza la resolución canónica del par y no hay carrera de
-- dos inserts simultáneos creando dos hilos para el mismo par.
create policy "community_dm_threads_select_own" on community_dm_threads
  for select using (auth.uid() = user_a or auth.uid() = user_b);

-- ============================================================
-- MENSAJES
-- ============================================================

create table community_dm_messages (
  id uuid primary key default uuid_generate_v4(),
  thread_id uuid not null references community_dm_threads(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

create index idx_community_dm_messages_thread on community_dm_messages(thread_id, created_at);

alter table community_dm_messages enable row level security;

-- Mismo patrón que community_group_messages: solo los DOS participantes del
-- hilo pueden leer/escribir, nunca un tercero.
create policy "community_dm_messages_select_own_thread" on community_dm_messages
  for select using (
    exists (
      select 1 from community_dm_threads t
      where t.id = thread_id and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  );
create policy "community_dm_messages_insert_own_thread" on community_dm_messages
  for insert with check (
    auth.uid() = author_id
    and public.is_active_socio()
    and exists (
      select 1 from community_dm_threads t
      where t.id = thread_id and (t.user_a = auth.uid() or t.user_b = auth.uid())
    )
  );

-- ============================================================
-- RPC: obtener (o crear) el hilo con otro socio -- lo llama la UI al tocar
-- el avatar de alguien en el Feed o el Ranking.
-- ============================================================

create or replace function public.community_dm_get_or_create(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_me uuid := auth.uid();
  v_thread_id uuid;
begin
  if v_me is null or p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'Destinatario inválido.';
  end if;

  select id into v_thread_id from community_dm_threads
    where least(user_a, user_b) = least(v_me, p_other_user_id)
      and greatest(user_a, user_b) = greatest(v_me, p_other_user_id);

  if v_thread_id is null then
    insert into community_dm_threads (user_a, user_b) values (v_me, p_other_user_id)
      returning id into v_thread_id;
  end if;

  return v_thread_id;
end;
$$;

grant execute on function public.community_dm_get_or_create(uuid) to authenticated;

-- ============================================================
-- RPC: bandeja de "Mensajes" -- un socio no puede leer el profile de otro
-- directo (profiles_select_own_or_admin es "cada uno lo suyo"), así que
-- resolver nombre/avatar del OTRO participante de cada hilo necesita el
-- mismo patrón security definer que ya usa community_author_names(). Solo
-- lista hilos con al menos un mensaje real ("chats activos", no hilos
-- recién creados y abandonados sin escribir nada).
-- ============================================================

create or replace function public.community_dm_inbox()
returns table (
  thread_id uuid,
  other_user_id uuid,
  other_full_name text,
  other_avatar_url text,
  last_body text,
  last_created_at timestamptz
)
language sql
security definer
stable
as $$
  select
    t.id as thread_id,
    other.id as other_user_id,
    other.full_name as other_full_name,
    other.avatar_url as other_avatar_url,
    lm.body as last_body,
    lm.created_at as last_created_at
  from community_dm_threads t
  join profiles other on other.id = (case when t.user_a = auth.uid() then t.user_b else t.user_a end)
  cross join lateral (
    select body, created_at from community_dm_messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) lm
  where t.user_a = auth.uid() or t.user_b = auth.uid()
  order by lm.created_at desc;
$$;

grant execute on function public.community_dm_inbox() to authenticated;
