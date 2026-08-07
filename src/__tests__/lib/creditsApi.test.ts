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
jest.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { fetchPacks, buildPackSubtitle, creditosOriginalesPara } from '../../lib/creditsApi';
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

describe('creditosOriginalesPara', () => {
  const pack: Pack = {
    id: 'p1', name: 'Combo', price: 1, isActive: true, incluyeAparatos: false, diasVigencia: null,
    creditos: [
      { disciplineId: 'd-boxeo', disciplineName: 'Boxeo', credits: 8 },
      { disciplineId: 'd-crossfit', disciplineName: 'CrossFit', credits: 8 },
    ],
  };

  it('devuelve los créditos originales de la disciplina puntual dentro del combo', () => {
    expect(creditosOriginalesPara(pack, 'd-boxeo')).toBe(8);
  });

  it('sin pack (crédito cargado a mano por el admin), devuelve null', () => {
    expect(creditosOriginalesPara(null, 'd-boxeo')).toBeNull();
    expect(creditosOriginalesPara(undefined, 'd-boxeo')).toBeNull();
  });

  it('una disciplina que no está en el combo devuelve null', () => {
    expect(creditosOriginalesPara(pack, 'd-kickboxing')).toBeNull();
  });
});
