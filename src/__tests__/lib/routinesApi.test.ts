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
  markExerciseCompleted,
  unmarkExerciseCompleted,
  getUserRoutine,
  getMisRutinasAnteriores,
  getSesionesDeRutina,
} from '../../lib/routinesApi';
import { esViolacionDeFk, esRutinaCerrada, errorConCodigo } from '../../lib/supabaseErrors';

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'is', 'upsert', 'order', 'limit', 'insert', 'delete'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('getUserExerciseWeights (carga real por ejercicio, independiente del checklist diario)', () => {
  it('lee user_exercise_weights y arma un Map de exercise_id -> última carga guardada', async () => {
    const chain = makeChain({
      data: [
        { exercise_id: 'ex-1', weight_used: '60kg' },
        { exercise_id: 'ex-2', weight_used: '2x14kg' },
      ],
      error: null,
    });
    mockedFrom.mockImplementation(() => chain);

    const pesos = await getUserExerciseWeights('user-1');
    expect(mockedFrom).toHaveBeenCalledWith('user_exercise_weights');
    expect(chain.select).toHaveBeenCalledWith('exercise_id, weight_used');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(pesos.get('ex-1')).toBe('60kg');
    expect(pesos.get('ex-2')).toBe('2x14kg');
    expect(pesos.size).toBe(2);
  });

  it('LECTURA sin la tabla (migración sin correr): Map vacío (cae a la sugerencia) pero con console.warn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFrom.mockImplementation(() =>
      makeChain({ data: null, error: { code: 'PGRST205', message: 'schema cache' } })
    );

    const pesos = await getUserExerciseWeights('user-1');
    expect(pesos.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('supabase_migration_user_exercise_weights.sql'), 'schema cache');
    warn.mockRestore();
  });

  it('un error real (no de tabla faltante) sí se propaga', async () => {
    mockedFrom.mockImplementation(() => makeChain({ data: null, error: { message: 'RLS violation' } }));

    await expect(getUserExerciseWeights('user-1')).rejects.toThrow('RLS violation');
  });
});

describe('saveExerciseWeight (upsert por socio+ejercicio)', () => {
  it('hace upsert en user_exercise_weights por (user_id, exercise_id)', async () => {
    const chain = makeChain({ error: null });
    mockedFrom.mockImplementation(() => chain);

    await saveExerciseWeight('user-1', 'ex-1', '65kg');

    expect(mockedFrom).toHaveBeenCalledWith('user_exercise_weights');
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', exercise_id: 'ex-1', weight_used: '65kg' }),
      { onConflict: 'user_id,exercise_id' }
    );
    // Nunca por la fila de la rutina (se regenera cada vez que Seba re-guarda).
    expect(chain.upsert.mock.calls[0][0]).not.toHaveProperty('routine_exercise_id');
  });

  // Regresión real (2026-09-29): la tabla nunca se creó en producción y este
  // guardado "andaba" sin guardar nada, sin que nadie se enterara.
  it('ESCRITURA sin la tabla: tira un error claro (nunca en silencio) y lo registra', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedFrom.mockImplementation(() => makeChain({ error: { code: '42P01', message: 'undefined_table' } }));

    await expect(saveExerciseWeight('user-1', 'ex-1', '65kg')).rejects.toThrow(
      'El guardado de cargas todavía no está activado en el servidor.'
    );
    expect(err).toHaveBeenCalledWith(expect.stringContaining('supabase_migration_user_exercise_weights.sql'), 'undefined_table');
    err.mockRestore();
  });

  it('ESCRITURA con otro error real (ej. RLS): también se propaga', async () => {
    mockedFrom.mockImplementation(() => makeChain({ error: { code: '42501', message: 'new row violates row-level security' } }));
    await expect(saveExerciseWeight('user-1', 'ex-1', '65kg')).rejects.toThrow('row-level security');
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
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    await expect(eliminarSesionHistorial('s-1')).rejects.toThrow(
      'El borrado de entrenamientos todavía no está activado en el servidor.'
    );
    err.mockRestore();
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

  it('ESCRITURA sin la función (migración sin correr): tira un error claro -- ya no festeja sin guardar', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });

    await expect(finalizarEntrenamiento('Día 1', 5, items)).rejects.toThrow(
      'El historial de entrenamientos todavía no está activado en el servidor.'
    );
    expect(err).toHaveBeenCalledWith(expect.stringContaining('supabase_migration_routine_history.sql'), 'function not found');
    err.mockRestore();
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

  it('LECTURA sin la tabla: historial vacío pero con console.warn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFrom.mockImplementation(() => makeChain({ data: null, error: { code: '42P01', message: 'undefined_table' } }));
    await expect(getRoutineHistory('user-1')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('supabase_migration_routine_history.sql'), 'undefined_table');
    warn.mockRestore();
  });
});

