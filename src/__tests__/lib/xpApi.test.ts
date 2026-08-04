jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import { calcularResumenXp, fetchTotalXp, otorgarXpPr, otorgarXpPost, XP_POR_NIVEL } from '../../lib/xpApi';

const mockedFrom = supabase.from as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'insert'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
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
});
