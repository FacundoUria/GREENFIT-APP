jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import {
  calcularResumenXp,
  fetchTotalXp,
  fetchAsistenciaHoyRegistrada,
  fetchFechasAsistencia,
  calcularRachaDias,
  fetchClasesDelMes,
  calcularInicioCicloDeCorte,
  fetchEntrenamientosHoy,
  registrarHoyEntrene,
  XP_POR_NIVEL,
} from '../../lib/xpApi';

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'insert', 'limit', 'gte', 'lte', 'is'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.single = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('calcularResumenXp (500 XP = 1 nivel)', () => {
  it('nivel 1 con 0 XP', () => {
    expect(calcularResumenXp(0)).toEqual({ totalXp: 0, nivel: 1, xpEnNivel: 0, xpParaSubir: 500 });
  });

  it('sube de nivel exactamente cada 500 XP', () => {
    expect(calcularResumenXp(499).nivel).toBe(1);
    expect(calcularResumenXp(500).nivel).toBe(2);
    expect(calcularResumenXp(999).nivel).toBe(2);
    expect(calcularResumenXp(1000).nivel).toBe(3);
  });

  it('calcula el progreso dentro del nivel actual', () => {
    const resumen = calcularResumenXp(650);
    expect(resumen.nivel).toBe(2);
    expect(resumen.xpEnNivel).toBe(150);
    expect(resumen.xpParaSubir).toBe(XP_POR_NIVEL - 150);
  });

  it('nunca da XP negativo (defensivo)', () => {
    expect(calcularResumenXp(-50).totalXp).toBe(0);
  });
});

describe('fetchTotalXp', () => {
  afterEach(() => jest.clearAllMocks());

  it('suma los eventos reales de xp_events cuando la tabla existe', async () => {
    mockedFrom.mockReturnValue(
      makeChain({ data: [{ xp_amount: 100 }, { xp_amount: 150 }, { xp_amount: 25 }], error: null })
    );
    expect(await fetchTotalXp('user-1')).toBe(275);
  });

  it('si xp_events todavía no existe, estima XP desde clases con asistencia real (100 c/u)', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'xp_events') {
        return makeChain({ data: null, error: { code: '42P01', message: 'relation "xp_events" does not exist' } });
      }
      return makeChain({ data: null, error: null, count: 7 });
    });
    expect(await fetchTotalXp('user-1')).toBe(700);
  });
});

// otorgarXpPr/otorgarXpPost/checkXpDisponible/otorgarXpAsistenciaDiaria se
// dieron de baja -- el socio ya no tiene ninguna vía de autoreporte de XP
// (ver backend/supabase_migration_xp_solo_asistencia.sql). fetchAsistenciaHoyRegistrada
// pasa a ser de SOLO LECTURA, sin el parámetro modoDemo (ya no hay AsyncStorage
// de por medio: si xp_events no existe, no hay forma real de saber si el
// Admin ya acreditó hoy, así que simplemente responde `false`).
describe('fetchAsistenciaHoyRegistrada (solo lectura -- refleja lo que acreditó el Admin)', () => {
  afterEach(() => jest.clearAllMocks());

  it('false si no hay fila de asistencia de hoy', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: null }));
    expect(await fetchAsistenciaHoyRegistrada('user-1')).toBe(false);
  });

  it('true si el Admin (o el trigger de clase) ya acreditó la asistencia de hoy', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: { id: 'xp-1' }, error: null }));
    expect(await fetchAsistenciaHoyRegistrada('user-1')).toBe(true);
  });

  it('si xp_events todavía no existe, responde false en vez de romper', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'no existe' } }));
    expect(await fetchAsistenciaHoyRegistrada('user-1')).toBe(false);
  });
});

describe('calcularRachaDias (racha real -- días consecutivos contando hacia atrás desde hoy)', () => {
  it('0 si no hay ningún registro', () => {
    expect(calcularRachaDias([])).toBe(0);
  });

  it('cuenta los días consecutivos hasta HOY si hoy ya se registró', () => {
    const hoy = new Date('2026-08-10T12:00:00');
    const fechas = ['2026-08-10', '2026-08-09', '2026-08-08', '2026-08-05'];
    // 10, 9 y 8 son consecutivos -- el 5 queda afuera porque el 7 y el 6
    // faltan (corta la racha ahí).
    expect(calcularRachaDias(fechas, hoy)).toBe(3);
  });

  it('si hoy todavía no se registró, sigue contando desde ayer (no se "apaga" antes de tiempo)', () => {
    const hoy = new Date('2026-08-10T09:00:00');
    const fechas = ['2026-08-09', '2026-08-08'];
    expect(calcularRachaDias(fechas, hoy)).toBe(2);
  });

  it('se reinicia a 0 si ni hoy ni ayer tienen registro (la secuencia se rompió)', () => {
    const hoy = new Date('2026-08-10T12:00:00');
    const fechas = ['2026-08-01'];
    expect(calcularRachaDias(fechas, hoy)).toBe(0);
  });
});