// El checklist diario conserva el código de Postgres: la pantalla necesita
// distinguir un 23503 (el ejercicio ya no existe porque Seba re-guardó la
// rutina) de cualquier otro error.
describe('markExerciseCompleted / unmarkExerciseCompleted (conservan el código de error)', () => {
  it('marcar inserta en routine_completions por (socio, fila de la rutina, fecha)', async () => {
    const chain = makeChain({ error: null });
    mockedFrom.mockImplementation(() => chain);

    await markExerciseCompleted('user-1', 're-1', '2026-10-06');

    expect(mockedFrom).toHaveBeenCalledWith('routine_completions');
    expect(chain.insert).toHaveBeenCalledWith({ user_id: 'user-1', routine_exercise_id: 're-1', completed_date: '2026-10-06' });
  });

  it('23505 (ya estaba marcado) no es un error', async () => {
    mockedFrom.mockImplementation(() => makeChain({ error: { code: '23505', message: 'duplicate key value' } }));
    await expect(markExerciseCompleted('user-1', 're-1', '2026-10-06')).resolves.toBeUndefined();
  });

  it('23503 (el ejercicio ya no existe) se lanza con el código, y esViolacionDeFk lo reconoce', async () => {
    mockedFrom.mockImplementation(() =>
      makeChain({ error: { code: '23503', message: 'insert or update on table "routine_completions" violates foreign key constraint' } })
    );
    const err = await markExerciseCompleted('user-1', 're-viejo', '2026-10-06').catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('23503');
    expect(esViolacionDeFk(err)).toBe(true);
  });

  it('cualquier otro error se lanza con su mensaje y su código, y NO cuenta como FK', async () => {
    mockedFrom.mockImplementation(() => makeChain({ error: { code: '42501', message: 'new row violates row-level security' } }));
    const err = await markExerciseCompleted('user-1', 're-1', '2026-10-06').catch((e) => e);

    expect(err.message).toBe('new row violates row-level security');
    expect(err.code).toBe('42501');
    expect(esViolacionDeFk(err)).toBe(false);
  });

  it('desmarcar borra por (socio, fila, fecha) y también conserva el código si falla', async () => {
    const ok = makeChain({ error: null });
    mockedFrom.mockImplementation(() => ok);
    await unmarkExerciseCompleted('user-1', 're-1', '2026-10-06');
    expect(ok.delete).toHaveBeenCalled();
    expect(ok.eq).toHaveBeenCalledWith('routine_exercise_id', 're-1');
    expect(ok.eq).toHaveBeenCalledWith('completed_date', '2026-10-06');

    mockedFrom.mockImplementation(() => makeChain({ error: { code: '42501', message: 'rls' } }));
    const err = await unmarkExerciseCompleted('user-1', 're-1', '2026-10-06').catch((e) => e);
    expect(err.code).toBe('42501');
  });

  it('esViolacionDeFk no rompe con valores que no son errores', () => {
    expect(esViolacionDeFk(null)).toBe(false);
    expect(esViolacionDeFk(undefined)).toBe(false);
    expect(esViolacionDeFk(new Error('x'))).toBe(false);
  });
});

// -- Historial de rutinas (F1) --------------------------------------------------------

