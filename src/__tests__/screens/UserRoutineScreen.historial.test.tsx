import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Historial de rutina: "Finalizar Entrenamiento" guarda una foto de los
// ejercicios MARCADOS del día que se está viendo (con el peso de ese
// momento), bloquea con 0 marcados, respeta el cooldown de 1 hora que
// devuelve el servidor, y la pestaña "Historial" muestra lo guardado por día
// y por hora.

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria' } }),
}));

// VideoModal trae react-native-webview (módulo nativo, no existe en Jest).
jest.mock('../../components/VideoModal', () => () => null);

jest.mock('../../lib/routinesApi', () => ({
  getUserRoutine: jest.fn(),
  getTodayCompletions: jest.fn(),
  markExerciseCompleted: jest.fn(),
  unmarkExerciseCompleted: jest.fn(),
  getUserExerciseWeights: jest.fn(),
  saveExerciseWeight: jest.fn(),
  finalizarEntrenamiento: jest.fn(),
  getRoutineHistory: jest.fn(),
}));

import * as api from '../../lib/routinesApi';
import UserRoutineScreen, { formatFechaHistorial, formatHoraArgentina } from '../../screens/user/UserRoutineScreen';

const m = api as jest.Mocked<typeof api>;

function ejercicio(id: string, nombre: string, grupo: string, orden: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    exercise: { id: `ex-${id}`, name: nombre, muscleGroup: grupo, description: null, videoUrl: null },
    sets: 4,
    reps: '10-12',
    restSeconds: 60,
    weightSuggestion: null,
    notes: null,
    orderIndex: orden,
    ...extra,
  };
}

