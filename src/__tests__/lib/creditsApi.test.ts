// Bug crítico (2026-08-07): "No hay packs disponibles" en la PWA pese a
// ver packs reales en el Admin -- la migración a combos (packs.creditos
// jsonb) le agregó ese campo con default '[]'::jsonb a TODAS las filas
// existentes sin migrar el dato real que ya tenían en discipline_id/
// credits/duration_days (columnas legacy). fetchPacks() descarta cualquier
// pack sin créditos válidos NI Aparatos por considerarlo un "combo vacío"
// -- exactamente lo que le pasaba a esos packs viejos hasta correr el
// backfill (ver backend/supabase_migration_planes_combos.sql, paso 3).
// Estos tests fijan esa regla de filtrado explícitamente.
const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args), rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { fetchPacks, buildPackSubtitle, formatCreditosDisponibles, fetchUserBalances } from '../../lib/creditsApi';
import { Pack } from '../../types';

function chainPacks(data: unknown[]) {
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.then = (resolve: any) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

const DISC_CROSSFIT = { id: 'disc-crossfit', name: 'CrossFit', is_active: true };
const DISC_BOXEO = { id: 'disc-boxeo', name: 'Boxeo', is_active: true };

describe('fetchPacks -- combos multi-disciplina', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockTablas(packsData: unknown[], disciplinasData: unknown[] = [DISC_CROSSFIT, DISC_BOXEO]) {
    mockFrom.mockImplementation((tabla: string) => {
      if (tabla === 'packs') return chainPacks(packsData);
      if (tabla === 'disciplines') return chainPacks(disciplinasData);
      throw new Error(`tabla inesperada: ${tabla}`);
    });
  }

  it('un pack "vacío" (creditos=[] e incluye_aparatos=false -- el bug exacto tras una migración sin backfill) se descarta', async () => {
    mockTablas([
      { id: 'pack-vacio', name: 'Pack fantasma', price: 10000, is_active: true, incluye_aparatos: false, dias_vigencia: null, creditos: [] },
    ]);
    const packs = await fetchPacks();
    expect(packs).toHaveLength(0);
  });

  it('un pack de una sola disciplina (creditos con 1 elemento) se mantiene', async () => {
    mockTablas([
      {
        id: 'pack-1',
        name: 'Pack 12 clases CrossFit',
        price: 30000,
        is_active: true,
        incluye_aparatos: false,
        dias_vigencia: null,
        creditos: [{ discipline_id: 'disc-crossfit', credits: 12 }],
      },
    ]);
    const packs = await fetchPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].creditos).toEqual([{ disciplineId: 'disc-crossfit', disciplineName: 'CrossFit', credits: 12 }]);
  });

  it('un combo real (2+ disciplinas) trae todas sus filas de créditos', async () => {
    mockTablas([
      {
        id: 'pack-combo',
        name: 'Combo 8+8',
        price: 55000,
        is_active: true,
        incluye_aparatos: false,
        dias_vigencia: null,
        creditos: [
          { discipline_id: 'disc-boxeo', credits: 8 },
          { discipline_id: 'disc-crossfit', credits: 8 },
        ],
      },
    ]);
    const packs = await fetchPacks();
    expect(packs[0].creditos).toEqual([
      { disciplineId: 'disc-boxeo', disciplineName: 'Boxeo', credits: 8 },
      { disciplineId: 'disc-crossfit', disciplineName: 'CrossFit', credits: 8 },
    ]);
  });

  it('un pase de Aparatos puro (creditos=[] pero incluye_aparatos=true) NO se descarta', async () => {
    mockTablas([
      { id: 'pack-aparatos', name: 'Pase 2 Meses Aparatos', price: 70000, is_active: true, incluye_aparatos: true, dias_vigencia: 60, creditos: [] },
    ]);
    const packs = await fetchPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ incluyeAparatos: true, diasVigencia: 60, creditos: [] });
  });

  it('activeOnly descarta un crédito cuya disciplina está desactivada, aunque el pack siga is_active=true', async () => {
    mockTablas(
      [
        {
          id: 'pack-1',
          name: 'Pack CrossFit',
          price: 10000,
          is_active: true,
          incluye_aparatos: false,
          dias_vigencia: null,
          creditos: [{ discipline_id: 'disc-crossfit', credits: 6 }],
        },
      ],
      [{ ...DISC_CROSSFIT, is_active: false }],
    );
    const packs = await fetchPacks({ activeOnly: true });
    expect(packs).toHaveLength(0);
  });
});