describe('getUserRoutine: la rutina VIGENTE (vigente_hasta null), no "la más nueva"', () => {
  const filaRutina = {
    id: 'r-2', user_id: 'user-1', title: 'Fuerza', coach_name: null, notes: null,
    created_at: '2026-10-01T10:00:00Z', vigente_desde: '2026-10-01T10:00:00Z', vigente_hasta: null,
  };

  it('filtra por vigente_hasta null y devuelve las fechas de vigencia', async () => {
    const rutinas = makeChain({ data: filaRutina, error: null });
    const dias = makeChain({ data: [], error: null });
    mockedFrom.mockImplementation((tabla: string) => (tabla === 'routines' ? rutinas : dias));

    const r = await getUserRoutine('user-1');

    expect(rutinas.is).toHaveBeenCalledWith('vigente_hasta', null);
    expect(r).toMatchObject({ id: 'r-2', vigenteDesde: '2026-10-01T10:00:00Z', vigenteHasta: null });
  });

  it('sin la migración (columna inexistente): cae a la más nueva, con console.warn (Mi Rutina no se rompe)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const sinColumna = makeChain({ data: null, error: { code: '42703', message: 'column routines.vigente_hasta does not exist' } });
    const vieja = makeChain({ data: { ...filaRutina, vigente_desde: undefined, vigente_hasta: undefined }, error: null });
    const dias = makeChain({ data: [], error: null });
    let pedidosRutina = 0;
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla !== 'routines') return dias;
      pedidosRutina += 1;
      return pedidosRutina === 1 ? sinColumna : vieja;
    });

    const r = await getUserRoutine('user-1');

    expect(r?.id).toBe('r-2');
    expect(vieja.is).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('supabase_migration_historial_rutinas_f1.sql'), expect.any(String));
    warn.mockRestore();
  });
});

describe('getMisRutinasAnteriores ("Mis rutinas": historial de rutinas del socio)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('solo las anteriores, sin archivadas, la más nueva primero, con sus entrenamientos (sin los ocultos)', async () => {
    const rutinas = makeChain({
      data: [
        { id: 'r-1', title: 'Adaptación', coach_name: null, created_at: '2026-06-01', vigente_desde: '2026-06-01T10:00:00Z', vigente_hasta: '2026-08-01T10:00:00Z' },
        { id: 'r-3', title: 'Actual', coach_name: null, created_at: '2026-10-01', vigente_desde: '2026-10-01T10:00:00Z', vigente_hasta: null },
        { id: 'r-2', title: 'Fuerza', coach_name: null, created_at: '2026-08-01', vigente_desde: '2026-08-01T10:00:00Z', vigente_hasta: '2026-10-01T10:00:00Z' },
      ],
      error: null,
    });
    const sesiones = makeChain({
      data: [
        { routine_id: 'r-2', sesion_id: 's-1' },
        { routine_id: 'r-2', sesion_id: 's-1' },
        { routine_id: 'r-2', sesion_id: 's-2' },
        { routine_id: null, sesion_id: 's-vieja' },
      ],
      error: null,
    });
    mockedFrom.mockImplementation((tabla: string) => (tabla === 'routines' ? rutinas : sesiones));

    const lista = await getMisRutinasAnteriores('user-1');

    expect(rutinas.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(rutinas.is).toHaveBeenCalledWith('archivada_en', null);
    expect(sesiones.is).toHaveBeenCalledWith('oculta_en', null);
    expect(lista.map((r) => r.id)).toEqual(['r-2', 'r-1']);
    expect(lista[0]).toMatchObject({ title: 'Fuerza', vigenteHasta: '2026-10-01T10:00:00Z', entrenamientos: 2 });
    expect(lista[1].entrenamientos).toBe(0);
  });

  it('si falla el conteo de entrenamientos, la lista sale igual (con 0)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const rutinas = makeChain({
      data: [{ id: 'r-1', title: 'Vieja', coach_name: null, created_at: '2026-06-01', vigente_desde: '2026-06-01T10:00:00Z', vigente_hasta: '2026-08-01T10:00:00Z' }],
      error: null,
    });
    const sesiones = makeChain({ data: null, error: { message: 'timeout' } });
    mockedFrom.mockImplementation((tabla: string) => (tabla === 'routines' ? rutinas : sesiones));

    await expect(getMisRutinasAnteriores('user-1')).resolves.toEqual([
      expect.objectContaining({ id: 'r-1', entrenamientos: 0 }),
    ]);
    warn.mockRestore();
  });

  it('sin la migración: lista vacía con console.warn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFrom.mockImplementation(() =>
      makeChain({ data: null, error: { code: '42703', message: 'column routines.archivada_en does not exist' } })
    );
    await expect(getMisRutinasAnteriores('user-1')).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe('getSesionesDeRutina (entrenamientos de UNA rutina, sin los ocultos)', () => {
  it('lee por routine_id, sin las ocultas, y agrupa como la pestaña Historial', async () => {
    const chain = makeChain({ data: [fila({ id: 'a', sesion_id: 's-1' })], error: null });
    mockedFrom.mockImplementation(() => chain);

    const dias = await getSesionesDeRutina('r-2');

    expect(chain.eq).toHaveBeenCalledWith('routine_id', 'r-2');
    expect(chain.is).toHaveBeenCalledWith('oculta_en', null);
    expect(dias[0].sesiones[0].sesionId).toBe('s-1');
  });
});