describe('fetchFechasAsistencia', () => {
  afterEach(() => jest.clearAllMocks());

  it('real: devuelve las fechas distintas de event_type=asistencia', async () => {
    mockedFrom.mockReturnValue(
      makeChain({ data: [{ event_date: '2026-08-10' }, { event_date: '2026-08-10' }, { event_date: '2026-08-09' }], error: null })
    );
    const fechas = await fetchFechasAsistencia('user-1');
    expect(fechas.sort()).toEqual(['2026-08-09', '2026-08-10']);
  });

  it('si xp_events todavía no existe, cae a las fechas de bookings.attended', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'xp_events') {
        return makeChain({ data: null, error: { code: '42P01', message: 'no existe' } });
      }
      return makeChain({ data: [{ booking_date: '2026-08-10' }], error: null });
    });
    expect(await fetchFechasAsistencia('user-1')).toEqual(['2026-08-10']);
  });
});

// calcularInicioCicloDeCorte: decisión de negocio confirmada -- "Clases del
// mes" cuenta desde el último corte/renovación del socio (socios.dia_corte),
// no desde el 1° del mes calendario. Función pura, sin red de por medio.
describe('calcularInicioCicloDeCorte (día 1 al 31 -> primer día del ciclo vigente)', () => {
  it('hoy ANTES del día de corte de este mes -- el ciclo arrancó el mes anterior', () => {
    const hoy = new Date(2026, 7, 5); // 5/ago/2026, corte el 10
    expect(calcularInicioCicloDeCorte(10, hoy)).toBe('2026-07-10');
  });

  it('hoy DESPUÉS del día de corte de este mes -- el ciclo arrancó este mes', () => {
    const hoy = new Date(2026, 7, 15); // 15/ago/2026, corte el 10
    expect(calcularInicioCicloDeCorte(10, hoy)).toBe('2026-08-10');
  });

  it('hoy es EXACTAMENTE el día de corte -- cuenta como "ya llegó", el ciclo arranca hoy mismo', () => {
    const hoy = new Date(2026, 7, 10); // 10/ago/2026, corte el 10
    expect(calcularInicioCicloDeCorte(10, hoy)).toBe('2026-08-10');
  });

  it('cruza de año -- enero antes del corte cae en diciembre del año anterior', () => {
    const hoy = new Date(2026, 0, 3); // 3/ene/2026, corte el 20
    expect(calcularInicioCicloDeCorte(20, hoy)).toBe('2025-12-20');
  });

  it('clamp defensivo: dia_corte=31 con el mes anterior de solo 28/29/30 días usa su último día real', () => {
    const hoy = new Date(2026, 2, 5); // 5/mar/2026 (no bisiesto), corte el 31 -> mes anterior: febrero
    expect(calcularInicioCicloDeCorte(31, hoy)).toBe('2026-02-28');
  });

  // El caso que ya rompía antes de este fix: 1° del mes calendario con un
  // dia_corte tarde en el mes -- exactamente el escenario real reportado
  // (HOY_STR + AYER_STR de los fixtures E2E, que caen en meses calendario
  // distintos cuando "hoy" es el 1°).
  it('caso real que rompía: hoy es el 1° del mes calendario, dia_corte tarde en el mes anterior', () => {
    const hoy = new Date(2026, 8, 1); // 1/sep/2026, corte el 25
    expect(calcularInicioCicloDeCorte(25, hoy)).toBe('2026-08-25');
  });
});