// Bug crítico reportado (Isa Giurato): el panel Admin decía "solo Boxeo (6
// créditos)" pero la PWA mostraba Boxeo + Kickstrike + CrossFit -- porque
// user_credits es un ledger append-only (nunca se borra una fila) y nada
// invalidaba las disciplinas que el admin ya había destildado. Fix: el
// plan ACTUAL de `socios` (vía el nuevo RPC disciplinas_del_plan_actual)
// es la única fuente de verdad -- lo que no está en ese set no se muestra,
// sin importar qué filas viejas siga teniendo el ledger.
describe('fetchUserBalances (single source of truth: el plan actual del admin filtra el ledger)', () => {
  beforeEach(() => jest.clearAllMocks());

  // expires_at en el futuro lejano (no null) -- créditos por lotes exige
  // una fecha real para que un lote cuente como "activo" (ver el describe
  // de más abajo); estas 3 filas son de antes de ese cambio y usaban
  // expires_at:null (ya no representa ningún dato real de producción,
  // donde acreditar_pack() siempre carga una fecha). Fecha fija muy lejana
  // (mismo criterio que RankingAdmin.test.jsx) para que el test nunca se
  // vuelva flaky por el paso del tiempo.
  const FILA_BOXEO = {
    id: 'uc-boxeo', user_id: 'user-1', remaining_credits: 6, expires_at: '2099-01-01T00:00:00.000Z', created_at: '2026-08-10T00:00:00.000Z',
    discipline: { id: 'disc-boxeo', name: 'Boxeo', kind: 'credits' }, pack: null,
  };
  const FILA_KICKSTRIKE = {
    id: 'uc-kick', user_id: 'user-1', remaining_credits: 9, expires_at: '2099-01-01T00:00:00.000Z', created_at: '2026-07-01T00:00:00.000Z',
    discipline: { id: 'disc-kick', name: 'Kickstrike', kind: 'credits' }, pack: null,
  };
  const FILA_CROSSFIT = {
    id: 'uc-crossfit', user_id: 'user-1', remaining_credits: 7, expires_at: '2099-01-01T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
    discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' }, pack: null,
  };

  function mockTablas(userCreditsData: unknown[]) {
    mockFrom.mockImplementation((tabla: string) => {
      if (tabla === 'user_credits') return chainPacks(userCreditsData);
      if (tabla === 'disciplines') return chainPacks([]);
      throw new Error(`tabla inesperada: ${tabla}`);
    });
  }

  it('caso Isa Giurato: plan actual = solo Boxeo -> la PWA descarta Kickstrike y CrossFit aunque el ledger los tenga', async () => {
    mockTablas([FILA_BOXEO, FILA_KICKSTRIKE, FILA_CROSSFIT]);
    mockRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { vinculado: true, discipline_ids: ['disc-boxeo'] }, error: null }),
    });

    const balances = await fetchUserBalances('user-1');

    expect(balances).toHaveLength(1);
    expect(balances[0].discipline.name).toBe('Boxeo');
    expect(balances[0].remainingCredits).toBe(6);
  });

  it('plan actual vacío (admin destildó todo) -> la PWA no muestra NADA, pese a tener 3 filas en el ledger', async () => {
    mockTablas([FILA_BOXEO, FILA_KICKSTRIKE, FILA_CROSSFIT]);
    mockRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { vinculado: true, discipline_ids: [] }, error: null }),
    });

    expect(await fetchUserBalances('user-1')).toHaveLength(0);
  });

  it('no vinculado (sin ficha en socios todavía) -> no filtra nada, muestra todo (fail open, mismo criterio que syncMyMembership)', async () => {
    mockTablas([FILA_BOXEO, FILA_KICKSTRIKE, FILA_CROSSFIT]);
    mockRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { vinculado: false, discipline_ids: null }, error: null }),
    });

    expect(await fetchUserBalances('user-1')).toHaveLength(3);
  });

  it('el RPC todavía no está desplegado (PGRST202) -> no filtra nada, mismo fail-open', async () => {
    mockTablas([FILA_BOXEO, FILA_KICKSTRIKE]);
    mockRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } }),
    });

    expect(await fetchUserBalances('user-1')).toHaveLength(2);
  });
});

