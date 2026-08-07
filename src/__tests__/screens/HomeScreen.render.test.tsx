import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

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
  useConfiguracion: () => ({
    configuracion: {
      diasTolerancia: 5,
      limiteCancelacionMinutos: 120,
      aliasCvu: null,
      titularCuenta: null,
      alertaActiva: false,
      alertaMensaje: '',
    },
  }),
}));
jest.mock('../../hooks/useTicker', () => ({ useTicker: () => {} }));
jest.mock('../../lib/notificationsBadge', () => ({ fetchUnreadNotificationCount: jest.fn().mockResolvedValue(0) }));
jest.mock('../../lib/creditsApi', () => ({
  fetchUserBalances: jest.fn().mockResolvedValue([]),
  fetchPacks: jest.fn().mockResolvedValue([]),
  syncMyMembership: jest.fn().mockResolvedValue(undefined),
}));
// on/subscribe encadenan (mockReturnThis-style) igual que el cliente real de
// supabase-js -- capturados en variables de nombre `mock...` porque la
// factory de jest.mock corre hoisteada y Jest solo permite referenciar acá
// identificadores con ese prefijo.
const mockChannelOn = jest.fn(function (this: unknown, ..._args: unknown[]) {
  return this;
});
const mockChannelSubscribe = jest.fn(function (this: unknown, ..._args: unknown[]) {
  return this;
});
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    channel: jest.fn(() => ({ on: mockChannelOn, subscribe: mockChannelSubscribe })),
    removeChannel: jest.fn(),
  },
}));

// fetchTotalXp/fetchAsistenciaHoyRegistrada/fetchClasesDelMes/
// fetchMiembroDesde/fetchFechasAsistencia se mockean (tocan red -- makeChain
// de abajo no implementa .single()/.maybeSingle(), así que la versión real
// de fetchMiembroDesde rompería contra ese mock); calcularResumenXp/
// calcularRachaDias/XP_POR_NIVEL quedan REALES (son lógica pura, ya
// cubierta aparte en xpApi.test.ts) para no reinventar la fórmula acá.
jest.mock('../../lib/xpApi', () => ({
  ...jest.requireActual('../../lib/xpApi'),
  fetchTotalXp: jest.fn(),
  fetchAsistenciaHoyRegistrada: jest.fn(),
  fetchClasesDelMes: jest.fn(),
  fetchMiembroDesde: jest.fn(),
  fetchFechasAsistencia: jest.fn(),
}));

import { supabase } from '../../lib/supabase';
import { fetchUserBalances } from '../../lib/creditsApi';
import {
  fetchTotalXp,
  fetchAsistenciaHoyRegistrada,
  fetchClasesDelMes,
  fetchMiembroDesde,
  fetchFechasAsistencia,
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
    (fetchAsistenciaHoyRegistrada as jest.Mock).mockResolvedValue(false);
    (fetchClasesDelMes as jest.Mock).mockResolvedValue(0);
    (fetchMiembroDesde as jest.Mock).mockResolvedValue(null);
    (fetchFechasAsistencia as jest.Mock).mockResolvedValue([]);
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

  it('el widget de asistencia es de SOLO LECTURA: sin check-in del Admin, no hay ninguna acción para autoreportarse', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Todavía no registraste tu entrada hoy')).toBeTruthy());

    // El viejo botón autoreportable ya no existe en ningún lado.
    expect(queryByText('¡Hoy entrené! (+100 XP)')).toBeNull();
  });

  it('si el Admin ya acreditó la asistencia de hoy, el widget la refleja en verde', async () => {
    (fetchAsistenciaHoyRegistrada as jest.Mock).mockResolvedValue(true);
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Entrenamiento de hoy ya registrado')).toBeTruthy());
  });

  it('el ícono "¿Cómo ganar XP?" abre el modal con la única regla vigente (asistencia acreditada por el Admin)', async () => {
    const { getByText, getAllByLabelText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

    // Hay 2 en pantalla ahora (la tarjeta de perfil gamificada de arriba +
    // el widget de Progreso Diario) -- las dos abren el mismo modal
    // (mismo estado xpInfoVisible), así que alcanza con tocar cualquiera.
    fireEvent.press(getAllByLabelText('¿Cómo ganar XP?')[0]);

    await waitFor(() => expect(getByText('¿Cómo ganar XP?')).toBeTruthy());
    expect(getByText('Asistencia diaria')).toBeTruthy();
    expect(getByText(/Acreditados presencialmente al realizar tu check-in en el gimnasio/)).toBeTruthy();
    // Las reglas dadas de baja ya no aparecen.
    expect(queryByText('Publicar en la Comunidad')).toBeNull();
    expect(queryByText('Superar un Récord Personal (PR)')).toBeNull();
    expect(queryByText('Completar una Meta Personal')).toBeNull();
  });

  // Bug crítico de sincronización Admin↔PWA (2026-08-07): un ajuste de
  // créditos hecho desde el panel Admin (user_credits) solo se veía acá
  // recién al salir de Inicio y volver a entrar (useFocusEffect). Esto
  // prueba que, ADEMÁS, hay una suscripción en vivo -- si la pantalla ya
  // está abierta cuando el Admin ajusta algo, el balance se refresca solo,
  // sin que el socio tenga que navegar a ningún lado.
  it('se suscribe en vivo a cambios de user_credits del propio socio y refresca el balance cuando llega un evento', async () => {
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

    expect(supabase.channel).toHaveBeenCalledWith('user-credits-user-1');
    expect(mockChannelOn).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_credits', filter: 'user_id=eq.user-1' },
      expect.any(Function)
    );
    expect(mockChannelSubscribe).toHaveBeenCalled();

    (fetchUserBalances as jest.Mock).mockClear();
    const callbackRealtime = mockChannelOn.mock.calls[0][2] as (payload: unknown) => void;
    await act(async () => {
      callbackRealtime({});
    });

    await waitFor(() => expect(fetchUserBalances).toHaveBeenCalledTimes(1));
  });

  it('al desmontar la pantalla, se da de baja el canal de Realtime (no deja una suscripción huérfana)', async () => {
    const { getByText, unmount } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});
