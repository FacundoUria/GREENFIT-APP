-- Ejecutar en el SQL Editor de Supabase CUANDO SE QUIERA activar el sistema
-- de XP/Niveles real (500 XP = 1 nivel). Hasta que esto se corra,
-- src/lib/xpApi.ts detecta que `xp_events` no existe y estima el XP a
-- partir de clases con asistencia real (mismo peso que la regla real, +100
-- por clase) -- el número de nivel no "salta" feo el día que se active esto.
--
-- Reglas vigentes (el "check-in diario" que se había descartado terminó
-- volviendo como botón "¡Hoy entrené!" -- ver nota en la regla 1):
--   1) Asistencia (clase confirmada por el admin, O botón              -> +100 XP -- máx 1 por día
--      "¡Hoy entrené!" autoreportado por el socio)                        combinando AMBAS fuentes (índice único
--                                                                          de abajo), automático vía trigger para
--                                                                          la clase confirmada, client-side para
--                                                                          el botón.
--   2) Registrar/superar un PR (Aparatos y Clases)           -> +150 XP (client-side, ProgresoMobileView)
--   3) Completar una Meta personal                           -> +300 XP (automático, trigger sobre metas_personales.completed_at)
--   4) Publicar en el Feed/Comunidad (máx 1 por día)         -> +25 XP (client-side, ComunidadMobileView)

create table xp_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  event_type text not null check (event_type in ('asistencia', 'pr', 'meta', 'post')),
  xp_amount int not null,
  -- Referencia informativa (booking/pr/meta/post) -- nullable porque los
  -- PRs hoy son 100% locales (AsyncStorage), no hay una fila real a apuntar.
  reference_id uuid,
  event_date date not null default current_date,
  created_at timestamptz default now()
);

create index idx_xp_events_user on xp_events(user_id);

-- 1 fila de tipo 'asistencia' por reserva (protege el trigger de clase
-- confirmada contra disparar dos veces), 1 fila 'meta' por meta completada,
-- y el cap de "máximo 1 por día" para 'asistencia' Y 'post': el índice de
-- (user_id, event_date) para 'asistencia' es compartido por las DOS fuentes
-- (trigger de clase confirmada Y botón "¡Hoy entrené!") -- la que llegue
-- primero ese día gana, la segunda es un no-op silencioso (23505), nunca
-- se acredita doble en el mismo día.
create unique index idx_xp_events_asistencia_unica on xp_events(reference_id) where event_type = 'asistencia';
create unique index idx_xp_events_asistencia_por_dia on xp_events(user_id, event_date) where event_type = 'asistencia';
create unique index idx_xp_events_meta_unica on xp_events(reference_id) where event_type = 'meta';
create unique index idx_xp_events_post_por_dia on xp_events(user_id, event_date) where event_type = 'post';

alter table xp_events enable row level security;

create policy "xp_events_select_own" on xp_events
  for select using (auth.uid() = user_id);
-- 'meta' NO es insertable por el cliente -- solo lo crea el trigger de
-- completar_meta_personal() (security definer, bypasea esta policy),
-- porque tiene una regla de negocio (7 días mínimos) que hay que validar
-- server-side. 'asistencia' SÍ es insertable por el cliente ahora (botón
-- "¡Hoy entrené!", autoreportado -- mismo nivel de confianza que un PR
-- autoreportado) además de seguir llegando vía trigger para la clase
-- confirmada por el admin; el índice único de arriba es lo que evita que
-- ninguna de las dos fuentes duplique el cupo diario. 'pr' y 'post' sí los
-- inserta el propio socio activo directo, como ya hacían.
create policy "xp_events_insert_own" on xp_events
  for insert with check (
    auth.uid() = user_id
    and public.is_active_socio()
    and event_type in ('pr', 'post', 'asistencia')
  );

-- ============================================================
-- +100 XP automático al confirmarse asistencia (solo disciplinas grupales,
-- kind='credits' -- mismo criterio que ya usa community_ranking_mes():
-- Musculación/Aparatos son pase libre y no "reservan" una clase puntual).
-- Corre pase lo que pase quién marcó `attended` (el admin, desde el panel
-- web) -- un trigger es la única forma correcta de capturar esto, porque el
-- socio puede no tener la PWA abierta en el momento exacto.
-- ============================================================

create or replace function public.award_xp_asistencia()
returns trigger as $$
declare
  v_kind text;