// Créditos por LOTES (ver supabase_migration_lotes_creditos_fase1/2.sql):
// antes, fetchUserBalances() se quedaba con "la fila más reciente" por
// disciplina -- un socio con 2+ compras de la misma disciplina (fechas de
// vencimiento distintas) veía un balance incompleto. Ahora agrupa TODAS
// las filas activas y suma.
describe('fetchUserBalances (créditos por lotes -- suma y desglose real, no "la fila más reciente")', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockTablasSinFiltro(userCreditsData: unknown[]) {
    mockFrom.mockImplementation((tabla: string) => {
      if (tabla === 'user_credits') return chainPacks(userCreditsData);
      if (tabla === 'disciplines') return chainPacks([]);
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    // fail-open (sin ficha vinculada) -- no es lo que se está probando acá,
    // no debe filtrar nada.
    mockRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { vinculado: false, discipline_ids: null }, error: null }),
    });
  }

  const FUTURO_LEJANO = '2099-01-01T00:00:00.000Z';
  const FUTURO_MAS_LEJANO = '2099-06-01T00:00:00.000Z';
  const PASADO = '2020-01-01T00:00:00.000Z';

  it('un solo lote activo -- remainingCredits y expiresAt vienen de ese lote, lotes trae esa única entrada', async () => {
    mockTablasSinFiltro([
      {
        id: 'uc-1', user_id: 'user-1', remaining_credits: 4, expires_at: FUTURO_LEJANO, created_at: '2026-08-01T00:00:00.000Z',
        discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' }, pack: null,
      },
    ]);

    const [balance] = await fetchUserBalances('user-1');

    expect(balance.remainingCredits).toBe(4);
    expect(balance.expiresAt).toBe(FUTURO_LEJANO);
    expect(balance.lotes).toEqual([{ id: 'uc-1', remainingCredits: 4, expiresAt: FUTURO_LEJANO }]);
  });

  it('2 lotes activos de la misma disciplina, fechas distintas -- remainingCredits es la SUMA, lotes en orden FIFO (el que vence antes, primero)', async () => {
    mockTablasSinFiltro([
      // A propósito el que vence DESPUÉS tiene el created_at más reciente
      // -- el orden que importa acá es por expires_at, no por creación.
      {
        id: 'uc-nuevo', user_id: 'user-1', remaining_credits: 12, expires_at: FUTURO_MAS_LEJANO, created_at: '2026-09-01T00:00:00.000Z',
        discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' }, pack: null,
      },
      {
        id: 'uc-viejo', user_id: 'user-1', remaining_credits: 8, expires_at: FUTURO_LEJANO, created_at: '2026-08-01T00:00:00.000Z',
        discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' }, pack: null,
      },
    ]);

    const [balance] = await fetchUserBalances('user-1');

    expect(balance.remainingCredits).toBe(20); // 12 + 8, suma real
    expect(balance.expiresAt).toBe(FUTURO_LEJANO); // el que vence antes
    expect(balance.lotes).toEqual([
      { id: 'uc-viejo', remainingCredits: 8, expiresAt: FUTURO_LEJANO },
      { id: 'uc-nuevo', remainingCredits: 12, expiresAt: FUTURO_MAS_LEJANO },
    ]);
  });

  it('un lote vencido no cuenta -- ni en el total ni en lotes -- pero uno más viejo (por creación) con saldo vigente sí (caso que fallaba con "la fila más reciente")', async () => {
    mockTablasSinFiltro([
      // El "más reciente por creación" ya venció.
      {
        id: 'uc-nuevo-vencido', user_id: 'user-1', remaining_credits: 5, expires_at: PASADO, created_at: '2026-09-01T00:00:00.000Z',
        discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' }, pack: null,
      },
      // Uno más viejo, pero todavía vigente con saldo.
      {
        id: 'uc-viejo-vigente', user_id: 'user-1', remaining_credits: 3, expires_at: FUTURO_LEJANO, created_at: '2026-06-01T00:00:00.000Z',
        discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' }, pack: null,
      },
    ]);

    const [balance] = await fetchUserBalances('user-1');

    expect(balance.remainingCredits).toBe(3); // solo el vigente
    expect(balance.lotes).toEqual([{ id: 'uc-viejo-vigente', remainingCredits: 3, expiresAt: FUTURO_LEJANO }]);
  });

  it('un lote agotado (remaining_credits=0) no cuenta aunque no haya vencido', async () => {
    mockTablasSinFiltro([
      {
        id: 'uc-agotado', user_id: 'user-1', remaining_credits: 0, expires_at: FUTURO_LEJANO, created_at: '2026-08-01T00:00:00.000Z',
        discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' }, pack: null,
      },
    ]);

    const [balance] = await fetchUserBalances('user-1');

    expect(balance.remainingCredits).toBe(0);
    expect(balance.expiresAt).toBeNull();
    expect(balance.lotes).toEqual([]);
  });

  it('Aparatos (membership) sigue devolviendo la fila más reciente tal cual, SIN lotes -- no cambia nada', async () => {
    mockTablasSinFiltro([
      {
        id: 'uc-aparatos-nuevo', user_id: 'user-1', remaining_credits: null, expires_at: FUTURO_MAS_LEJANO, created_at: '2026-09-01T00:00:00.000Z',
        discipline: { id: 'disc-aparatos', name: 'Aparatos', kind: 'membership' }, pack: null,
      },
      {
        id: 'uc-aparatos-viejo', user_id: 'user-1', remaining_credits: null, expires_at: FUTURO_LEJANO, created_at: '2026-08-01T00:00:00.000Z',
        discipline: { id: 'disc-aparatos', name: 'Aparatos', kind: 'membership' }, pack: null,
      },
    ]);

    const [balance] = await fetchUserBalances('user-1');

    expect(balance.id).toBe('uc-aparatos-nuevo'); // la más reciente, no la que "vence antes"
    expect(balance.expiresAt).toBe(FUTURO_MAS_LEJANO);
    expect(balance.remainingCredits).toBeNull();
    expect(balance.lotes).toEqual([]);
  });
});

