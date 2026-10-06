import React from 'react';
import { AppState } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// Mi Rutina vuelve a pedir la rutina al tomar foco y al volver a primer
// plano. Bug real: Seba re-guardaba la rutina desde el panel (ids NUEVOS
// para todos los routine_exercises) con la app del socio abierta, la
// pantalla seguía con los ids viejos y marcar un ejercicio fallaba con el
// error crudo de Postgres (23503, FK). Además la fecha de "hoy" quedaba fija
// desde que se abrió la pantalla.

// useFocusEffect controlable: corre al montar y deja simular salir y volver
// a la pestaña.
const mockFoco: { callback: null | (() => void | (() => void)); cleanup: null | (() => void) } = {
  callback: null,
  cleanup: null,
};
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => {
      mockFoco.callback = cb;
      const c = cb();
      mockFoco.cleanup = typeof c === 'function' ? c : null;
      return () => {
        mockFoco.cleanup?.();
        mockFoco.cleanup = null;
      };
    }, [cb]);
  },
}));

function salirDeLaPestana() {
  mockFoco.cleanup?.();
  mockFoco.cleanup = null;
}
function volverALaPestana() {
  const c = mockFoco.callback!();
  mockFoco.cleanup = typeof c === 'function' ? c : null;
}

// "Hoy" controlable (la pantalla lo calcula con formatDateOnly).
const mockHoy = { valor: '2026-10-06' };
jest.mock('../../lib/classesApi', () => ({
  formatDateOnly: () => mockHoy.valor,
}));

const mockAuth = { user: { id: 'user-1', name: 'Facundo Uria' } };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));
jest.mock('../../components/VideoModal', () => () => null);
jest.mock('../../lib/crossPlatformAlert', () => ({ showAlert: jest.fn() }));
jest.mock('../../lib/routinesApi', () => ({
  getUserRoutine: jest.fn(),
  getTodayCompletions: jest.fn(),
  markExerciseCompleted: jest.fn(),
  unmarkExerciseCompleted: jest.fn(),
  getUserExerciseWeights: jest.fn(),
  saveExerciseWeight: jest.fn(),
  finalizarEntrenamiento: jest.fn(),
  getRoutineHistory: jest.fn(),
  eliminarSesionHistorial: jest.fn(),
}));

import * as api from '../../lib/routinesApi';
import { showAlert } from '../../lib/crossPlatformAlert';
import { errorConCodigo } from '../../lib/supabaseErrors';
import UserRoutineScreen from '../../screens/user/UserRoutineScreen';

const m = api as jest.Mocked<typeof api>;
const mockShowAlert = showAlert as jest.Mock;

// Rutina con ids de fila de un "guardado" puntual. El exercise_id (ex-...)
// es el mismo entre guardados: es lo que conserva el panel Admin.
function rutina(sufijo: string, extra: { titulo?: string } = {}) {
  const fila = (n: number, nombre: string, sugerencia: string | null = null) => ({
    id: `re-${n}-${sufijo}`,
    exercise: { id: `ex-${n}`, name: nombre, muscleGroup: 'Piernas', description: null, videoUrl: null },
    sets: 4,
    reps: '10',
    restSeconds: 60,
    weightSuggestion: sugerencia,
    notes: null,
    orderIndex: n,
  });
  return {
    id: 'r-1',
    userId: 'user-1',
    title: extra.titulo ?? 'Rutina',
    coachName: 'Seba',
    notes: null,
    createdAt: '2026-08-01T00:00:00Z',
    days: [{ id: `d-${sufijo}`, title: 'Día 1', orderIndex: 0, exercises: [fila(1, 'Sentadilla', '40kg'), fila(2, 'Estocadas')] }],
  };
}

const VIEJA = rutina('viejo');
const NUEVA = rutina('nuevo');

function diferido<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => (resolver = r));
  return { promesa, resolver };
}

