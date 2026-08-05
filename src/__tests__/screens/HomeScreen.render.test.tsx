import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// HomeScreen usa useFocusEffect (no useEffect simple) para el refresh al
// volver de la WebView de pago -- sin un NavigationContainer real alrededor,
// hay que mockearlo para que dispare el callback una vez al montar, igual
// que un focus real haría la primera vez.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => {
      callback();
    }, []);
  },
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria', avatarUrl: null } }),
}));
jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => ({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120, aliasCvu: null, titularCuenta: null } }),
}));
jest.mock('../../hooks/useTicker', () => ({ useTicker: () => {} }));
jest.mock('../../lib/notificationsBadge', () => ({ fetchUnreadNotificationCount: jest.fn().mockResolvedValue(0) }));
jest.mock('../../lib/creditsApi', () => ({
  fetchUserBalances: jest.fn().mockResolvedValue([]),
  fetchPacks: jest.fn().mockResolvedValue([]),
  syncMyMembership: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

// fetchTotalXp/checkXpDisponible/fetchAsistenciaHoyRegistrada/otorgarXpAsistenciaDiaria
// se mockean (tocan red); calcularResumenXp/XP_POR_NIVEL quedan REALES (son
// lógica pura, ya cubierta aparte en xpApi.test.ts) para no reinventar la
// fórmula acá.
jest.mock('../../lib/xpApi', () => ({
  ...jest.requireActual('../../lib/xpApi'),
  fetchTotalXp: jest.fn(),
  checkXpDisponible: jest.fn(),
  fetchAsistenciaHoyRegistrada: jest.fn(),
  otorgarXpAsistenciaDiaria: jest.fn(),
}));

import { supabase } from '../../lib/supabase';
import {
  fetchTotalXp,
  checkXpDisponible,
  fetchAsistenciaHoyRegistrada,
  otorgarXpAsistenciaDiaria,
} from '../../lib/xpApi';
import HomeScreen from '../../screens/user/HomeScreen';

const mockedFrom = supabase.from as jest.Mock;
const navigation = { navigate: jest.fn() };

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'gte', 'order'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('HomeScreen (Dashboard -- widget de Progreso Diario reemplaza a "Mi Pase")', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFrom.mockImplementation(() => makeChain({ data: [], error: null })); // sin reservas próximas
    (fetchTotalXp as jest.Mock).mockResolvedValue(650); // nivel 2, 150/500 XP, faltan 350
    (checkXpDisponible as jest.Mock).mockResolvedValue(true);
    (fetchAsistenciaHoyRegistrada as jest.Mock).mockResolvedValue(false);
    (otorgarXpAsistenciaDiaria as jest.Mock).mockResolvedValue('otorgado');
  });

  it('NO renderiza la tarjeta "Mi Pase / Comprar" (removida -- esa gestión ahora vive en Perfil > Pagos y Facturas)', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());
    expect(queryByText('Mi Pase')).toBeNull();
    expect(queryByText('Comprar')).toBeNull();
  });

  it('el widget circular muestra el nivel y el XP de progreso reales', async () => {
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('N2')).toBeTruthy());
    expect(getByText('150/500')).toBeTruthy();
    expect(getByText(/Te faltan/)).toBeTruthy();
    expect(getByText('350 XP')).toBeTruthy();
  });

  it('el botón "¡Hoy entrené!" está en el widget y al tocarlo otorga +100 XP, pasa a "ya registrado" y actualiza el contador de XP al instante (sin recargar la pantalla)', async () => {
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    const boton = await waitFor(() => getByText('¡Hoy entrené! (+100 XP)'));

    fireEvent.press(boton);

    await waitFor(() => expect(otorgarXpAsistenciaDiaria).toHaveBeenCalledWith('user-1', false));
    await waitFor(() => expect(getByText('Entrenamiento de hoy ya registrado')).toBeTruthy());
    // Update optimista: 650 + 100 = 750 XP -> sigue en NIVEL 2, pero el
    // progreso pasa de 150/500 a 250/500 en el mismo render, sin esperar a
    // un refetch (fetchTotalXp real solo se llamó UNA vez, al montar).
    await waitFor(() => expect(getByText('250/500')).toBeTruthy());
    expect(getByText('250 XP')).toBeTruthy();
    expect(fetchTotalXp).toHaveBeenCalledTimes(1);
  });

  it('el ícono "¿Cómo ganar XP?" abre el modal con las reglas', async () => {
    const { getByText, getByLabelText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

    fireEvent.press(getByLabelText('¿Cómo ganar XP?'));

    await waitFor(() => expect(getByText('¿Cómo ganar XP?')).toBeTruthy());
    expect(getByText('Asistencia diaria / ¡Hoy entrené!')).toBeTruthy();
  });
});
