-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor)
--
-- supabase-schema.sql documenta una policy "push_subscriptions_admin_read"
-- que nunca se creó en la base real -- push_subscriptions solo tenía
-- policies "auth.uid() = user_id" (el propio socio). No bloqueaba a
-- send-push (corre con Service Role, bypasea RLS), pero sí a cualquier
-- lectura admin hecha con el JWT del panel.

drop policy if exists "push_subscriptions_admin_read" on push_subscriptions;
create policy "push_subscriptions_admin_read" on push_subscriptions
  for select using (public.is_admin());