describe('fetchClasesDelMes (cuenta desde el corte del socio -- fix del bug real: rompía el 1° del mes calendario)', () => {
  afterEach(() => jest.clearAllMocks());

  function mockDiaCorte(resultado: { vinculado: boolean; dia_corte: number | null } | null, error: any = null) {
    mockedRpc.mockReturnValue({ single: jest.fn().mockResolvedValue({ data: resultado, error }) });
  }

  it('cuenta días DISTINTOS con asistencia real dentro del ciclo de corte vigente', async () => {
    mockDiaCorte({ vinculado: true, dia_corte: 10 });
    const chain = makeChain({
      data: [{ event_date: '2026-08-10' }, { event_date: '2026-08-12' }, { event_date: '2026-08-12' }],
      error: null,
    });
    mockedFrom.mockReturnValue(chain);

    expect(await fetchClasesDelMes('user-1')).toBe(2);
    expect(mockedRpc).toHaveBeenCalledWith('mi_dia_corte');
  });

  // El caso real reportado: hoy 1° de septiembre, dia_corte tarde en agosto
  // -- una asistencia de ayer (31/ago) y una de hoy (1/sep) tienen que
  // contar juntas (2), algo que el cálculo viejo (1° del mes calendario)
  // no podía dar nunca porque quedaban en meses distintos.
  it('hoy antes del corte de este mes: el rango arranca en el corte del mes anterior', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 1)); // 1/sep/2026
    mockDiaCorte({ vinculado: true, dia_corte: 25 });
    const chain = makeChain({
      data: [{ event_date: '2026-08-31' }, { event_date: '2026-09-01' }],
      error: null,
    });
    mockedFrom.mockReturnValue(chain);

    expect(await fetchClasesDelMes('user-1')).toBe(2);
    expect(chain.gte).toHaveBeenCalledWith('event_date', '2026-08-25');
    expect(chain.lte).toHaveBeenCalledWith('event_date', '2026-09-01');

    jest.useRealTimers();
  });

  it('hoy después (o igual) del corte de este mes: el rango arranca en el corte de este mes', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 20)); // 20/ago/2026
    mockDiaCorte({ vinculado: true, dia_corte: 10 });
    const chain = makeChain({ data: [{ event_date: '2026-08-15' }], error: null });
    mockedFrom.mockReturnValue(chain);

    expect(await fetchClasesDelMes('user-1')).toBe(1);
    expect(chain.gte).toHaveBeenCalledWith('event_date', '2026-08-10');

    jest.useRealTimers();
  });

  // Fail-open (mismo criterio que disciplinas_del_plan_actual/
  // sync_my_membership): sin ficha vinculada en `socios`, o el RPC
  // mi_dia_corte todavía no está desplegado, se cae al 1° del mes
  // calendario -- el comportamiento de siempre -- en vez de romper la
  // pantalla del socio.
  it('sin ficha vinculada en socios (vinculado=false), cae al 1° del mes calendario', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 20));
    mockDiaCorte({ vinculado: false, dia_corte: null });
    const chain = makeChain({ data: [{ event_date: '2026-08-05' }], error: null });
    mockedFrom.mockReturnValue(chain);

    expect(await fetchClasesDelMes('user-1')).toBe(1);
    expect(chain.gte).toHaveBeenCalledWith('event_date', '2026-08-01');

    jest.useRealTimers();
  });

  it('si el RPC mi_dia_corte todavía no existe en este ambiente, cae al 1° del mes calendario', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 20));
    mockDiaCorte(null, { code: 'PGRST202', message: 'function not found in schema cache' });
    const chain = makeChain({ data: [{ event_date: '2026-08-05' }], error: null });
    mockedFrom.mockReturnValue(chain);

    expect(await fetchClasesDelMes('user-1')).toBe(1);
    expect(chain.gte).toHaveBeenCalledWith('event_date', '2026-08-01');

    jest.useRealTimers();
  });

  it('si xp_events todavía no existe, cae al conteo de bookings.attended del ciclo vigente', async () => {
    mockDiaCorte({ vinculado: true, dia_corte: 10 });
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'xp_events') {
        return makeChain({ data: null, error: { code: '42P01', message: 'no existe' } });
      }
      return makeChain({ data: null, error: null, count: 5 });
    });
    expect(await fetchClasesDelMes('user-1')).toBe(5);
  });
});

// "Hoy Entrené" -- reincorporación puntual del autoreporte (con tope diario
// real, ver PAGINA SUPABASE/supabase_migration_hoy_entrene.sql), NO un
// regreso al autoreporte libre de antes.
describe('fetchEntrenamientosHoy (de solo lectura -- para pintar el estado inicial del botón)', () => {
  afterEach(() => jest.clearAllMocks());

  it('cuenta los autoreportes de HOY (event_type=asistencia, discipline_id null)', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: [{ id: 'xp-1' }, { id: 'xp-2' }], error: null }));
    expect(await fetchEntrenamientosHoy('user-1')).toBe(2);
  });

  it('0 si todavía no usó el botón hoy', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: [], error: null }));
    expect(await fetchEntrenamientosHoy('user-1')).toBe(0);
  });

  it('si xp_events todavía no existe, responde 0 en vez de romper', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'no existe' } }));
    expect(await fetchEntrenamientosHoy('user-1')).toBe(0);
  });
});

describe('registrarHoyEntrene (único punto de escritura -- el RPC hace todo el enforcement real)', () => {
  afterEach(() => jest.clearAllMocks());

  it('mapea la fila del RPC (snake_case) a camelCase', async () => {
    mockedRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: { otorgado: true, xp_otorgado: 100, entrenamientos_hoy: 1, entrenamientos_maximos: 2 },
        error: null,
      }),
    });

    const resultado = await registrarHoyEntrene();

    expect(mockedRpc).toHaveBeenCalledWith('registrar_hoy_entrene');
    expect(resultado).toEqual({ otorgado: true, xpOtorgado: 100, entrenamientosHoy: 1, entrenamientosMaximos: 2 });
  });

  it('otorgado=false (llegó al tope) también se resuelve normal, sin XP', async () => {
    mockedRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: { otorgado: false, xp_otorgado: 0, entrenamientos_hoy: 2, entrenamientos_maximos: 2 },
        error: null,
      }),
    });

    const resultado = await registrarHoyEntrene();
    expect(resultado.otorgado).toBe(false);
    expect(resultado.xpOtorgado).toBe(0);
  });

  it('un error del RPC (ej. sin disciplinas activas) se propaga como excepción con el mensaje real', async () => {
    mockedRpc.mockReturnValue({
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Todavía no tenés ninguna disciplina activa -- no hay ningún entrenamiento que registrar hoy.' },
      }),
    });

    await expect(registrarHoyEntrene()).rejects.toThrow('Todavía no tenés ninguna disciplina activa');
  });
});
