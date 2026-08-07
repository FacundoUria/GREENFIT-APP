jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import { getUserExerciseWeights, saveExerciseWeight } from '../../lib/routinesApi';

const mockedFrom = supabase.from as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'upsert'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('getUserExerciseWeights (carga real por ejercicio, independiente del checklist diario)', () => {
  it('arma un Map de routine_exercise_id -> última carga guardada', async () => {
    mockedFrom.mockImplementation(() =>
      makeChain({
        data: [
          { routine_exercise_id: 're-1', weight_used: '60kg' },
          { routine_exercise_id: 're-2', weight_used: '2x14kg' },
        ],
        error: null,
      })
    );

    const pesos = await getUserExerciseWeights('user-1');
    expect(pesos.get('re-1')).toBe('60kg');
    expect(pesos.get('re-2')).toBe('2x14kg');
    expect(pesos.size).toBe(2);
  });

  it('si la tabla todavía no existe (migración sin correr), devuelve un Map vacío en vez de romper', async () => {
    mockedFrom.mockImplementation(() =>
      makeChain({ data: null, error: { code: 'PGRST205', message: 'schema cache' } })
    );

    const pesos = await getUserExerciseWeights('user-1');
    expect(pesos.size).toBe(0);
  });

  it('un error real (no de tabla faltante) sí se propaga', async () => {
    mockedFrom.mockImplementation(() => makeChain({ data: null, error: { message: 'RLS violation' } }));

    await expect(getUserExerciseWeights('user-1')).rejects.toThrow('RLS violation');
  });
});

describe('saveExerciseWeight (upsert por socio+ejercicio)', () => {
  it('hace upsert con onConflict de user_id+routine_exercise_id', async () => {
    const chain = makeChain({ error: null });
    mockedFrom.mockImplementation(() => chain);

    await saveExerciseWeight('user-1', 're-1', '65kg');

    expect(mockedFrom).toHaveBeenCalledWith('routine_exercise_weights');
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', routine_exercise_id: 're-1', weight_used: '65kg' }),
      { onConflict: 'user_id,routine_exercise_id' }
    );
  });

  it('no rompe si la tabla todavía no existe -- el socio puede seguir editando en pantalla', async () => {
    mockedFrom.mockImplementation(() => makeChain({ error: { code: '42P01', message: 'undefined_table' } }));

    await expect(saveExerciseWeight('user-1', 're-1', '65kg')).resolves.toBeUndefined();
  });
});