describe('buildPackSubtitle', () => {
  it('un combo de 2 disciplinas: "N créditos X + N créditos Y"', () => {
    const pack: Pack = {
      id: 'p1', name: 'Combo', price: 1, isActive: true, incluyeAparatos: false, diasVigencia: null,
      creditos: [
        { disciplineId: 'd1', disciplineName: 'Boxeo', credits: 8 },
        { disciplineId: 'd2', disciplineName: 'CrossFit', credits: 8 },
      ],
    };
    expect(buildPackSubtitle(pack)).toBe('8 créditos Boxeo + 8 créditos CrossFit');
  });

  it('Aparatos + créditos: "Aparatos + N créditos X"', () => {
    const pack: Pack = {
      id: 'p1', name: 'Combo', price: 1, isActive: true, incluyeAparatos: true, diasVigencia: 30,
      creditos: [{ disciplineId: 'd1', disciplineName: 'CrossFit', credits: 12 }],
    };
    expect(buildPackSubtitle(pack)).toBe('Aparatos + 12 créditos CrossFit');
  });

  it('Aparatos puro: "Aparatos Pase Libre"', () => {
    const pack: Pack = { id: 'p1', name: 'Pase', price: 1, isActive: true, incluyeAparatos: true, diasVigencia: 60, creditos: [] };
    expect(buildPackSubtitle(pack)).toBe('Aparatos Pase Libre');
  });
});