describe('getRoutineHistory: sin las sesiones ocultas ("Eliminar" ya no borra)', () => {
  it('filtra oculta_en null', async () => {
    const chain = makeChain({ data: [], error: null });
    mockedFrom.mockImplementation(() => chain);
    await getRoutineHistory('user-1');
    expect(chain.is).toHaveBeenCalledWith('oculta_en', null);
  });

  it('sin la columna oculta_en (migración sin correr): lee como antes, con console.warn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const sinColumna = makeChain({ data: null, error: { code: '42703', message: 'column routine_history.oculta_en does not exist' } });
    const comoAntes = makeChain({ data: [fila({})], error: null });
    mockedFrom.mockImplementationOnce(() => sinColumna).mockImplementationOnce(() => comoAntes);

    const dias = await getRoutineHistory('user-1');

    expect(dias).toHaveLength(1);
    expect(comoAntes.is).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('finalizarEntrenamiento con la rutina en la que se hizo (p_routine_id)', () => {
  const items = [{ nombre: 'Sentadilla', grupo: 'Piernas', series: 4, repeticiones: '10', peso: '60kg' }];
  beforeEach(() => jest.clearAllMocks());

  it('manda p_routine_id', async () => {
    mockedRpc.mockResolvedValue({ data: { registrado: true, sesion_id: 's-1' }, error: null });
    await finalizarEntrenamiento('Día 1', 5, items, 'r-2');
    expect(mockedRpc).toHaveBeenCalledWith('finalizar_entrenamiento', {
      p_titulo_dia: 'Día 1',
      p_total_ejercicios: 5,
      p_items: items,
      p_routine_id: 'r-2',
    });
  });

  it('servidor sin la versión nueva (función no encontrada): reintenta sin p_routine_id y registra igual', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: { registrado: true, sesion_id: 's-1' }, error: null });

    await expect(finalizarEntrenamiento('Día 1', 5, items, 'r-2')).resolves.toEqual({ estado: 'registrado' });
    expect(mockedRpc).toHaveBeenCalledTimes(2);
    expect(mockedRpc.mock.calls[1][1]).not.toHaveProperty('p_routine_id');
    warn.mockRestore();
  });

  it('un error real (rutina ajena) no se reintenta: se propaga', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Esa rutina no es tuya.' } });
    await expect(finalizarEntrenamiento('Día 1', 5, items, 'r-ajena')).rejects.toThrow('Esa rutina no es tuya.');
    expect(mockedRpc).toHaveBeenCalledTimes(1);
  });
});

describe('esRutinaCerrada (GFR01: la rutina pasó al historial)', () => {
  it('reconoce GFR01 y nada más', () => {
    expect(esRutinaCerrada(errorConCodigo({ code: 'GFR01', message: 'solo lectura' }))).toBe(true);
    expect(esRutinaCerrada(errorConCodigo({ code: '23503', message: 'fk' }))).toBe(false);
    expect(esRutinaCerrada(null)).toBe(false);
    expect(esRutinaCerrada(new Error('x'))).toBe(false);
  });

  it('marcar en una rutina del historial lanza con GFR01 (la pantalla recarga)', async () => {
    mockedFrom.mockImplementation(() =>
      makeChain({ error: { code: 'GFR01', message: 'Esa rutina ya no es la vigente: es de solo lectura.' } })
    );
    const err = await markExerciseCompleted('user-1', 're-viejo', '2026-10-06').catch((e) => e);
    expect(esRutinaCerrada(err)).toBe(true);
  });
});
