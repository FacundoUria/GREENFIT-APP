import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// "Mis rutinas" (historial de rutinas, Fase 1): la rutina actual y el historial con las
// anteriores, de la más nueva a la más vieja. Cada una se abre en SOLO LECTURA, con sus
// días y ejercicios y los entrenamientos que el socio registró en ella (con la carga que
// usó). No hay tildes, ni "Finalizar", ni campos para escribir.

jest.mock('../../lib/routinesApi', () => ({
  getMisRutinasAnteriores: jest.fn(),
  getRutina: jest.fn(),
  getSesionesDeRutina: jest.fn(),
}));

import * as api from '../../lib/routinesApi';
import MisRutinasView from '../../components/MisRutinasView';

const m = api as jest.Mocked<typeof api>;

const ACTUAL = {
  id: 'r-3',
  userId: 'user-1',
  title: 'Hipertrofia',
  coachName: null,
  notes: null,
  createdAt: '2026-10-01T13:00:00Z',
  vigenteDesde: '2026-10-01T13:00:00Z',
  vigenteHasta: null,
  days: [{ id: 'd-1', title: 'Día 1', orderIndex: 0, exercises: [] }],
};

const ANTERIORES = [
  { id: 'r-2', title: 'Fuerza', coachName: null, vigenteDesde: '2026-08-01T13:00:00Z', vigenteHasta: '2026-10-01T13:00:00Z', entrenamientos: 7 },
  { id: 'r-1', title: 'Adaptación', coachName: null, vigenteDesde: '2026-06-01T13:00:00Z', vigenteHasta: '2026-08-01T13:00:00Z', entrenamientos: 0 },
];

const FUERZA = {
  id: 'r-2',
  userId: 'user-1',
  title: 'Fuerza',
  coachName: null,
  notes: 'Bajar el peso si duele la rodilla',
  createdAt: '2026-08-01T13:00:00Z',
  vigenteDesde: '2026-08-01T13:00:00Z',
  vigenteHasta: '2026-10-01T13:00:00Z',
  days: [
    {
      id: 'd-a',
      title: 'Tren inferior',
      orderIndex: 0,
      exercises: [
        {
          id: 'e-1',
          exercise: { id: 'ex-1', name: 'Sentadilla', muscleGroup: 'Piernas', description: null, videoUrl: null },
          sets: 4,
          reps: '8',
          restSeconds: 90,
          weightSuggestion: '60kg',
          notes: null,
          orderIndex: 0,
        },
      ],
    },
  ],
};

const SESIONES = [
  {
    fecha: '2026-09-10',
    sesiones: [
      {
        sesionId: 's-1',
        creadoEn: '2026-09-10T22:00:00Z',
        tituloDia: 'Tren inferior',
        totalEjercicios: 1,
        completo: true,
        ejercicios: [{ id: 'h-1', nombre: 'Sentadilla', grupo: 'Piernas', series: 4, repeticiones: '8', peso: '62kg' }],
      },
    ],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  m.getMisRutinasAnteriores.mockResolvedValue(ANTERIORES);
  m.getRutina.mockResolvedValue(FUERZA as never);
  m.getSesionesDeRutina.mockResolvedValue(SESIONES as never);
});