let manejadorAppState: ((estado: string) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockHoy.valor = '2026-10-06';
  mockFoco.callback = null;
  mockFoco.cleanup = null;
  manejadorAppState = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((tipo: string, handler: (estado: string) => void) => {
    if (tipo === 'change') manejadorAppState = handler;
    return { remove: jest.fn() };
  }) as never);
  m.getUserRoutine.mockResolvedValue(VIEJA as never);
  m.getTodayCompletions.mockResolvedValue(new Set());
  m.getUserExerciseWeights.mockResolvedValue(new Map());
  m.markExerciseCompleted.mockResolvedValue();
  m.unmarkExerciseCompleted.mockResolvedValue();
  m.saveExerciseWeight.mockResolvedValue();
  m.getRoutineHistory.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderPantalla() {
  const utils = render(<UserRoutineScreen />);
  await waitFor(() => expect(utils.getByText('Sentadilla')).toBeTruthy());
  return utils;
}

function volverAPrimerPlano() {
  act(() => {
    manejadorAppState?.('active');
  });
}

describe('Mi Rutina -- carga inicial', () => {
  it('al montar pide la rutina UNA sola vez (el foco cubre la carga inicial)', async () => {
    await renderPantalla();
    expect(m.getUserRoutine).toHaveBeenCalledTimes(1);
    expect(m.getTodayCompletions).toHaveBeenCalledWith('user-1', '2026-10-06');
  });
});

describe('Mi Rutina -- la rutina se re-guarda con la pantalla abierta', () => {
  it('al volver a la pestaña trae los ids nuevos y marcar usa el id NUEVO', async () => {
    const { getByLabelText } = await renderPantalla();

    m.getUserRoutine.mockResolvedValue(NUEVA as never);
    act(() => {
      salirDeLaPestana();
      volverALaPestana();
    });
    await waitFor(() => expect(m.getUserRoutine).toHaveBeenCalledTimes(2));

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    await waitFor(() => expect(m.markExerciseCompleted).toHaveBeenCalledWith('user-1', 're-1-nuevo', '2026-10-06'));
  });

  it('error 23503 al marcar: recarga sola, avisa en criollo (sin el texto de Postgres) y el tilde vuelve atrás', async () => {
    m.markExerciseCompleted.mockRejectedValueOnce(
      errorConCodigo({ code: '23503', message: 'insert or update on table "routine_completions" violates foreign key constraint' })
    );
    const { getByLabelText } = await renderPantalla();
    m.getUserRoutine.mockResolvedValue(NUEVA as never);

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));

    await waitFor(() =>
      expect(mockShowAlert).toHaveBeenCalledWith(
        'Tu rutina se actualizó',
        'Tu entrenador hizo cambios. Volvé a marcar los ejercicios que ya hiciste.'
      )
    );
    expect(mockShowAlert).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('foreign key'));
    await waitFor(() => expect(m.getUserRoutine).toHaveBeenCalledTimes(2));
    // Revertido: sigue ofreciendo "Marcar", y marcar de nuevo ya va con el id nuevo.
    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    await waitFor(() => expect(m.markExerciseCompleted).toHaveBeenLastCalledWith('user-1', 're-1-nuevo', '2026-10-06'));
  });

  it('cualquier otro error al marcar se sigue mostrando (nunca en silencio) y NO recarga', async () => {
    m.markExerciseCompleted.mockRejectedValueOnce(errorConCodigo({ code: '42501', message: 'new row violates row-level security' }));
    const { getByLabelText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledWith('No se pudo guardar', 'new row violates row-level security'));
    expect(getByLabelText('Marcar Sentadilla como completado')).toBeTruthy();
    expect(m.getUserRoutine).toHaveBeenCalledTimes(1);
  });

  it('un error al desmarcar también se muestra', async () => {
    m.getTodayCompletions.mockResolvedValue(new Set(['re-1-viejo']));
    m.unmarkExerciseCompleted.mockRejectedValueOnce(new Error('sin conexión'));
    const { getByLabelText } = await renderPantalla();

    fireEvent.press(getByLabelText('Sentadilla, completado'));

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledWith('No se pudo guardar', 'sin conexión'));
    expect(getByLabelText('Sentadilla, completado')).toBeTruthy();
  });
});

