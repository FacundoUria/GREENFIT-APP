import { supabase } from './supabase';
import { Pack, UserCredit, CreditoDePack, CreditLote } from '../types';
import { formatShortDate } from './dateFormat';

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

// El balance del socio para CADA disciplina en la que tenga algo cargado
// (una entrada por disciplina, no una sola global) -- filtrado a las
// disciplinas que el panel Admin tiene tildadas HOY para este socio.
// `user_credits` es un ledger append-only (nunca se borra una fila): si el
// admin destildó una disciplina, su fila vieja sigue existiendo para la
// auditoría, pero acá deja de ser VISIBLE apenas se saca del plan -- sin
// esto, un socio seguía viendo para siempre disciplinas que el admin ya
// le había sacado (bug real reportado: "figuran activos Boxeo, Kickstrike
// y CrossFit" en la PWA cuando el Admin solo tenía tildado Boxeo).
//
// Créditos por LOTES (ver supabase_migration_lotes_creditos_fase1/2.sql):
// una disciplina de créditos puede tener 2+ filas activas al mismo tiempo
// (compras distintas, vencimientos distintos) -- antes acá se quedaba con
// "la fila más reciente" nada más, así que un socio con 2 lotes veía un
// balance incompleto (le faltaba sumar el otro). Ahora se agrupa TODO lo
// que tiene esa disciplina y se arma el total + el desglose real.
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

  type FilaRaw = NonNullable<typeof data>[number];

  // Arma el UserCredit "base" a partir de UNA fila de referencia (para
  // 'membership', la única que importa; para 'credits', solo se usa para
  // id/pack/createdAt de referencia -- remainingCredits/expiresAt se
  // pisan después con el total/lote más próximo real). `lotes` se recibe
  // ya calculado, nunca se recalcula acá.
  function mapRow(row: FilaRaw, lotes: CreditLote[]): UserCredit {
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
      lotes,
    };
  }

  // Filtro de "plan actual" -- mismo criterio de siempre, sin cambios.
  const filasVisibles = (data ?? []).filter((row) => {
    const discipline = Array.isArray(row.discipline) ? row.discipline[0] : row.discipline;
    return !disciplinasDelPlan || disciplinasDelPlan.has(discipline.id);
  });

  // Agrupar TODAS las filas por disciplina (ya no solo la más reciente).
  const filasPorDisciplina = new Map<string, FilaRaw[]>();
  for (const row of filasVisibles) {
    const discipline = Array.isArray(row.discipline) ? row.discipline[0] : row.discipline;
    const lista = filasPorDisciplina.get(discipline.id) ?? [];
    lista.push(row);
    filasPorDisciplina.set(discipline.id, lista);
  }

  const ahora = Date.now();
  const resultado: UserCredit[] = [];

  for (const filas of filasPorDisciplina.values()) {
    // Ya vienen ordenadas desc por created_at (la query de arriba) -- la
    // primera es "la más reciente".
    const filaMasReciente = filas[0];
    const discipline = Array.isArray(filaMasReciente.discipline)
      ? filaMasReciente.discipline[0]
      : filaMasReciente.discipline;

    if (discipline.kind === 'membership') {
      // SIN CAMBIOS -- Aparatos no tiene lotes (es una membresía sin
      // cantidad, una sola fecha) -- sigue siendo la fila más reciente tal
      // cual, como antes de esta fase.
      resultado.push(mapRow(filaMasReciente, []));
      continue;
    }

    // Créditos -- lotes ACTIVOS (con saldo Y sin vencer), en orden FIFO
    // (el que vence antes, primero) -- mismo criterio que ya usa
    // book_class() del lado del servidor para descontar.
    const lotesActivos = filas
      .filter(
        (row) => (row.remaining_credits ?? 0) > 0 && !!row.expires_at && new Date(row.expires_at).getTime() > ahora
      )
      .sort((a, b) => new Date(a.expires_at as string).getTime() - new Date(b.expires_at as string).getTime());

    const lotes: CreditLote[] = lotesActivos.map((row) => ({
      id: row.id,
      remainingCredits: row.remaining_credits ?? 0,
      expiresAt: row.expires_at as string,
    }));
    const totalCreditos = lotes.reduce((suma, lote) => suma + lote.remainingCredits, 0);

    const base = mapRow(filaMasReciente, lotes);
    resultado.push({ ...base, remainingCredits: totalCreditos, expiresAt: lotes[0]?.expiresAt ?? null });
  }

  return resultado;
}

