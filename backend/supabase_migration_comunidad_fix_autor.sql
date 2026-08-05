-- Ejecutar en el SQL Editor de Supabase -- PARCHE sobre
-- supabase_migration_comunidad.sql (que ya corriste). No re-ejecutes ese
-- archivo, solo este.
--
-- BUG: el Feed/Comentarios/Chat de grupo mostraban "Socio GreenFit" en vez
-- del nombre real del autor. Causa real: `profiles(full_name)` como embed
-- de PostgREST ejecuta un SELECT sobre `profiles` CON LA RLS DEL USUARIO QUE
-- MIRA EL FEED -- y la policy `profiles_select_own_or_admin` (auth.uid() =
-- id or is_admin()) es "cada uno ve solo lo suyo". Entonces Socio A nunca
-- podía leer el `full_name` embebido de un post de Socio B -- volvía null y
-- cliente caía al fallback "Socio GreenFit". No es un bug de la query en sí,
-- es RLS bloqueando el join.
--
-- FIX: un RPC security definer que devuelve SOLO id+full_name (nada
-- sensible como dni/phone) para una lista de ids -- mismo patrón que
-- community_ranking_mes()/debtor_user_ids() ya usan en este proyecto para
-- necesidades de lectura cruzada entre socios. src/lib/comunidadApi.ts ya
-- no usa el embed `profiles(full_name)`, hace un batch a este RPC.

create or replace function public.community_author_names(p_ids uuid[])
returns table (id uuid, full_name text)
language sql
security definer
stable
as $$
  select id, full_name from profiles where id = any(p_ids);
$$;

grant execute on function public.community_author_names(uuid[]) to authenticated;
