-- Ejecutar en el SQL Editor de Supabase CUANDO SE QUIERA activar la foto de
-- perfil real. Hasta que esto se corra:
--   - AuthContext.fetchProfile() detecta la columna faltante (42703) y
--     reintenta sin avatar_url -- el login sigue funcionando normal.
--   - src/components/Avatar.tsx siempre cae al fallback de iniciales con
--     fondo dinámico, así que ninguna pantalla queda rota ni en blanco.
--
-- No se ejecuta automáticamente: es un cambio de schema sobre producción.

-- ============================================================
-- 1) Columna nueva en profiles
-- ============================================================

alter table profiles add column if not exists avatar_url text;

-- ============================================================
-- 2) Bucket de Storage para avatares
-- ============================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Lectura pública (se usa como foto de perfil visible por todo el box en
-- Feed/Ranking/Mensajes -- no hace falta URL firmada, mismo criterio que
-- community-media). Solo el propio socio activo puede subir/actualizar/
-- borrar dentro de SU carpeta `<user_id>/...` -- mismo patrón de
-- storage.foldername(name) que ya usan las policies de community-media.
drop policy if exists "avatars_select_all" on storage.objects;
create policy "avatars_select_all" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and public.is_active_socio()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 3) Parche de community_author_names -- ahora también devuelve avatar_url
--    (esta función ya está en producción vía
--    supabase_migration_comunidad_fix_autor.sql; hay que dropearla antes de
--    recrearla porque Postgres no permite cambiar las columnas de retorno
--    de una función con CREATE OR REPLACE).
-- ============================================================

drop function if exists public.community_author_names(uuid[]);

create or replace function public.community_author_names(p_ids uuid[])
returns table (id uuid, full_name text, avatar_url text)
language sql
security definer
stable
as $$
  select id, full_name, avatar_url from profiles where id = any(p_ids);
$$;

grant execute on function public.community_author_names(uuid[]) to authenticated;