// Lo que arma formatCreditosDisponibles() -- separado en dos porque con
// 2+ lotes activos no alcanza una sola línea sin ser ambiguo (¿cuál de
// las fechas es la que importa?): `principal` es el total grande de
// siempre, `desglose` es la línea chica de abajo con el detalle por lote
// (null si no hace falta desglosar nada).
export interface CreditosDisponiblesTexto {
  principal: string;
  desglose: string | null;
}

// Con más de esta cantidad de lotes activos, se muestran los que vencen
// antes y el resto se resume como "y N más" -- para no romper el layout
// de la card con un socio que llegó a acumular muchas tandas sueltas
// (caso poco común, pero posible).
const MAX_LOTES_EN_DESGLOSE = 2;

// "YYYY-MM-DD" del día calendario en hora Argentina -- mismo criterio que
// ya usa acreditar_pack() para decidir si dos acreditaciones fusionan en
// un solo lote (ver supabase_migration_fix_zona_horaria_fusion_lotes.sql).
// Puramente para AGRUPAR EL TEXTO acá -- no toca ninguna fila real de
// user_credits.
function claveDiaArgentina(isoString: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Mendoza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoString));
}

interface LoteAgrupado {
  remainingCredits: number;
  expiresAt: string;
}

// Socios con 2+ lotes que vencen el MISMO día calendario (típico en datos
// de antes del fix de zona horaria de la fusión, que quedaron en filas
// separadas aunque deberían haber fusionado) se veían como líneas
// redundantes -- "8 vencen el 23/09 · 4 vencen el 23/09" en vez de "12
// vencen el 23/09". Se agrupan acá, en la presentación, ANTES de decidir
// cuántas líneas hacen falta -- `lotes` ya viene ordenado ascendente por
// expiresAt (fetchUserBalances), así que agrupar preservando el orden de
// primera aparición alcanza, sin reordenar nada.
function agruparLotesPorDiaArgentina(lotes: CreditLote[]): LoteAgrupado[] {
  const porDia = new Map<string, LoteAgrupado>();
  const orden: string[] = [];
  for (const lote of lotes) {
    const clave = claveDiaArgentina(lote.expiresAt);
    const existente = porDia.get(clave);
    if (existente) {
      existente.remainingCredits += lote.remainingCredits;
    } else {
      porDia.set(clave, { remainingCredits: lote.remainingCredits, expiresAt: lote.expiresAt });
      orden.push(clave);
    }
  }
  return orden.map((clave) => porDia.get(clave)!);
}

// Texto de saldo de créditos para Home/Perfil -- SIN el "X de Y" del
// tamaño del último pack comprado (bug real reportado: confundía a los
// socios -- "52 de 12" no tiene sentido una vez que se compró más de un
// pack a lo largo del tiempo, porque 52 es el ACUMULADO real y 12 es solo
// el tamaño de la ÚLTIMA compra, sin relación entre sí -- ver
// creditosOriginalesPara(), reemplazada por esto).
//
// Créditos por LOTES: ya no hay una sola fecha "de la fila" -- puede haber
// 2+ lotes activos de la misma disciplina con vencimientos distintos (ver
// fetchUserBalances). `lotes` viene en orden FIFO (el que vence antes,
// primero):
//   - 0 lotes activos (agotado/vencido): solo el saldo, sin fecha.
//   - 1 lote: el formato compacto de siempre, todo en `principal`.
//   - 2+ lotes: `principal` es el TOTAL sin fecha (mostrar una sola acá
//     sería, directamente, mostrar información incompleta) -- el detalle
//     va en `desglose`.
export function formatCreditosDisponibles(remainingCredits: number | null, lotes: CreditLote[] = []): CreditosDisponiblesTexto {
  const cantidad = remainingCredits ?? 0;
  const principal = cantidad === 1 ? '1 crédito disponible' : `${cantidad} créditos disponibles`;

  const lotesAgrupados = agruparLotesPorDiaArgentina(lotes);

  if (lotesAgrupados.length === 0) {
    return { principal, desglose: null };
  }

  if (lotesAgrupados.length === 1) {
    const verbo = cantidad === 1 ? 'vence' : 'vencen';
    return { principal: `${principal} · ${verbo} el ${formatShortDate(lotesAgrupados[0].expiresAt)}`, desglose: null };
  }

  const visibles = lotesAgrupados.slice(0, MAX_LOTES_EN_DESGLOSE);
  const partes = visibles.map((lote) => {
    const verboLote = lote.remainingCredits === 1 ? 'vence' : 'vencen';
    return `${lote.remainingCredits} ${verboLote} el ${formatShortDate(lote.expiresAt)}`;
  });
  const restantes = lotesAgrupados.length - visibles.length;
  if (restantes > 0) partes.push(`y ${restantes} más`);

  return { principal, desglose: partes.join(' · ') };
}
