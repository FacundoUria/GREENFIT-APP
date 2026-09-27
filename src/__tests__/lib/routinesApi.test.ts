jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import {
  getUserExerciseWeights,
  saveExerciseWeight,
  finalizarEntrenamiento,
  getRoutineHistory,
  eliminarSesionHistorial,
  agruparHistorial,
} from '../../lib/routinesApi';

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'upsert', 'order', 'limit'].forEach((m) => {
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

describe('eliminarSesionHistorial (RPC: borra la sesión completa, solo del dueño)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('llama al RPC con el sesion_id y devuelve cuántas filas borró', async () => {
    mockedRpc.mockResolvedValue({ data: 3, error: null });

    await expect(eliminarSesionHistorial('s-1')).resolves.toBe(3);
    expect(mockedRpc).toHaveBeenCalledWith('eliminar_sesion_historial', { p_sesion_id: 's-1' });
  });

  it('0 filas (no existía / no era suya) no es un error', async () => {
    mockedRpc.mockResolvedValue({ data: 0, error: null });
    await expect(eliminarSesionHistorial('s-x')).resolves.toBe(0);
  });

  it('nunca borra directo sobre la tabla (sin policy de delete, todo pasa por el RPC)', async () => {
    mockedRpc.mockResolvedValue({ data: 1, error: null });
    await eliminarSesionHistorial('s-1');
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('si la función todavía no existe (v2 sin correr), avisa con un error claro', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    await expect(eliminarSesionHistorial('s-1')).rejects.toThrow('falta actualizar el servidor');
  });

  it('un error real se propaga', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { message: 'No autenticado' } });
    await expect(eliminarSesionHistorial('s-1')).rejects.toThrow('No autenticado');
  });
});

describe('finalizarEntrenamiento (RPC con ventana de 10 s y tope diario en el servidor)', () => {
  const items = [{ nombre: 'Sentadilla', grupo: 'Piernas', series: 4, repeticiones: '10', peso: '60kg' }];

  beforeEach(() => jest.clearAllMocks());

  it('manda título del día, total y los ejercicios marcados al RPC', async () => {
    mockedRpc.mockResolvedValue({
      data: { registrado: true, sesion_id: 's-1', disponible_desde: '2026-09-27T19:00:00Z' },
      error: null,
    });

    const r = await finalizarEntrenamiento('Día 1 - Tren Inferior', 5, items);

    expect(r).toEqual({ estado: 'registrado' });
    expect(mockedRpc).toHaveBeenCalledWith('finalizar_entrenamiento', {
      p_titulo_dia: 'Día 1 - Tren Inferior',
      p_total_ejercicios: 5,
      p_items: items,
    });
  });

  it('motivo "reciente" (ventana de 10 s del servidor) -> estado reciente', async () => {
    mockedRpc.mockResolvedValue({
      data: { registrado: false, sesion_id: null, motivo: 'reciente', disponible_desde: '2026-09-27T21:42:10Z' },
      error: null,
    });

    const r = await finalizarEntrenamiento('Día 1', 5, items);
    expect(r).toEqual({ estado: 'reciente' });
  });

  it('motivo "tope_diario" (20 por día) -> estado tope_diario', async () => {
    mockedRpc.mockResolvedValue({
      data: { registrado: false, sesion_id: null, motivo: 'tope_diario', disponible_desde: null },
      error: null,
    });

    const r = await finalizarEntrenamiento('Día 1', 5, items);
    expect(r).toEqual({ estado: 'tope_diario' });
  });

  it('registrado=false SIN motivo (función vieja, antes de correr la v2) se trata como "reciente"', async () => {
    mockedRpc.mockResolvedValue({
      data: { registrado: false, sesion_id: null, disponible_desde: '2026-09-27T21:42:00Z' },
      error: null,
    });

    const r = await finalizarEntrenamiento('Día 1', 5, items);
    expect(r).toEqual({ estado: 'reciente' });
  });

  it('si la función todavía no existe (migración sin correr), devuelve no_disponible sin romper', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });

    const r = await finalizarEntrenamiento('Día 1', 5, items);
    expect(r).toEqual({ estado: 'no_disponible' });
    warn.mockRestore();
  });

  it('un error real se propaga', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { message: 'No autenticado' } });
    await expect(finalizarEntrenamiento('Día 1', 5, items)).rejects.toThrow('No autenticado');
  });
});

function fila(overrides: Record<string, unknown>) {
  return {
    id: 'h',
    sesion_id: 's-1',
    fecha: '2026-09-26',
    titulo_dia: 'Día 1',
    nombre_ejercicio: 'Sentadilla',
    grupo_muscular: 'Piernas',
    series: 4,
    repeticiones: '10',
    peso: '60kg',
    orden: 0,
    total_ejercicios: 2,
    completo: false,
    created_at: '2026-09-26T12:00:00Z',
    ...overrides,
  } as any;
}

describe('agruparHistorial (filas planas -> días -> sesiones -> ejercicios)', () => {
  it('agrupa por día (más reciente primero) y separa dos finalizaciones del mismo día', () => {
    const dias = agruparHistorial([
      fila({ id: 'a', sesion_id: 'manana', created_at: '2026-09-26T11:00:00Z' }),
      fila({ id: 'b', sesion_id: 'tarde', created_at: '2026-09-26T21:00:00Z' }),
      fila({ id: 'c', sesion_id: 'ayer', fecha: '2026-09-25', created_at: '2026-09-25T20:00:00Z' }),
    ]);

    expect(dias.map((d) => d.fecha)).toEqual(['2026-09-26', '2026-09-25']);
    expect(dias[0].sesiones.map((s) => s.sesionId)).toEqual(['tarde', 'manana']);
    expect(dias[1].sesiones).toHaveLength(1);
  });

  it('respeta el orden de la rutina dentro de cada sesión y conserva total/completo', () => {
    const [dia] = agruparHistorial([
      fila({ id: 'b', nombre_ejercicio: 'Estocadas', orden: 1 }),
      fila({ id: 'a', nombre_ejercicio: 'Sentadilla', orden: 0 }),
    ]);

    const sesion = dia.sesiones[0];
    expect(sesion.ejercicios.map((e) => e.nombre)).toEqual(['Sentadilla', 'Estocadas']);
    expect(sesion.totalEjercicios).toBe(2);
    expect(sesion.completo).toBe(false);
    expect(sesion.tituloDia).toBe('Día 1');
  });
});

describe('getRoutineHistory (solo lectura)', () => {
  it('lee solo las filas del socio, ordenadas por created_at desc', async () => {
    const chain = makeChain({ data: [fila({})], error: null });
    mockedFrom.mockImplementation(() => chain);

    const dias = await getRoutineHistory('user-1');

    expect(mockedFrom).toHaveBeenCalledWith('routine_history');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(dias).toHaveLength(1);
  });

  it('si la tabla todavía no existe, devuelve un historial vacío', async () => {
    mockedFrom.mockImplementation(() => makeChain({ data: null, error: { code: '42P01', message: 'undefined_table' } }));
    await expect(getRoutineHistory('user-1')).resolves.toEqual([]);
  });
});