describe('Mi Rutina -- vuelta a primer plano', () => {
  it('con la pestaña visible, volver a primer plano recarga la rutina', async () => {
    await renderPantalla();
    volverAPrimerPlano();
    await waitFor(() => expect(m.getUserRoutine).toHaveBeenCalledTimes(2));
  });

  it('con otra pestaña visible NO recarga (lo hará el foco al volver)', async () => {
    await renderPantalla();
    act(() => salirDeLaPestana());
    volverAPrimerPlano();
    act(() => {
      manejadorAppState?.('background');
    });
    await act(async () => {});
    expect(m.getUserRoutine).toHaveBeenCalledTimes(1);
  });

  it('foco y primer plano juntos hacen UN solo pedido (deduplicación)', async () => {
    await renderPantalla();
    const pendiente = diferido<never>();
    m.getUserRoutine.mockReturnValueOnce(pendiente.promesa);

    act(() => {
      salirDeLaPestana();
      volverALaPestana();
    });
    volverAPrimerPlano();

    expect(m.getUserRoutine).toHaveBeenCalledTimes(2); // 1 al montar + 1 por las dos señales juntas
    await act(async () => pendiente.resolver(VIEJA as never));
  });
});

describe('Mi Rutina -- cambio de día con la app abierta', () => {
  it('pasada la medianoche, tocar un ejercicio NO marca con la fecha de ayer: recarga con la de hoy y avisa', async () => {
    const { getByLabelText } = await renderPantalla();

    mockHoy.valor = '2026-10-07';
    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));

    expect(m.markExerciseCompleted).not.toHaveBeenCalled();
    expect(mockShowAlert).toHaveBeenCalledWith('Empezó un nuevo día', 'Tu rutina se actualizó.');
    await waitFor(() => expect(m.getTodayCompletions).toHaveBeenLastCalledWith('user-1', '2026-10-07'));

    // Ya con el día nuevo, marcar va con la fecha de hoy.
    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    await waitFor(() => expect(m.markExerciseCompleted).toHaveBeenCalledWith('user-1', 're-1-viejo', '2026-10-07'));
  });

  it('al volver a primer plano otro día, lee los tildes con la fecha nueva (los de ayer no aparecen)', async () => {
    m.getTodayCompletions.mockImplementation(async (_u, fecha) => (fecha === '2026-10-06' ? new Set(['re-1-viejo']) : new Set()));
    const { getByLabelText } = await renderPantalla();
    expect(getByLabelText('Sentadilla, completado')).toBeTruthy();

    mockHoy.valor = '2026-10-07';
    volverAPrimerPlano();

    await waitFor(() => expect(getByLabelText('Marcar Sentadilla como completado')).toBeTruthy());
    expect(m.getTodayCompletions).toHaveBeenLastCalledWith('user-1', '2026-10-07');
  });
});

