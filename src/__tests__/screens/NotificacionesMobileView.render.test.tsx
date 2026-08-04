import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria' } }),
}));

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'order', 'limit'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../lib/supabase';
import NotificacionesMobileView from '../../screens/user/NotificacionesMobileView';

const mockedFrom = supabase.from as jest.Mock;

const NOTIS = [
  {
    id: 'n1',
    title: 'Reserva confirmada',
    body: 'Confirmamos tu reserva de CrossFit',
    created_at: new Date().toISOString(),
    audience_type: 'user',
  },
  {
    id: 'n2',
    title: 'Tu cuota',
    body: 'Tenés un pago pendiente',
    created_at: new Date().toISOString(),
    audience_type: 'debtors',
  },
];

describe('NotificacionesMobileView (Módulo 4)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockedFrom.mockImplementation(() => makeChain({ data: NOTIS, error: null }));
  });

  it('clasifica por categoría y muestra ambas notificaciones en "Todas"', async () => {
    const { getByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Reserva confirmada')).toBeTruthy());
    expect(getByText('Tu cuota')).toBeTruthy();
    expect(getByText('Reserva')).toBeTruthy(); // chip de categoría (verde)
    expect(getByText('Vencimiento')).toBeTruthy(); // chip de categoría (naranja, por audience_type=debtors)
  });

  it('el filtro "Importantes" deja solo la de vencimiento', async () => {
    const { getByText, queryByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Reserva confirmada')).toBeTruthy());

    fireEvent.press(getByText('Importantes'));

    await waitFor(() => expect(queryByText('Reserva confirmada')).toBeNull());
    expect(getByText('Tu cuota')).toBeTruthy();
  });

  it('tocar una notificación la marca leída y lo persiste en AsyncStorage', async () => {
    const { getByTestId, getByText, queryByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Reserva confirmada')).toBeTruthy());

    fireEvent.press(getByTestId('notif-card-n1'));

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('greenfit:notif-leidas:user-1');
      expect(raw).toContain('n1');
    });

    // El tab muestra "No leídas (1)" -- el contador va en un nodo de texto
    // aparte, por eso el match es por regex en vez de string exacto.
    fireEvent.press(getByText(/No leídas/));
    await waitFor(() => expect(queryByText('Reserva confirmada')).toBeNull());
    expect(getByText('Tu cuota')).toBeTruthy();
  });
});
