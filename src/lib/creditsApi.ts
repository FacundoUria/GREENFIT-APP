import { supabase } from './supabase';
import { Pack, UserCredit, CreditoDePack, CreditLote } from '../types';
import { formatShortDate } from './dateFormat';
import { MembershipStatus } from './membershipStatus';

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

// El balance del socio para CADA disciplina en la que tenga algo REALMENTE
// vigente hoy (una entrada por disciplina, no una sola global).
//
// FIX (modelo de "plan único", acreditar_pack) -- esto filtraba por
// disciplinas_del_plan_actual()/socios.plan (el checkbox que Seba carga a
// mano en "Editar Socio"): tenía sentido bajo el modelo de LOTES viejo
// (arreglaba un bug real: "figuran activos Boxeo, Kickstrike y CrossFit"
// cuando el Admin solo tenía tildado Boxeo), pero socios.plan no tiene
// NINGUNA relación con qué acreditó la última compra real bajo el modelo
// nuevo -- un socio puede tener créditos reales y vigentes en una
// disciplina que nadie tildó a mano (caso real: Facundo Uria, DNI
// 44537978, con Kickstrike real pero sin tildar), y al revés, seguir
// tildado en una disciplina sin nada vigente (Boxeo, mismo socio). Ahora
// el ÚNICO criterio es directo sobre `user_credits`: ¿hay saldo real,
// vigente, hoy? -- ver el guard `if (lotesActivos.length === 0) continue`
// más abajo, que además cierra un segundo bug (una disciplina sin nada
// activo se seguía empujando al resultado con remainingCredits=0, y se
// mostraba como "Vencido" en vez de directamente no aparecer).
//
// Créditos por LOTES (ver supabase_migration_lotes_creditos_fase1/2.sql):
// una disciplina de créditos puede tener 2+ filas activas al mismo tiempo
// (compras distintas, vencimientos distintos) -- se agrupa TODO lo que
// tiene esa disciplina y se arma el total + el desglose real.
export async function fetchUserBalances(userId: string): Promise<UserCredit[]> {
  const [{ data, error }, { data: disciplinasData, error: discError }] = await Promise.all([
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

  // Agrupar TODAS las filas por disciplina (ya no solo la más reciente) --
  // sin filtrar por socios.plan para nada (ni créditos ni Aparatos): lo
  // que decide qué se muestra es, más abajo, si hay algo realmente vigente.
  const filasPorDisciplina = new Map<string, FilaRaw[]>();
  for (const row of data ?? []) {
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
      // FIX -- Aparatos se muestra ÚNICA Y EXCLUSIVAMENTE si hay una fila
      // realmente vigente (expires_at > ahora), sin importar qué diga
      // socios.plan (el filtro de arriba ya no aplica acá). Bajo el
      // modelo de "un solo plan activo" (acreditar_pack), comprar un pack
      // sin Aparatos apaga cualquier Aparatos anterior -- pero
      // socios.plan (los checkboxes de "Editar Socio") es un campo
      // separado que nadie destilda al comprar un pack, así que antes
      // seguía mostrando Aparatos igual (caso real: Facundo Uria, DNI
      // 44537978). Se busca la fila vigente entre TODAS las de esta
      // disciplina (no solo "la más reciente por created_at") -- por las
      // dudas de que la más reciente no sea la más vigente; con el
      // modelo nuevo nunca debería haber más de una vigente a la vez,
      // pero esto no depende de esa garantía para funcionar bien.
      const filaVigente = filas
        .filter((row) => !!row.expires_at && new Date(row.expires_at).getTime() > ahora)
        .sort((a, b) => new Date(b.expires_at as string).getTime() - new Date(a.expires_at as string).getTime())[0];
      if (filaVigente) {
        resultado.push(mapRow(filaVigente, []));
      }
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

    // FIX -- sin ningún lote activo, esta disciplina no se muestra, punto
    // (mismo criterio que ya tiene la rama de Aparatos arriba). Antes esto
    // faltaba: se empujaba igual un balance con remainingCredits=0, que
    // getCreditsStatus() lee como 'vencido' -- una disciplina con solo
    // residuo viejo (0 créditos reales) se mostraba como "0, Vencido" en
    // vez de no aparecer (caso real: Boxeo de Facundo Uria, DNI 44537978).
    if (lotesActivos.length === 0) continue;

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

// ============================================================
// Agrupamiento de vencimientos por FECHA (no por disciplina) -- mismo
// criterio y mismos textos que VencimientoCell en el Admin
// (SociosTabla.jsx): el socio tiene que ver exactamente lo mismo que ve
// Seba. Usado por la Hero Card de Inicio (HomeScreen.tsx) y "Plan actual"
// de Mi Perfil (PerfilMobileView.tsx) -- antes cada una tenía su propia
// fila POR DISCIPLINA (Aparatos + CrossFit venciendo el mismo día se veían
// como 2 filas repitiendo la fecha).
// ============================================================

// "A, B y C" -- listado en español sin coma de Oxford (idéntico a
// SociosTabla.jsx del Admin).
function listarConY(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

const ORDEN_STATUS: MembershipStatus[] = ['vencido', 'por_vencer', 'activo'];

// El estado "peor" entre varios -- para el badge de una fila que combina
// 2+ disciplinas: si CUALQUIERA está vencida, la fila entera se marca
// vencida (mejor avisar de más que de menos).
function peorStatus(estados: MembershipStatus[]): MembershipStatus {
  for (const candidato of ORDEN_STATUS) {
    if (estados.includes(candidato)) return candidato;
  }
  return 'activo';
}

export interface BalanceConEstado {
  balance: UserCredit;
  isMembership: boolean;
  status: MembershipStatus;
}

// Una fila YA lista para renderizar -- puede representar 1 sola disciplina
// (como hoy) o 2+ fusionadas porque comparten fecha exacta. `subDetalles`
// son líneas chicas debajo del detalle principal (ej. el balance real de
// una disciplina de créditos que quedó fusionada en el título con
// Aparatos, o el desglose de lotes de una disciplina con vencimientos
// propios en días distintos).
export interface FilaVencimiento {
  key: string;
  nombre: string;
  status: MembershipStatus;
  detalle: string;
  subDetalles: string[];
}

// Cada disciplina de créditos aporta una fecha al agrupamiento SOLO si sus
// lotes ya colapsan a un único día (agruparLotesPorDiaArgentina) -- si
// genuinamente tiene lotes en 2+ días distintos (raro), o no tiene ningún
// lote activo, o es Aparatos sin fecha cargada, queda afuera del
// agrupamiento y se muestra en su propia fila, exactamente como hoy.
export function agruparBalancesPorVencimiento(balancesConEstado: BalanceConEstado[]): FilaVencimiento[] {
  interface EntradaSimple {
    nombre: string;
    fechaISO: string;
    status: MembershipStatus;
    sub: string | null;
    original: BalanceConEstado;
  }
  const simples: EntradaSimple[] = [];
  const individuales: BalanceConEstado[] = [];

  for (const item of balancesConEstado) {
    const { balance: b, isMembership, status } = item;
    if (isMembership) {
      if (b.expiresAt) {
        simples.push({ nombre: 'Aparatos', fechaISO: b.expiresAt, status, sub: null, original: item });
      } else {
        individuales.push(item);
      }
      continue;
    }
    if (!b.lotes || b.lotes.length === 0) {
      individuales.push(item);
      continue;
    }
    const agrupados = agruparLotesPorDiaArgentina(b.lotes);
    if (agrupados.length === 1) {
      const cantidad = b.remainingCredits ?? 0;
      const sub = cantidad === 1 ? '1 crédito disponible' : `${cantidad} créditos disponibles`;
      simples.push({ nombre: b.discipline.name, fechaISO: agrupados[0].expiresAt, status, sub, original: item });
    } else {
      individuales.push(item);
    }
  }

  // Fila para una disciplina que quedó afuera del agrupamiento -- MISMO
  // texto que se mostraba antes de este cambio (solo el formato de fecha
  // pasa de formatLongDate a formatShortDate, para calzar con el Admin).
  function filaIndividual(item: BalanceConEstado): FilaVencimiento {
    const { balance: b, isMembership, status } = item;
    let detalle: string;
    const subDetalles: string[] = [];
    if (isMembership) {
      detalle = b.expiresAt
        ? `${status === 'vencido' ? 'Venció el' : 'Vence el'} ${formatShortDate(b.expiresAt)}`
        : 'Sin fecha de vencimiento cargada';
    } else {
      const texto = formatCreditosDisponibles(b.remainingCredits, b.lotes);
      detalle = texto.principal;
      if (texto.desglose) subDetalles.push(texto.desglose);
    }
    return { key: b.discipline.id, nombre: isMembership ? 'Aparatos' : b.discipline.name, status, detalle, subDetalles };
  }

  if (simples.length === 0) {
    return individuales.map(filaIndividual);
  }

  // Agrupar las entradas de fecha única por día calendario Argentina.
  const porDia = new Map<string, { fechaISO: string; entradas: EntradaSimple[] }>();
  const orden: string[] = [];
  for (const entrada of simples) {
    const clave = claveDiaArgentina(entrada.fechaISO);
    const existente = porDia.get(clave);
    if (existente) {
      existente.entradas.push(entrada);
    } else {
      porDia.set(clave, { fechaISO: entrada.fechaISO, entradas: [entrada] });
      orden.push(clave);
    }
  }
  const grupos = orden.map((clave) => porDia.get(clave)!);

  const filas: FilaVencimiento[] = [];

  if (grupos.length === 1 && individuales.length === 0 && grupos[0].entradas.length === 1) {
    // Caso trivial -- una sola disciplina en total, nada para fusionar.
    // Delega en filaIndividual() para reproducir EXACTO el texto de
    // siempre (para créditos, "N créditos disponibles · vence(n) el
    // dd/mm" en una sola línea vía formatCreditosDisponibles -- armar la
    // frase acá con `sub` la hubiera partido en 2 líneas redundantes, ej.
    // "Vence el..." + "CrossFit: N créditos disponibles").
    filas.push(filaIndividual(grupos[0].entradas[0].original));
  } else if (grupos.length === 1 && individuales.length === 0) {
    // TODO cae en una sola fecha, 2+ disciplinas -- "Ambos vencen"/"Las N
    // disciplinas vencen".
    const { fechaISO, entradas } = grupos[0];
    const cantidad = entradas.length;
    const detalle =
      cantidad === 2
        ? `Ambos vencen el ${formatShortDate(fechaISO)}`
        : `Las ${cantidad} disciplinas vencen el ${formatShortDate(fechaISO)}`;
    filas.push({
      key: entradas.map((e) => e.nombre).join('-'),
      nombre: listarConY(entradas.map((e) => e.nombre)),
      status: peorStatus(entradas.map((e) => e.status)),
      detalle,
      subDetalles: entradas.filter((e) => e.sub).map((e) => `${e.nombre}: ${e.sub}`),
    });
  } else {
    // 2+ fechas distintas -- una FILA por grupo (no una línea de texto por
    // grupo como en el Admin: acá cada fila ya tiene su propio badge).
    // Simplificación deliberada: con 2+ nombres en un mismo grupo se usa
    // siempre "vencen" en presente (sin distinguir "vencieron") -- mezclar
    // tiempos verbales por disciplina en una sola frase no vale la
    // complejidad para un caso ya de por sí poco común.
    for (const { fechaISO, entradas } of grupos) {
      const verbo =
        entradas.length === 1 ? (entradas[0].status === 'vencido' ? 'venció' : 'vence') : 'vencen';
      const nombreGrupo = listarConY(entradas.map((e) => e.nombre));
      filas.push({
        key: entradas.map((e) => e.nombre).join('-'),
        nombre: nombreGrupo,
        status: peorStatus(entradas.map((e) => e.status)),
        detalle: `${nombreGrupo} ${verbo} el ${formatShortDate(fechaISO)}`,
        // Con 1 sola disciplina en el grupo, `detalle` ya la nombra --
        // repetirla de nuevo acá abajo sería la 3ra vez en la misma fila
        // (encabezado + detalle + subDetalle).
        subDetalles: entradas
          .filter((e) => e.sub)
          .map((e) => (entradas.length > 1 ? `${e.nombre}: ${e.sub}` : e.sub!)),
      });
    }
    for (const item of individuales) filas.push(filaIndividual(item));
  }

  return filas;
}
