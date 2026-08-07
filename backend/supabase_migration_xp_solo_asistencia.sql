-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor)
--
-- Regla de oro: los +100 XP diarios (y de hecho, TODO xp_events) solo se
-- acreditan server-side -- Check-in Rápido del Admin
-- (admin_otorgar_checkin_musculacion), la asistencia confirmada de una
-- clase reservada (trigger award_xp_asistencia) o una reversión del Admin
-- (admin_revertir_xp_evento). El socio ya NO tiene ninguna vía de
-- autoreporte: se dan de baja el botón "¡Hoy entrené!" (+100), publicar en
-- la Comunidad (+25) y completar un PR (+150) como fuentes de XP.
--
-- Completar una Meta Personal (+300) también deja de otorgar XP -- la
-- función se reemplaza para sacar ese insert, la validación de "7 días
-- mínimo" se mantiene intacta (la meta en sí se sigue pudiendo completar,
-- simplemente ya no suma XP).

-- ============================================================
-- 1) Sin insert directo de xp_events desde el cliente -- de ahora en más,
--    la tabla es de solo lectura para el socio (xp_events_select_own sigue
--    igual) y toda escritura pasa por una función `security definer`
--    (bypasea RLS, no depende de esta policy).
-- ============================================================

drop policy if exists "xp_events_insert_own" on xp_events;

-- ============================================================
-- 2) Completar una Meta Personal ya no otorga XP -- se mantiene la regla de
--    los 7 días mínimos, se saca el insert en xp_events.
-- ============================================================

create or replace function public.completar_meta_personal()
returns trigger as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    if new.completed_at < old.created_at + interval '7 days' then
      raise exception 'Todavía no pasaron 7 días desde que creaste esta meta.';
    end if;
    -- Ya no suma XP -- completar una meta sigue funcionando como feature
    -- (fecha de completado, bloqueo de "una activa a la vez"), solo sin el
    -- bonus de +300 XP que otorgaba antes.
  end if;
  return new;
end;
$$ language plpgsql security definer;
