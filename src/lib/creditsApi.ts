import { supabase } from './supabase';
import { Pack, UserCredit, CreditoDePack } from '../types';

// Un pack ahora es un combo: `creditos` (jsonb en la tabla) trae
// [{discipline_id, credits}, ...] -- 0 a N disciplinas -- en vez del viejo
// discipline_id/credits fijo de a uno. Dos queries en vez de un embed
// (mismo criterio que PlanesPacksCard.jsx en el Admin): `creditos` solo
// guarda el id, no el nombre, así que hace falta cruzar contra
// `disciplines` acá para poder armar el subtítulo ("8 créditos Boxeo").
//
// `activeOnly` filtra los pases dados de baja (is_active = false) — se usa
// en el modal de compra del socio; el panel de gestión del admin trae todos
// (activos e inactivos) para poder reactivarlos.
export async function fetchPacks(options?: { activeOnly?: boolean }): Promise<Pack[]> {
  let query = supabase
    .from('packs')
    .select('id, name, price, is_active, incluye_aparatos, dias_vigencia, creditos')
    .order('name');
  if (options?.activeOnly) {
    query = query.eq('is_active', true);
  }
  const [{ data, error }, { data: disciplinasData, error: discError }] = await Promise.all([
    query,
    supabase.from('disciplines').select('id, name, is_active'),
  ]);
  if (error) throw new Error(error.message);
  if (discError) throw new Error(discError.message);

  const disciplinasPorId = new Map((disciplinasData ?? []).map((d) => [d.id, d]));

  const packs: Pack[] = [];
  for (const p of data ?? []) {
    const creditosRaw = Array.isArray(p.creditos) ? (p.creditos as { discipline_id: string; credits: number }[]) : [];
    const creditos: CreditoDePack[] = [];
    for (const c of creditosRaw) {
      const disciplina = disciplinasPorId.get(c.discipline_id);
      if (!disciplina) continue;
      // Una disciplina desactivada no debe ofrecerse para compra de
      // créditos aunque el pack en sí siga marcado is_active=true.
      if (options?.activeOnly && disciplina.is_active === false) continue;
      if (!c.credits || c.credits <= 0) continue;
      creditos.push({ disciplineId: c.discipline_id, disciplineName: disciplina.name, credits: c.credits });
    }
    const incluyeAparatos = p.incluye_aparatos === true;
    // Sin ningún crédito válido y sin Aparatos, el pack quedó vacío (todas
    // sus disciplinas se desactivaron) -- no tiene sentido ofrecerlo.
    if (creditos.length === 0 && !incluyeAparatos) continue;
    packs.push({
      id: p.id,
      name: p.name,
      creditos,
      incluyeAparatos,
      diasVigencia: p.dias_vigencia ?? null,
      price: p.price,
      isActive: p.is_active,
    });
  }
  return packs;
}

// "8 créditos CrossFit + 8 créditos Boxeo" / "Aparatos + 12 créditos
// CrossFit" / "Aparatos Pase Libre" -- generado siempre a partir de lo que
// trae el pack, nunca hardcodeado por nombre de pack.
export function buildPackSubtitle(pack: Pack): string {
  const partesCreditos = pack.creditos.map((c) => `${c.credits} créditos ${c.disciplineName}`);
  if (pack.incluyeAparatos && partesCreditos.length === 0) return 'Aparatos Pase Libre';
  if (pack.incluyeAparatos) return ['Aparatos', ...partesCreditos].join(' + ');
  return partesCreditos.join(' + ');
}

// Autocuración: si el alta/edición de un socio en el panel admin nunca
// llegó a sincronizar `user_credits` (import masivo, "Editar Socio" en vez
// de "Registrar Pago", un texto de plan que no matcheó ninguna disciplina,
// etc.) esto rellena esos huecos genuinos server-side antes de leer el
// balance -- nunca pisa un balance que ya exista, porque eso puede reflejar
// consumo real hecho desde la PWA. Se puede (y conviene) llamar en cada
// login/focus: es idempotente, solo actúa donde hay cero filas.
export async function syncMyMembership(): Promise<{ vinculado: boolean; sincronizados: number } | null> {
  const { data, error } = await supabase.rpc('sync_my_membership').single();
  if (error) {
    console.warn('[GreenFit] No se pudo autocurar el balance del socio:', error.message);
    return null;
  }
  const resultado = data as { vinculado: boolean; sincronizados: number } | null;
  if (resultado && resultado.vinculado === false) {
    console.warn(
      '[GreenFit] El usuario autenticado no matchea ninguna ficha en la tabla socios -- su plan/créditos no se pueden resolver hasta que quede vinculado por DNI.'
    );
  }
  return resultado;
}

