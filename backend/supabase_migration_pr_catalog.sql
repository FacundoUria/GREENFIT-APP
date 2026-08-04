-- Ejecutar en el SQL Editor de Supabase CUANDO SE QUIERA gestionar el
-- catálogo de Marcas Personales (PRs) desde el panel admin en vez del array
-- hardcodeado en ProgresoMobileView.tsx. Hasta que esto se corra, la PWA
-- sigue funcionando con la lista fija de siempre (fallback automático, ver
-- fetchPRCatalog() en ese archivo) -- cero pantalla en blanco si todavía no
-- se aplicó.
--
-- Esta migración NO incluye la pantalla de admin para crear/editar/activar
-- estas filas -- esa UI vive en el otro repo (panel web "PAGINA SUPABASE",
-- Vite + React + Tailwind) y todavía no se construyó. Con esta tabla ya
-- desplegada, cualquier fila que el admin cargue a mano desde el SQL
-- Editor (o desde esa futura pantalla) aparece en la app sin tocar código.

create table pr_catalog (
  -- Slug estable (ej: "back-squat") -- el cliente lo usa como key para
  -- guardar el valor cargado en AsyncStorage, así que no conviene
  -- cambiarlo una vez creada la fila (perdería el historial local ya
  -- guardado con la key vieja).
  id text primary key,
  label text not null,
  kind text not null check (kind in ('peso', 'tiempo')),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table pr_catalog enable row level security;

-- No es información sensible -- cualquier socio autenticado puede leer el
-- catálogo completo (la app igual filtra is_active = true del lado del
-- cliente). Solo el admin lo edita.
create policy "pr_catalog_select_all" on pr_catalog
  for select using (true);
create policy "pr_catalog_admin_write" on pr_catalog
  for all using (public.is_admin()) with check (public.is_admin());

-- Semilla: mismo catálogo que ya trae la app hardcodeado -- activar esta
-- tabla el día 1 no cambia nada visualmente hasta que el admin edite algo.
insert into pr_catalog (id, label, kind, sort_order) values
  ('back-squat', 'Back Squat', 'peso', 1),
  ('clean-and-jerk', 'Clean & Jerk', 'peso', 2),
  ('deadlift', 'Peso Muerto', 'peso', 3),
  ('snatch', 'Snatch', 'peso', 4),
  ('front-squat', 'Front Squat', 'peso', 5),
  ('wod-fran', 'WOD "Fran"', 'tiempo', 6);