// Reemplaza al "X de Y clases restantes" (Y = tamaño del ÚLTIMO pack
// comprado) -- bug real reportado: confundía a los socios apenas compraban
// más de un pack en el tiempo, porque el acumulado real (X) y el tamaño de
// la última compra (Y) no tienen relación entre sí. Ahora se muestra el
// saldo real + cuándo vence esa vigencia -- y, con créditos por lotes, ya
// no alcanza una sola fecha si hay 2+ lotes activos con vencimientos
// distintos (ver `lotes`, `CreditosDisponiblesTexto`).
describe('formatCreditosDisponibles (reemplaza al "X de Y clases restantes", ahora por lotes)', () => {
  it('0 lotes activos (agotado/vencido) -- solo el saldo, sin la parte de vencimiento', () => {
    expect(formatCreditosDisponibles(0, [])).toEqual({ principal: '0 créditos disponibles', desglose: null })
  })

  it('0 lotes pero lotes no provisto (compatibilidad con código/mocks viejos) -- se trata como []', () => {
    expect(formatCreditosDisponibles(8)).toEqual({ principal: '8 créditos disponibles', desglose: null })
  })

  it('1 lote activo -- formato compacto de siempre, todo en `principal`, sin desglose', () => {
    const lotes = [{ id: 'l1', remainingCredits: 52, expiresAt: '2026-10-05T12:00:00.000Z' }]
    expect(formatCreditosDisponibles(52, lotes)).toEqual({
      principal: '52 créditos disponibles · vencen el 05/10/2026',
      desglose: null,
    })
  })

  it('1 lote con 1 solo crédito, concuerda en singular ("1 crédito disponible", "vence")', () => {
    const lotes = [{ id: 'l1', remainingCredits: 1, expiresAt: '2026-10-05T12:00:00.000Z' }]
    expect(formatCreditosDisponibles(1, lotes)).toEqual({
      principal: '1 crédito disponible · vence el 05/10/2026',
      desglose: null,
    })
  })

  it('2 lotes activos -- `principal` es el TOTAL sin fecha, `desglose` lista cada lote en el orden recibido (FIFO)', () => {
    const lotes = [
      { id: 'l-viejo', remainingCredits: 8, expiresAt: '2026-09-20T12:00:00.000Z' },
      { id: 'l-nuevo', remainingCredits: 12, expiresAt: '2026-10-15T12:00:00.000Z' },
    ]
    expect(formatCreditosDisponibles(20, lotes)).toEqual({
      principal: '20 créditos disponibles',
      desglose: '8 vencen el 20/09/2026 · 12 vencen el 15/10/2026',
    })
  })

  it('un lote de 1 solo crédito dentro del desglose concuerda en singular ("1 vence", no "1 vencen")', () => {
    const lotes = [
      { id: 'l-viejo', remainingCredits: 1, expiresAt: '2026-09-20T12:00:00.000Z' },
      { id: 'l-nuevo', remainingCredits: 12, expiresAt: '2026-10-15T12:00:00.000Z' },
    ]
    expect(formatCreditosDisponibles(13, lotes).desglose).toBe('1 vence el 20/09/2026 · 12 vencen el 15/10/2026')
  })

  it('3+ lotes -- muestra los 2 que vencen antes y resume el resto como "y N más" (no rompe el layout)', () => {
    const lotes = [
      { id: 'l1', remainingCredits: 4, expiresAt: '2026-09-10T12:00:00.000Z' },
      { id: 'l2', remainingCredits: 8, expiresAt: '2026-09-20T12:00:00.000Z' },
      { id: 'l3', remainingCredits: 12, expiresAt: '2026-10-15T12:00:00.000Z' },
    ]
    expect(formatCreditosDisponibles(24, lotes)).toEqual({
      principal: '24 créditos disponibles',
      desglose: '4 vencen el 10/09/2026 · 8 vencen el 20/09/2026 · y 1 más',
    })
  })

  it('ya NO menciona el tamaño del último pack comprado -- no depende de packs.creditos para nada', () => {
    // No recibe ningún `pack` como parámetro -- a propósito, ya no hay
    // ningún "de Y" que calcular.
    const lotes = [{ id: 'l1', remainingCredits: 52, expiresAt: '2026-10-05T12:00:00.000Z' }]
    expect(formatCreditosDisponibles(52, lotes).principal).not.toMatch(/de \d+/)
  })
});

