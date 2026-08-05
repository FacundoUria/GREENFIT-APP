import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import {
  calcularResumenXp,
  fetchTotalXp,
  otorgarXpPr,
  otorgarXpPost,
  checkXpDisponible,
  fetchAsistenciaHoyRegistrada,
  otorgarXpAsistenciaDiaria,
  fetchFechasAsistencia,
  calcularRachaDias,
  fetchClasesDelMes,
  XP_POR_NIVEL,
} from '../../lib/xpApi';

const mockedFrom = supabase.from as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'insert', 'limit', 'gte', 'lte'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
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

describe('otorgarXpPr / otorgarXpPost', () => {
  afterEach(() => jest.clearAllMocks());

  it('otorgarXpPr no rompe si xp_events todavía no existe', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'no existe' } }));
    await expect(otorgarXpPr('user-1')).resolves.toBeUndefined();
  });

  it('otorgarXpPost no rompe si ya se ganó el XP de hoy (23505 unique_violation)', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } }));
    await expect(otorgarXpPost('user-1')).resolves.toBeUndefined();
  });

  it('otorgarXpPost inserta event_type=post, xp_amount=25 en el camino feliz', async () => {
    const insertMock = jest.fn().mockResolvedValue({ data: null, error: null });
    mockedFrom.mockReturnValue({ insert: insertMock });
    await otorgarXpPost('user-1');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', event_type: 'post', xp_amount: 25 })
    );
  });
});

describe('checkXpDisponible', () => {
  afterEach(() => jest.clearAllMocks());

  it('devuelve false si xp_events todavía no existe', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'no existe' } }));
    expect(await checkXpDisponible()).toBe(false);
  });

  it('devuelve true si la tabla responde', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: [], error: null }));
    expect(await checkXpDisponible()).toBe(true);
  });
});

describe('Botón "¡Hoy entrené!" -- asistencia diaria autoreportada', () => {
  const userId = 'user-hoy-entrene';

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('real: fetchAsistenciaHoyRegistrada es false si no hay fila de hoy', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: null }));
    expect(await fetchAsistenciaHoyRegistrada(userId, false)).toBe(false);
  });

  it('real: otorgarXpAsistenciaDiaria inserta +100 XP event_type=asistencia', async () => {
    const insertMock = jest.fn().mockResolvedValue({ data: null, error: null });
    mockedFrom.mockReturnValue({ insert: insertMock });
    const resultado = await otorgarXpAsistenciaDiaria(userId, false);
    expect(resultado).toBe('otorgado');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: userId, event_type: 'asistencia', xp_amount: 100 })
    );
  });

  it('real: un segundo intento el mismo día (23505, ya sea por trigger de clase o por el botón) no rompe', async () => {
    mockedFrom.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } }),
    });
    expect(await otorgarXpAsistenciaDiaria(userId, false)).toBe('ya_registrado_hoy');
  });

  it('demo: arranca sin registrar, otorgar lo marca, y queda registrado hasta que cambia el día', async () => {
    expect(await fetchAsistenciaHoyRegistrada(userId, true)).toBe(false);
    expect(await otorgarXpAsistenciaDiaria(userId, true)).toBe('otorgado');
    expect(await fetchAsistenciaHoyRegistrada(userId, true)).toBe(true);
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

describe('fetchClasesDelMes (fix del bug: antes mostraba el total histórico bajo la etiqueta "Clases")', () => {
  afterEach(() => jest.clearAllMocks());

  it('cuenta días DISTINTOS con asistencia real dentro del mes en curso', async () => {
    mockedFrom.mockReturnValue(
      makeChain({ data: [{ event_date: '2026-08-01' }, { event_date: '2026-08-02' }, { event_date: '2026-08-02' }], error: null })
    );
    expect(await fetchClasesDelMes('user-1')).toBe(2);
  });

  it('si xp_events todavía no existe, cae al conteo de bookings.attended del mes', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'xp_events') {
        return makeChain({ data: null, error: { code: '42P01', message: 'no existe' } });
      }
      return makeChain({ data: null, error: null, count: 5 });
    });
    expect(await fetchClasesDelMes('user-1')).toBe(5);
  });
});
