import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria' } }),
}));
jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => ({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120 } }),
}));
jest.mock('../../hooks/useTicker', () => ({ useTicker: () => {} }));
jest.mock('../../lib/closedDaysApi', () => ({ fetchClosedDays: jest.fn().mockResolvedValue([]) }));
jest.mock('../../lib/calendarShare', () => ({
  addToCalendar: jest.fn().mockResolvedValue(undefined),
  shareReserva: jest.fn().mockResolvedValue('shared'),
}));
jest.mock('../../lib/classesApi', () => ({
  loadClassesForDate: jest.fn(),
  formatDateOnly: jest.fn(() => '2026-08-10'),
}));
jest.mock('../../lib/creditsApi', () => ({
  fetchUserBalances: jest.fn().mockResolvedValue([
    {
      id: 'bal-1',
      userId: 'user-1',
      remainingCredits: 3,
      expiresAt: null,
      createdAt: '2026-01-01',
      discipline: { id: 'disc-1', name: 'CrossFit', kind: 'credits' },
      pack: null,
    },
  ]),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { loadClassesForDate } from '../../lib/classesApi';
import { supabase } from '../../lib/supabase';
import AgendaMobileView from '../../screens/user/AgendaMobileView';

const mockedLoadClasses = loadClassesForDate as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

const CLASE_BASE = {
  id: 'class-1',
  title: 'CrossFit',
  disciplineId: 'disc-1',
  instructor: 'Seba',
  location: 'Box 1',
  capacity: 10,
  daysOfWeek: [1, 3, 5],
  startTime: '19:00:00',
  endTime: '20:00:00',
  bookedCount: 2,
  occurrenceDate: '2026-08-10',
  startAt: new Date('2026-08-10T19:00:00').toISOString(),
  endAt: new Date('2026-08-10T20:00:00').toISOString(),
};

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'in', 'order'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('AgendaMobileView (Módulo 2 -- reservar y cancelar desde la agenda)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadClasses.mockResolvedValue([{ ...CLASE_BASE }]);
    mockedRpc.mockResolvedValue({ data: null, error: null });
  });

  it('muestra la clase como Disponible cuando el socio todavía no la reservó', async () => {
    mockedFrom.mockImplementation(() => makeChain({ data: [], error: null }));
    const { getByText } = render(<AgendaMobileView />);
    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());
    expect(getByText('Disponible')).toBeTruthy();
  });

  it('reservar una clase llama a book_class y dispara el modal de confirmación gamificado', async () => {
    mockedFrom.mockImplementation(() => makeChain({ data: [], error: null }));
    const { getByText, getByTestId } = render(<AgendaMobileView />);
    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));

    await waitFor(() =>
      expect(mockedRpc).toHaveBeenCalledWith('book_class', { p_class_id: 'class-1', p_booking_date: '2026-08-10' })
    );
    await waitFor(() => expect(getByText('¡Reserva confirmada!')).toBeTruthy());
  });

  it('muestra la clase como Reservada y permite cancelarla, liberando el cupo', async () => {
    mockedFrom.mockImplementation(() => makeChain({ data: [{ class_id: 'class-1' }], error: null }));
    const { getByText, getByTestId } = render(<AgendaMobileView />);
    await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());

    // Después de confirmar, la próxima carga (loadClassesForDate) ya no
    // debería devolver la clase como reservada -- simula que el cupo se liberó.
    mockedFrom.mockImplementation(() => makeChain({ data: [], error: null }));
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() =>
      expect(mockedRpc).toHaveBeenCalledWith('cancel_booking', {
        p_class_id: 'class-1',
        p_booking_date: '2026-08-10',
        p_reason: null,
      })
    );
    await waitFor(() => expect(getByText('Disponible')).toBeTruthy());
  });
});