// Caso real (Agustina Barbero): 2 lotes de la misma disciplina que vencen
// el MISMO día calendario en Argentina (típico de datos de antes del fix
// de zona horaria de la fusión, supabase_migration_fix_zona_horaria_fusion_
// lotes.sql, que quedaron en 2 filas separadas aunque deberían haber
// fusionado) se mostraban como líneas redundantes -- "8 vencen el 23/09 ·
// 4 vencen el 23/09" -- en vez de unificadas. Se agrupan acá, en la
// presentación, sin tocar ninguna fila real de user_credits.
describe('formatCreditosDisponibles -- agrupa lotes que vencen el MISMO día calendario en Argentina (fix Agustina Barbero)', () => {
  it('2 lotes el mismo día -- se unifican en 1 sola línea con la suma (mismo formato "1 lote" de siempre)', () => {
    // 8 (10:00 UTC) + 4 (18:00 UTC) -- ambos caen en 23/09 hora Argentina
    // (UTC-3): 07:00 y 15:00 del mismo día, lejos de cualquier borde de
    // medianoche.
    const lotes = [
      { id: 'l1', remainingCredits: 8, expiresAt: '2026-09-23T10:00:00.000Z' },
      { id: 'l2', remainingCredits: 4, expiresAt: '2026-09-23T18:00:00.000Z' },
    ]
    expect(formatCreditosDisponibles(12, lotes)).toEqual({
      principal: '12 créditos disponibles · vencen el 23/09/2026',
      desglose: null,
    })
  })

  it('lotes en DÍAS DISTINTOS siguen mostrándose separados -- sin cambios respecto de hoy', () => {
    const lotes = [
      { id: 'l-viejo', remainingCredits: 8, expiresAt: '2026-09-20T12:00:00.000Z' },
      { id: 'l-nuevo', remainingCredits: 4, expiresAt: '2026-09-23T12:00:00.000Z' },
    ]
    expect(formatCreditosDisponibles(12, lotes)).toEqual({
      principal: '12 créditos disponibles',
      desglose: '8 vencen el 20/09/2026 · 4 vencen el 23/09/2026',
    })
  })

  it('3 lotes -- 2 el mismo día + 1 en otro día -- agrupa primero y DESPUÉS aplica el tope de 2 líneas del desglose', () => {
    const lotes = [
      { id: 'l1', remainingCredits: 8, expiresAt: '2026-09-23T10:00:00.000Z' },
      { id: 'l2', remainingCredits: 4, expiresAt: '2026-09-23T18:00:00.000Z' }, // mismo día que l1 -- se funden en "12"
      { id: 'l3', remainingCredits: 6, expiresAt: '2026-10-15T12:00:00.000Z' },
    ]
    expect(formatCreditosDisponibles(18, lotes)).toEqual({
      principal: '18 créditos disponibles',
      desglose: '12 vencen el 23/09/2026 · 6 vencen el 15/10/2026',
    })
  })
})