describe('MisRutinasView', () => {
  it('muestra la rutina actual y el historial, de la más nueva a la más vieja, con fechas y entrenamientos', async () => {
    const { getByText, findByText, getAllByLabelText } = render(
      <MisRutinasView userId="user-1" rutinaActual={ACTUAL as never} onVerRutinaActual={jest.fn()} />
    );

    expect(getByText('RUTINA ACTUAL')).toBeTruthy();
    expect(getByText('Hipertrofia')).toBeTruthy();
    expect(getByText(/Desde el 01\/10\/2026/)).toBeTruthy();
    expect(await findByText('Del 01/08/2026 al 01/10/2026')).toBeTruthy();
    expect(getByText('7 entrenamientos')).toBeTruthy();
    expect(getAllByLabelText(/^Ver rutina /).map((n) => n.props.accessibilityLabel)).toEqual([
      'Ver rutina Fuerza',
      'Ver rutina Adaptación',
    ]);
    expect(m.getMisRutinasAnteriores).toHaveBeenCalledWith('user-1');
  });

  it('"Entrenar hoy" lleva a la rutina de hoy', async () => {
    const onVerRutinaActual = jest.fn();
    const { getByLabelText, findByText } = render(
      <MisRutinasView userId="user-1" rutinaActual={ACTUAL as never} onVerRutinaActual={onVerRutinaActual} />
    );
    await findByText('Fuerza');
    fireEvent.press(getByLabelText('Ir a la rutina de hoy'));
    expect(onVerRutinaActual).toHaveBeenCalled();
  });

  it('abrir una anterior: solo lectura, con sus ejercicios y los entrenamientos con la carga de ese momento; "volver" regresa', async () => {
    const { findByLabelText, findByText, getByText, queryByText, UNSAFE_queryAllByType, getByLabelText } = render(
      <MisRutinasView userId="user-1" rutinaActual={ACTUAL as never} onVerRutinaActual={jest.fn()} />
    );
    fireEvent.press(await findByLabelText('Ver rutina Fuerza'));

    expect(await findByText('Solo lectura')).toBeTruthy();
    expect(getByText('Bajar el peso si duele la rodilla')).toBeTruthy();
    expect(await findByText('4 × 8 · Descanso 90 s · Sugerida 60kg')).toBeTruthy();
    expect(getByText('TUS ENTRENAMIENTOS EN ESTA RUTINA')).toBeTruthy();
    expect(getByText('4 × 8 · 62kg')).toBeTruthy();
    expect(m.getRutina).toHaveBeenCalledWith('r-2');
    expect(m.getSesionesDeRutina).toHaveBeenCalledWith('r-2');
    // Nada para tildar ni escribir.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TextInput } = require('react-native');
    expect(UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
    expect(queryByText(/Finalizar/)).toBeNull();
    expect(queryByText(/Marcar/)).toBeNull();

    fireEvent.press(getByLabelText('Volver a Mis rutinas'));
    expect(await findByText('HISTORIAL DE RUTINAS')).toBeTruthy();
  });

  it('una anterior sin entrenamientos lo dice', async () => {
    m.getSesionesDeRutina.mockResolvedValue([]);
    const { findByLabelText, findByText } = render(
      <MisRutinasView userId="user-1" rutinaActual={ACTUAL as never} onVerRutinaActual={jest.fn()} />
    );
    fireEvent.press(await findByLabelText('Ver rutina Adaptación'));
    expect(await findByText('No hay entrenamientos registrados en esta rutina.')).toBeTruthy();
  });

  it('sin rutinas anteriores ni actual: explica qué va a pasar', async () => {
    m.getMisRutinasAnteriores.mockResolvedValue([]);
    const { findByText, getByText } = render(
      <MisRutinasView userId="user-1" rutinaActual={null} onVerRutinaActual={jest.fn()} />
    );
    expect(getByText('Todavía no tenés una rutina asignada.')).toBeTruthy();
    expect(await findByText(/Todavía no tenés rutinas anteriores/)).toBeTruthy();
  });

  it('si falla la carga, muestra el error', async () => {
    m.getMisRutinasAnteriores.mockRejectedValue(new Error('Sin conexión'));
    const { findByText } = render(
      <MisRutinasView userId="user-1" rutinaActual={ACTUAL as never} onVerRutinaActual={jest.fn()} />
    );
    expect(await findByText('Sin conexión')).toBeTruthy();
  });

  it('recarga cuando cambia `recarga` (tirar para refrescar)', async () => {
    const { rerender, findByText } = render(
      <MisRutinasView userId="user-1" rutinaActual={ACTUAL as never} recarga={0} onVerRutinaActual={jest.fn()} />
    );
    await findByText('Fuerza');
    rerender(<MisRutinasView userId="user-1" rutinaActual={ACTUAL as never} recarga={1} onVerRutinaActual={jest.fn()} />);
    await waitFor(() => expect(m.getMisRutinasAnteriores).toHaveBeenCalledTimes(2));
  });
});