const ROUTINE = {
  id: 'r-1',
  userId: 'user-1',
  title: 'Rutina',
  coachName: 'Seba',
  notes: null,
  createdAt: '2026-08-01T00:00:00Z',
  days: [
    {
      id: 'd-1',
      title: 'Día 1 - Tren Inferior',
      orderIndex: 0,
      exercises: [
        ejercicio('re-1', 'Sentadilla', 'Piernas', 0, { weightSuggestion: '40kg' }),
        ejercicio('re-2', 'Estocadas', 'Piernas', 1),
        ejercicio('re-3', 'Gemelos', 'Piernas', 2),
      ],
    },
    {
      id: 'd-2',
      title: 'Día 2 - Tren Superior',
      orderIndex: 1,
      exercises: [ejercicio('re-4', 'Press de banca', 'Pecho', 0)],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  m.getUserRoutine.mockResolvedValue(ROUTINE as any);
  m.getTodayCompletions.mockResolvedValue(new Set());
  m.getUserExerciseWeights.mockResolvedValue(new Map([['re-2', '20kg']]));
  m.markExerciseCompleted.mockResolvedValue();
  m.getRoutineHistory.mockResolvedValue([]);
});

async function renderPantalla() {
  const utils = render(<UserRoutineScreen />);
  await waitFor(() => expect(utils.getByText('Sentadilla')).toBeTruthy());
  return utils;
}

describe('Mi Rutina -- Finalizar Entrenamiento (guarda en el historial)', () => {
  it('con 0 ejercicios marcados, bloquea sin llamar al servidor', async () => {
    const { getByText } = await renderPantalla();

    fireEvent.press(getByText('🔥 Finalizar Entrenamiento'));

    expect(getByText('Marcá al menos un ejercicio para finalizar el entrenamiento.')).toBeTruthy();
    expect(m.finalizarEntrenamiento).not.toHaveBeenCalled();
  });

  it('guarda solo lo marcado del día visible, con el peso actual (guardado o sugerencia) y el total del día', async () => {
    m.finalizarEntrenamiento.mockResolvedValue({ estado: 'registrado' });
    const { getByText, getByLabelText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByLabelText('Marcar Estocadas como completado'));
    fireEvent.press(getByText('🔥 Finalizar Entrenamiento'));

    await waitFor(() => expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(1));
    expect(m.finalizarEntrenamiento).toHaveBeenCalledWith('Día 1 - Tren Inferior', 3, [
      { nombre: 'Sentadilla', grupo: 'Piernas', series: 4, repeticiones: '10-12', peso: '40kg' },
      { nombre: 'Estocadas', grupo: 'Piernas', series: 4, repeticiones: '10-12', peso: '20kg' },
    ]);
    // Guardado parcial -> igual festeja, con el copy de progreso parcial.
    await waitFor(() => expect(getByText('¡Buen entrenamiento! 💪')).toBeTruthy());
  });

  it('si el servidor responde cooldown, muestra el mensaje con la hora y NO el festejo', async () => {
    const disponibleDesde = '2026-09-27T21:42:00Z';
    m.finalizarEntrenamiento.mockResolvedValue({ estado: 'cooldown', disponibleDesde });
    const { getByText, getByLabelText, queryByText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByText('🔥 Finalizar Entrenamiento'));

    await waitFor(() =>
      expect(
        getByText(
          `Ya registraste un entrenamiento hace poco. Podés volver a finalizar a partir de las ${formatHoraArgentina(
            disponibleDesde
          )}.`
        )
      ).toBeTruthy()
    );
    expect(queryByText('¡Buen entrenamiento! 💪')).toBeNull();
    expect(queryByText('¡Rutina completa! 🔥')).toBeNull();
  });

  it('si el guardado falla, avisa con el error real', async () => {
    m.finalizarEntrenamiento.mockRejectedValue(new Error('Network error'));
    const { getByText, getByLabelText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByText('🔥 Finalizar Entrenamiento'));

    await waitFor(() => expect(getByText('No se pudo guardar el entrenamiento: Network error')).toBeTruthy());
  });
});

describe('Mi Rutina -- pestaña Historial', () => {
  const HISTORIAL: api.DiaHistorial[] = [
    {
      fecha: '2026-09-26',
      sesiones: [
        {
          sesionId: 'tarde',
          creadoEn: '2026-09-26T21:30:00Z',
          tituloDia: 'Día 2 - Tren Superior',
          totalEjercicios: 1,
          completo: true,
          ejercicios: [{ id: 'h3', nombre: 'Press de banca', grupo: 'Pecho', series: 4, repeticiones: '8', peso: '50kg' }],
        },
        {
          sesionId: 'manana',
          creadoEn: '2026-09-26T11:15:00Z',
          tituloDia: 'Día 1 - Tren Inferior',
          totalEjercicios: 5,
          completo: false,
          ejercicios: [
            { id: 'h1', nombre: 'Sentadilla', grupo: 'Piernas', series: 4, repeticiones: '10', peso: '60kg' },
            { id: 'h2', nombre: 'Estocadas', grupo: 'Piernas', series: 3, repeticiones: '12', peso: null },
          ],
        },
      ],
    },
    {
      fecha: '2026-09-25',
      sesiones: [
        {
          sesionId: 'ayer',
          creadoEn: '2026-09-25T20:00:00Z',
          tituloDia: 'Día 1 - Tren Inferior',
          totalEjercicios: 5,
          completo: false,
          ejercicios: [
            { id: 'h4', nombre: 'Gemelos', grupo: 'Piernas', series: 4, repeticiones: '15', peso: '30kg' },
            { id: 'h5', nombre: 'Prensa', grupo: 'Piernas', series: 4, repeticiones: '10', peso: '100kg' },
            { id: 'h6', nombre: 'Camilla', grupo: 'Piernas', series: 4, repeticiones: '10', peso: '25kg' },
            { id: 'h7', nombre: 'Sillón', grupo: 'Piernas', series: 4, repeticiones: '10', peso: '25kg' },
          ],
        },
      ],
    },
  ];

  it('lista los días, con dos finalizaciones del mismo día por separado (cada una con su hora)', async () => {
    m.getRoutineHistory.mockResolvedValue(HISTORIAL);
    const { getByText, queryByText } = await renderPantalla();

    fireEvent.press(getByText('Historial'));

    await waitFor(() => expect(getByText(formatFechaHistorial('2026-09-26'))).toBeTruthy());
    expect(getByText(formatFechaHistorial('2026-09-25'))).toBeTruthy();
    expect(getByText('2 entrenamientos')).toBeTruthy();

    // El más reciente arranca abierto: se ven las dos sesiones con su hora.
    expect(getByText(`${formatHoraArgentina('2026-09-26T21:30:00Z')} hs`)).toBeTruthy();
    expect(getByText(`${formatHoraArgentina('2026-09-26T11:15:00Z')} hs`)).toBeTruthy();
    expect(getByText('Día 2 - Tren Superior')).toBeTruthy();
    expect(getByText('Completo')).toBeTruthy();
    expect(getByText('2 de 5 ejercicios')).toBeTruthy();
    expect(getByText('4 × 10')).toBeTruthy();
    expect(getByText('60kg')).toBeTruthy();
    expect(getByText('Sin carga')).toBeTruthy();

    // El día anterior está cerrado hasta tocarlo.
    expect(queryByText('Gemelos')).toBeNull();
    expect(getByText('4 de 5 ejercicios')).toBeTruthy(); // resumen del día incompleto
  });

  it('un día se despliega y se pliega al tocarlo', async () => {
    m.getRoutineHistory.mockResolvedValue(HISTORIAL);
    const { getByText, queryByText } = await renderPantalla();

    fireEvent.press(getByText('Historial'));
    await waitFor(() => expect(getByText(formatFechaHistorial('2026-09-25'))).toBeTruthy());

    fireEvent.press(getByText(formatFechaHistorial('2026-09-25')));
    expect(getByText('Gemelos')).toBeTruthy();
    expect(getByText('100kg')).toBeTruthy();

    fireEvent.press(getByText(formatFechaHistorial('2026-09-25')));
    expect(queryByText('Gemelos')).toBeNull();
  });

  it('sin entrenamientos guardados, muestra el estado vacío', async () => {
    const { getByText } = await renderPantalla();

    fireEvent.press(getByText('Historial'));

    await waitFor(() => expect(getByText('Todavía no hay entrenamientos')).toBeTruthy());
    expect(m.getRoutineHistory).toHaveBeenCalledWith('user-1');
  });

  it('volver a "Rutina de hoy" muestra la rutina de nuevo', async () => {
    const { getByText } = await renderPantalla();

    fireEvent.press(getByText('Historial'));
    await waitFor(() => expect(getByText('Todavía no hay entrenamientos')).toBeTruthy());
    fireEvent.press(getByText('Rutina de hoy'));

    expect(getByText('Sentadilla')).toBeTruthy();
  });
});

describe('formatos de fecha/hora del historial', () => {
  it('fecha: "26 de septiembre", con año solo si no es el año en curso', () => {
    const hoy = new Date('2026-09-27T15:00:00Z');
    expect(formatFechaHistorial('2026-09-26', hoy)).toBe('26 de septiembre');
    expect(formatFechaHistorial('2025-12-31', hoy)).toBe('31 de diciembre de 2025');
  });

  it('hora: siempre en horario de Argentina (UTC-3), formato 24 hs', () => {
    expect(formatHoraArgentina('2026-09-26T21:30:00Z')).toBe('18:30');
    expect(formatHoraArgentina('2026-09-26T02:05:00Z')).toBe('23:05');
  });
});