begin
  select d.kind into v_kind
  from classes c
  join disciplines d on d.id = c.discipline_id
  where c.id = new.class_id;

  if v_kind = 'credits' and new.attended = true and (old.attended is distinct from true) then
    insert into xp_events (user_id, event_type, xp_amount, reference_id)
    values (new.user_id, 'asistencia', 100, new.id)
    on conflict do nothing;
  elsif new.attended is distinct from true and old.attended = true then
    -- Si el admin corrige una asistencia mal marcada, se revierte el XP.
    delete from xp_events where reference_id = new.id and event_type = 'asistencia';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_award_xp_asistencia
  after update of attended on bookings
  for each row execute procedure public.award_xp_asistencia();

-- ============================================================
-- METAS PERSONALES (+300 XP al completarlas)
--
-- Autogestionada por el socio, con 2 frenos anti-abuso simples (decisión
-- del usuario, sin aprobación de admin ni condición numérica):
--   - Solo 1 meta activa (sin completar) a la vez por socio.
--   - No se puede completar antes de 7 días de creada.
-- Ambos frenos se validan server-side (índice único + trigger), no solo en
-- la app, para que no sean saltables editando el request a mano.
-- ============================================================

create table metas_personales (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  texto text not null,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- Solo una meta activa (sin completar) por socio.
create unique index idx_metas_personales_activa_unica on metas_personales(user_id) where completed_at is null;

alter table metas_personales enable row level security;

create policy "metas_personales_select_own" on metas_personales
  for select using (auth.uid() = user_id);
create policy "metas_personales_insert_own" on metas_personales
  for insert with check (auth.uid() = user_id and public.is_active_socio());
-- "Completar" es un update de completed_at -- la regla de los 7 días la
-- exige el trigger de abajo, no esta policy (acá solo se valida que sea la
-- propia fila del socio).
create policy "metas_personales_update_own" on metas_personales
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "metas_personales_delete_own" on metas_personales
  for delete using (auth.uid() = user_id);

create or replace function public.completar_meta_personal()
returns trigger as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    if new.completed_at < old.created_at + interval '7 days' then
      raise exception 'Todavía no pasaron 7 días desde que creaste esta meta.';
    end if;
    insert into xp_events (user_id, event_type, xp_amount, reference_id)
    values (new.user_id, 'meta', 300, new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_completar_meta_personal
  before update of completed_at on metas_personales
  for each row execute procedure public.completar_meta_personal();

-- ============================================================
-- BACKFILL único: asistencias que los socios YA tenían confirmadas antes de
-- activar este sistema. El trigger de arriba solo captura asistencias
-- NUEVAS hacia adelante -- sin este backfill, todo socio arrancaría en 0
-- XP de asistencia pese a tener meses de historial real. Seguro de correr
-- más de una vez: el índice único de xp_events (reference_id donde
-- event_type='asistencia') hace que `on conflict do nothing` evite
-- duplicar si por lo que sea se vuelve a ejecutar este bloque.
-- ============================================================

insert into xp_events (user_id, event_type, xp_amount, reference_id, event_date)
select b.user_id, 'asistencia', 100, b.id, b.booking_date
from bookings b
join classes c on c.id = b.class_id
join disciplines d on d.id = c.discipline_id
where b.attended = true
  and d.kind = 'credits'
on conflict do nothing;

-- ============================================================
-- RANKING DE COMUNIDAD POR XP TOTAL
--
-- Reemplaza a community_ranking_mes() (que rankeaba por CLASES asistidas
-- en el mes) -- ahora el ranking ordena por XP TOTAL acumulado de siempre
-- (asistencia + PRs + metas + posteos), que es el mismo ledger que ya
-- alimenta el Nivel de Mi Perfil. Un socio no puede leer el xp_events de
-- otro (xp_events_select_own es auth.uid() = user_id), así que esto
-- necesita el mismo patrón security definer que ya usa community_ranking_mes().
--
-- p_discipline_id sigue siendo opcional para el selector de disciplina que
-- ya existía en la UI: sin filtro (null) suma TODO el XP de la persona;
-- con un filtro, solo suma el XP de tipo 'asistencia' cuyas reservas
-- pertenecen a esa disciplina (PRs/metas/posteos no son de una disciplina
-- puntual, así que no entran en un filtro por disciplina).
create or replace function public.community_ranking_xp(p_discipline_id uuid default null)
returns table (user_id uuid, full_name text, total_xp int)
language sql
security definer
stable
as $$
  select xe.user_id, p.full_name, sum(xe.xp_amount)::int as total_xp
  from xp_events xe
  join profiles p on p.id = xe.user_id
  where p_discipline_id is null
     or (
       xe.event_type = 'asistencia'
       and exists (
         select 1
         from bookings b
         join classes c on c.id = b.class_id
         where b.id = xe.reference_id and c.discipline_id = p_discipline_id
       )
     )
  group by xe.user_id, p.full_name
  order by total_xp desc
  limit 20;
$$;

grant execute on function public.community_ranking_xp(uuid) to authenticated;