describe('Mi Rutina -- carreras entre recargas y escrituras', () => {
  it('una respuesta vieja que llega DESPUÉS de una más nueva se descarta', async () => {
    const { getByLabelText, queryByLabelText } = await renderPantalla();

    // Recarga 1 (queda colgada, devolverá la rutina VIEJA).
    const lenta = diferido<never>();
    m.getUserRoutine.mockReturnValueOnce(lenta.promesa);
    act(() => {
      salirDeLaPestana();
      volverALaPestana();
    });
    // Recarga 2 (otro día, así no se deduplica): responde enseguida con la NUEVA.
    mockHoy.valor = '2026-10-07';
    m.getUserRoutine.mockResolvedValueOnce(NUEVA as never);
    volverAPrimerPlano();
    await waitFor(() => expect(m.getUserRoutine).toHaveBeenCalledTimes(3));
    await act(async () => {});

    // Llega tarde la respuesta vieja: no pisa la nueva.
    await act(async () => lenta.resolver(VIEJA as never));
    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    await waitFor(() => expect(m.markExerciseCompleted).toHaveBeenCalledWith('user-1', 're-1-nuevo', '2026-10-07'));
    expect(queryByLabelText('Sentadilla, completado')).toBeTruthy();
  });

  it('una recarga que termina con un tilde guardándose no lo pisa, y se repite al terminar la escritura', async () => {
    const { getByLabelText } = await renderPantalla();

    // Recarga en vuelo que leyó los tildes ANTES de marcar (vacíos).
    const recarga = diferido<never>();
    m.getUserRoutine.mockReturnValueOnce(recarga.promesa);
    act(() => {
      salirDeLaPestana();
      volverALaPestana();
    });

    // El socio marca mientras tanto; el guardado tarda.
    const guardado = diferido<void>();
    m.markExerciseCompleted.mockReturnValueOnce(guardado.promesa);
    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    expect(getByLabelText('Sentadilla, completado')).toBeTruthy();

    // Termina la recarga vieja: el tilde NO se borra.
    await act(async () => recarga.resolver(VIEJA as never));
    expect(getByLabelText('Sentadilla, completado')).toBeTruthy();

    // Termina el guardado: se vuelve a pedir (ahora el servidor ya tiene el tilde).
    m.getTodayCompletions.mockResolvedValue(new Set(['re-1-viejo']));
    const llamadasAntes = m.getUserRoutine.mock.calls.length;
    await act(async () => guardado.resolver());
    await waitFor(() => expect(m.getUserRoutine.mock.calls.length).toBe(llamadasAntes + 1));
    await waitFor(() => expect(getByLabelText('Sentadilla, completado')).toBeTruthy());
  });

  it('si una recarga en segundo plano falla, la rutina que se ve no desaparece', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { getByText, queryByText } = await renderPantalla();

    m.getUserRoutine.mockRejectedValueOnce(new Error('sin conexión'));
    volverAPrimerPlano();

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(getByText('Sentadilla')).toBeTruthy();
    expect(queryByText('sin conexión')).toBeNull();
  });
});

describe('Mi Rutina -- la Carga que se está escribiendo no se pierde con una recarga', () => {
  const CARGA = 'Carga (kg) usada en este ejercicio';

  it('escribir un peso SIN guardar y volver a primer plano: el valor sigue ahí y no se guardó solo', async () => {
    const { getAllByLabelText } = await renderPantalla();
    fireEvent.changeText(getAllByLabelText(CARGA)[0], '55kg');

    volverAPrimerPlano();
    await waitFor(() => expect(m.getUserRoutine).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(getAllByLabelText(CARGA)[0].props.value).toBe('55kg');
    expect(m.saveExerciseWeight).not.toHaveBeenCalled();
  });

  it('también si la rutina se re-guardó con ids nuevos (la fila se vuelve a montar): el borrador va por ejercicio', async () => {
    const { getAllByLabelText } = await renderPantalla();
    fireEvent.changeText(getAllByLabelText(CARGA)[0], '55kg');

    m.getUserRoutine.mockResolvedValue(NUEVA as never);
    volverAPrimerPlano();
    await waitFor(() => expect(m.getUserRoutine).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(getAllByLabelText(CARGA)[0].props.value).toBe('55kg');

    // Y al salir del campo se guarda por exercise_id, como siempre.
    fireEvent(getAllByLabelText(CARGA)[0], 'blur');
    await waitFor(() => expect(m.saveExerciseWeight).toHaveBeenCalledWith('user-1', 'ex-1', '55kg'));
  });
});
