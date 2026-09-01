import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// Bug real reportado: el botón "Ver historial de clases" (Más opciones del
// Perfil) llevaba acá, pero cada reserva pasada mostraba "No asistió" o
// "Sin marcar" salvo que un admin hubiera hecho "Check-in Rápido" puntual
// en el gimnasio -- lo más común es que eso NUNCA pase, así que el socio
// veía su propio historial real marcado como si no hubiera ido. Regla
// correcta: una reserva sigue en `bookings` solo si nunca se canceló
// (cancel_booking() la borra), así que cualquier fila con fecha ya pasada
// es, por definición, "Asistió" -- sin importar `attended`.

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria' } }),
}));

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'lte', 'order'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../lib/supabase';
import HistoryScreen from '../../screens/user/HistoryScreen';

const mockedFrom = supabase.from as jest.Mock;

function bookingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'b1',
    user_id: 'user-1',
    booking_date: '2026-08-09',
    attended: false, // nunca se hizo check-in puntual -- el caso real reportado
    created_at: '2026-08-01T00:00:00.000Z',
    classes: {
      id: 'class-1',
      title: 'Boxeo',
      discipline_id: 'disc-boxeo',
      instructor: 'Seba',
      location: 'Box 1',
      capacity: 12,
      days_of_week: [0],
      start_time: '19:00:00',
      end_time: '20:00:00',
    },
    ...overrides,
  };
}

describe('HistoryScreen ("Ver historial de clases")', () => {
  beforeEach(() => jest.clearAllMocks());

  it('una reserva pasada SIN check-in explícito (attended=false) igual se muestra como "Asistió"', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: [bookingRow({ attended: false })], error: null }));

    const { getByText, queryByText } = render(<HistoryScreen />);

    await waitFor(() => expect(getByText('Boxeo')).toBeTruthy());
    expect(getByText('Asistió')).toBeTruthy();
    expect(queryByText('No asistió')).toBeNull();
    expect(queryByText('Sin marcar')).toBeNull();
  });

  it('una reserva pasada CON check-in explícito (attended=true) también se muestra como "Asistió"', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: [bookingRow({ attended: true })], error: null }));

    const { getByText } = render(<HistoryScreen />);

    await waitFor(() => expect(getByText('Boxeo')).toBeTruthy());
    expect(getByText('Asistió')).toBeTruthy();
  });

  it('la query solo filtra por user_id y fecha (lte hoy) -- ya no depende de `attended` para nada', async () => {
    const chain = makeChain({ data: [], error: null });
    mockedFrom.mockReturnValue(chain);

    render(<HistoryScreen />);

    await waitFor(() => expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1'));
    expect(chain.lte).toHaveBeenCalledWith('booking_date', expect.any(String));
    expect(chain.eq).not.toHaveBeenCalledWith('attended', expect.anything());
  });

  it('si la query falla, muestra el mensaje de error real en vez de romper', async () => {
    mockedFrom.mockReturnValue(makeChain({ data: null, error: { message: 'Network error' } }));

    const { getByText } = render(<HistoryScreen />);

    await waitFor(() => expect(getByText('Network error')).toBeTruthy());
  });
});
