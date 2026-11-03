import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';

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
// El mock oficial de AsyncStorage ya es un jest.fn -- se usa directo (un
// spyOn + mockRestore le borraría la implementación en memoria).
const mockedSetItem = AsyncStorage.setItem as jest.Mock;

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

    // Ahora tocar abre el popup de detalle -- se cierra antes de filtrar.
    fireEvent.press(getByText('Cerrar'));

    // El tab muestra "No leídas (1)" -- el contador va en un nodo de texto
    // aparte, por eso el match es por regex en vez de string exacto.
    fireEvent.press(getByText(/No leídas/));
    await waitFor(() => expect(queryByText('Reserva confirmada')).toBeNull());
    expect(getByText('Tu cuota')).toBeTruthy();
  });
});

describe('NotificacionesMobileView -- popup de detalle y estado de leída', () => {
  const BODY_LARGO =
    'Hola equipo!\nEste mes cambiamos los horarios:\n\n- Lunes 8 a 22\n- Sábados 9 a 13\n\n' +
    'Además arrancamos con clases nuevas de movilidad. '.repeat(15) +
    '\nFin del mensaje.';
  const NOTI_LARGA = {
    id: 'n3',
    title: 'Comunicado de horarios',
    body: BODY_LARGO,
    created_at: new Date().toISOString(),
    audience_type: 'all',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockedFrom.mockImplementation(() => makeChain({ data: [...NOTIS, NOTI_LARGA], error: null }));
  });

  it('entrar a la pantalla NO marca nada como leído', async () => {
    mockedSetItem.mockClear();
    const { getByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Reserva confirmada')).toBeTruthy());

    expect(mockedSetItem).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('greenfit:notif-leidas:user-1')).toBeNull();
    expect(getByText(/No leídas \(3\)/)).toBeTruthy();
    expect(getByText('Marcar todas como leídas')).toBeTruthy();
  });

  it('tocar una notificación abre el popup con el mensaje COMPLETO (saltos de línea incluidos), etiqueta y fecha', async () => {
    const { getByTestId, queryByTestId, getByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Comunicado de horarios')).toBeTruthy());
    expect(queryByTestId('notif-detail-sheet')).toBeNull();

    fireEvent.press(getByTestId('notif-card-n3'));

    const sheet = await waitFor(() => getByTestId('notif-detail-sheet'));
    expect(sheet).toBeTruthy();
    // El cuerpo va entero y sin tocar: mismos "\n", sin recorte de líneas.
    const body = getByTestId('notif-detail-body');
    expect(body.props.children).toBe(BODY_LARGO);
    expect(body.props.numberOfLines).toBeUndefined();
    expect(getByTestId('notif-detail-date').props.children).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    // Etiqueta "Novedad" (por "comunicado") aparece en la card Y en el popup.
    const { getAllByText } = within(sheet);
    expect(getAllByText('Novedad').length).toBe(1);
    expect(getAllByText('Comunicado de horarios').length).toBe(1);
  });

  it('abrir el popup marca SOLO esa notificación como leída; las demás siguen no leídas', async () => {
    const { getByTestId, getByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Comunicado de horarios')).toBeTruthy());

    fireEvent.press(getByTestId('notif-card-n3'));

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('greenfit:notif-leidas:user-1');
      expect(JSON.parse(raw ?? '[]')).toEqual(['n3']);
    });
    expect(getByText(/No leídas \(2\)/)).toBeTruthy();
  });

  it('el botón Cerrar cierra el popup', async () => {
    const { getByTestId, queryByTestId, getByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Tu cuota')).toBeTruthy());

    fireEvent.press(getByTestId('notif-card-n2'));
    await waitFor(() => expect(getByTestId('notif-detail-sheet')).toBeTruthy());

    fireEvent.press(getByText('Cerrar'));
    await waitFor(() => expect(queryByTestId('notif-detail-sheet')).toBeNull());
  });

  it('una ya leída se puede volver a abrir sin reescribir el storage', async () => {
    await AsyncStorage.setItem('greenfit:notif-leidas:user-1', JSON.stringify(['n1']));
    mockedSetItem.mockClear();
    const { getByTestId, getByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Reserva confirmada')).toBeTruthy());

    fireEvent.press(getByTestId('notif-card-n1'));
    await waitFor(() => expect(getByTestId('notif-detail-sheet')).toBeTruthy());
    expect(mockedSetItem).not.toHaveBeenCalled();
  });

  it('"Marcar todas como leídas" sigue marcando todas', async () => {
    const { getByText, queryByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Reserva confirmada')).toBeTruthy());

    fireEvent.press(getByText('Marcar todas como leídas'));

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('greenfit:notif-leidas:user-1');
      expect(JSON.parse(raw ?? '[]').sort()).toEqual(['n1', 'n2', 'n3']);
    });
    expect(queryByText('Marcar todas como leídas')).toBeNull();
  });

  it('si falla el guardado de leídas, se le avisa al socio (no falla en silencio)', async () => {
    mockedSetItem.mockImplementationOnce(() => Promise.reject(new Error('QuotaExceeded')));
    const { getByTestId, getByText } = render(<NotificacionesMobileView />);
    await waitFor(() => expect(getByText('Reserva confirmada')).toBeTruthy());

    fireEvent.press(getByTestId('notif-card-n1'));

    await waitFor(() => expect(getByText(/No se pudo guardar qué notificaciones leíste/)).toBeTruthy());
  });
});