// Set de discipline_id que están en `socios.plan` AHORA MISMO, según el
// panel Admin -- fuente única de verdad, ver supabase_migration_single_source_of_truth.sql.
// `null` significa "no filtrar" (socio sin ficha admin vinculada todavía,
// o la migración de este RPC todavía no se corrió en este ambiente --
// mismo criterio "fail open" que ya usa syncMyMembership para lo mismo).
async function fetchDisciplinasDelPlanActual(): Promise<Set<string> | null> {
  const { data, error } = await supabase.rpc('disciplinas_del_plan_actual').single();
  if (error) return null;
  const fila = data as { vinculado: boolean; discipline_ids: string[] | null } | null;
  if (!fila || !fila.vinculado) return null;
  return new Set(fila.discipline_ids ?? []);
}

// El balance más reciente del socio para CADA disciplina en la que tenga
// algo cargado (una fila por disciplina, no una sola global) -- filtrado a
// las disciplinas que el panel Admin tiene tildadas HOY para este socio.
// `user_credits` es un ledger append-only (nunca se borra una fila): si el
// admin destildó una disciplina, su fila vieja sigue existiendo para la
// auditoría, pero acá deja de ser VISIBLE apenas se saca del plan -- sin
// esto, un socio seguía viendo para siempre disciplinas que el admin ya
// le había sacado (bug real reportado: "figuran activos Boxeo, Kickboxing
// y CrossFit" en la PWA cuando el Admin solo tenía tildado Boxeo).
export async function fetchUserBalances(userId: string): Promise<UserCredit[]> {
  const [{ data, error }, { data: disciplinasData, error: discError }, disciplinasDelPlan] = await Promise.all([
    supabase
      .from('user_credits')
      .select(
        'id, user_id, remaining_credits, expires_at, created_at, discipline:disciplines(id, name, kind), pack:packs(id, name, price, is_active, incluye_aparatos, dias_vigencia, creditos)'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    // Un pack combo puede acreditar disciplinas distintas a la de ESTA fila
    // de user_credits puntual -- para armar `pack.creditos` con nombres
    // reales (no solo ids) hace falta el catálogo completo de disciplinas.
    supabase.from('disciplines').select('id, name'),
    fetchDisciplinasDelPlanActual(),
  ]);
  if (error) throw new Error(error.message);
  if (discError) throw new Error(discError.message);
  const disciplinasPorId = new Map((disciplinasData ?? []).map((d) => [d.id, d]));

  const latestByDiscipline = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    const discipline = Array.isArray(row.discipline) ? row.discipline[0] : row.discipline;
    if (disciplinasDelPlan && !disciplinasDelPlan.has(discipline.id)) continue;
    if (!latestByDiscipline.has(discipline.id)) latestByDiscipline.set(discipline.id, row);
  }

  return Array.from(latestByDiscipline.values()).map((row) => {
    const discipline = Array.isArray(row.discipline) ? row.discipline[0] : row.discipline;
    const pack = Array.isArray(row.pack) ? row.pack[0] : row.pack;
    const creditosRaw = Array.isArray(pack?.creditos) ? (pack!.creditos as { discipline_id: string; credits: number }[]) : [];
    const creditos: CreditoDePack[] = creditosRaw
      .map((c) => {
        const d = disciplinasPorId.get(c.discipline_id);
        return d ? { disciplineId: c.discipline_id, disciplineName: d.name, credits: c.credits } : null;
      })
      .filter((c): c is CreditoDePack => c !== null);
    return {
      id: row.id,
      userId: row.user_id,
      remainingCredits: row.remaining_credits,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      discipline: { id: discipline.id, name: discipline.name, kind: discipline.kind },
      // Créditos cargados a mano por el admin no vienen de un pack puntual
      // (`pack_id` queda null) -- sin esto, cualquier lectura de `.pack.algo`
      // más abajo revienta con "Cannot read properties of null".
      pack: pack
        ? {
            id: pack.id,
            name: pack.name,
            creditos,
            incluyeAparatos: pack.incluye_aparatos === true,
            diasVigencia: pack.dias_vigencia ?? null,
            price: pack.price,
            isActive: pack.is_active,
          }
        : null,
    };
  });
}

// Cuántos créditos originales le correspondían a ESTA disciplina puntual
// dentro del combo comprado -- para el "X de Y clases restantes" (Y = lo
// que vino en el pack para esta disciplina, no el total del combo entero).
export function creditosOriginalesPara(pack: Pack | null | undefined, disciplineId: string): number | null {
  return pack?.creditos.find((c) => c.disciplineId === disciplineId)?.credits ?? null;
}
