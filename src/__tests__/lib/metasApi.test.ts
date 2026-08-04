import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import {
  checkMetasDisponible,
  fetchMetaActiva,
  crearMeta,
  completarMeta,
  diasParaCompletar,
  DIAS_MINIMOS_PARA_COMPLETAR,
  MetaPersonal,
} from '../../lib/metasApi';

const mockedFrom = supabase.from as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'is', 'limit'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('diasParaCompletar', () => {
  function metaCreadaHace(dias: number): MetaPersonal {
    return {
      id: 'm1',
      texto: 'Bajar 5kg',
      createdAt: new Date(Date.now() - dias * 86_400_000).toISOString(),
      completedAt: null,
    };
  }

  it('recién creada: faltan los 7 días completos', () => {
    expect(diasParaCompletar(metaCreadaHace(0))).toBe(DIAS_MINIMOS_PARA_COMPLETAR);
  });

  it('a mitad de camino: quedan menos días', () => {
    expect(diasParaCompletar(metaCreadaHace(3))).toBe(4);
  });

  it('con 7 días o más: ya se puede completar (0)', () => {
    expect(diasParaCompletar(metaCreadaHace(7))).toBe(0);
    expect(diasParaCompletar(metaCreadaHace(10))).toBe(0);
  });
});

describe('checkMetasDisponible', () => {
  afterEach(() => jest.clearAllMocks());

  it('devuelve false si metas_personales todavía no existe', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'no existe' } }));
    expect(await checkMetasDisponible()).toBe(false);
  });

  it('devuelve true si la tabla responde', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: [], error: null }));
    expect(await checkMetasDisponible()).toBe(true);
  });
});

describe('Metas en modo demo (AsyncStorage)', () => {
  const userId = 'user-test-metas';

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('arranca sin meta activa', async () => {
    expect(await fetchMetaActiva(userId, true)).toBeNull();
  });

  it('crear una meta la deja como activa', async () => {
    await crearMeta(userId, 'Hacer 10 dominadas', true);
    const activa = await fetchMetaActiva(userId, true);
    expect(activa?.texto).toBe('Hacer 10 dominadas');
    expect(activa?.completedAt).toBeNull();
  });

  it('no permite crear una segunda meta mientras haya una activa', async () => {
    await crearMeta(userId, 'Meta 1', true);
    await expect(crearMeta(userId, 'Meta 2', true)).rejects.toThrow(/ya tenés una meta activa/i);
  });

  it('no permite completarla antes de los 7 días', async () => {
    await crearMeta(userId, 'Meta reciente', true);
    const activa = await fetchMetaActiva(userId, true);
    await expect(completarMeta(userId, activa!, true)).rejects.toThrow(/7 días/);
  });

  it('permite completarla pasados los 7 días y libera el slot para una nueva', async () => {
    const metaVieja: MetaPersonal = {
      id: 'local-vieja',
      texto: 'Meta vieja',
      createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      completedAt: null,
    };
    await completarMeta(userId, metaVieja, true);
    expect(await fetchMetaActiva(userId, true)).toBeNull();

    // Con el slot libre, ahora sí se puede crear una nueva.
    await crearMeta(userId, 'Meta nueva', true);
    expect((await fetchMetaActiva(userId, true))?.texto).toBe('Meta nueva');
  });
});
