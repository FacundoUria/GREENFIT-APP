import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { formatDateOnly } from '../../lib/classesApi';

// PerfilMobileView usa useFocusEffect (no useEffect a secas) para refrescar
// XP/racha/clases cada vez que la pantalla vuelve a foco -- ver el bugfix de
// sincronización de XP. Sin un NavigationContainer real, hay que mockearlo
// para que dispare el callback una vez al montar (mismo criterio que
// HomeScreen.render.test.tsx).
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => {
      callback();
    }, []);
  },
}));

const mockUpdateAvatarUrl = jest.fn();
const mockLogout = jest.fn();
const mockUser = { id: 'user-1', name: 'Facundo Uria', dni: '30111222', phone: null, role: 'socio', avatarUrl: null as string | null };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, updateAvatarUrl: mockUpdateAvatarUrl, logout: mockLogout }),
}));

jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => ({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120 } }),
}));

jest.mock('../../lib/creditsApi', () => ({
  // creditosOriginalesPara es lógica pura (sin red) -- se deja real en vez
  // de mockearla, para no dejar un import undefined que reviente el día
  // que un test futuro pruebe un balance kind='credits' con pack.
  ...jest.requireActual('../../lib/creditsApi'),
  fetchUserBalances: jest.fn().mockResolvedValue([
    {
      id: 'bal-1',
      userId: 'user-1',
      remainingCredits: null,
      expiresAt: '2026-12-31',
      createdAt: '2026-01-01',
      discipline: { id: 'disc-1', name: 'Aparatos', kind: 'membership' },
      pack: { id: 'pack-1', name: 'Pase Libre', creditos: [], incluyeAparatos: true, diasVigencia: 30, price: 1000, isActive: true },
    },
  ]),
}));

jest.mock('../../lib/avatarApi', () => ({
  checkAvatarDisponible: jest.fn().mockResolvedValue(true),
  subirAvatarPerfil: jest.fn().mockResolvedValue('https://cdn/avatars/user-1/avatar.jpg?t=123'),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/foto.jpg' }] }),
}));

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'order', 'limit', 'gte', 'lte', 'in'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.single = jest.fn().mockResolvedValue(result);
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import { checkAvatarDisponible, subirAvatarPerfil } from '../../lib/avatarApi';
import PerfilMobileView from '../../screens/user/PerfilMobileView';

const mockedFrom = supabase.from as jest.Mock;

// 1150 XP reales en xp_events -> nivel floor(1150/500)+1 = 3, con 150/500
// XP de progreso dentro de ese nivel (fórmula que xpApi.test.ts verifica
// por separado, acá solo se prueba que PerfilMobileView la conecta bien al
// badge y a la barra de progreso). HOY y AYER tienen asistencia real -> la
// racha (días consecutivos) y "Clases (mes)" (días distintos del mes con
// asistencia) dan 2, ambos calculados sobre las mismas 2 filas de
// xp_events -- fechas relativas a la fecha real de ejecución del test, no
// hardcodeadas, para que nunca se desalinee con "hoy".
const HOY = formatDateOnly(new Date());
const AYER = formatDateOnly(new Date(Date.now() - 86_400_000));

function configurarMocksReales() {
  mockedFrom.mockImplementation((table: string) => {
    if (table === 'profiles') return makeChain({ data: { created_at: '2025-01-15T00:00:00.000Z' }, error: null });
    if (table === 'xp_events') {
      return makeChain({
        data: [
          { xp_amount: 700, event_date: HOY },
          { xp_amount: 450, event_date: AYER },
        ],
        error: null,
      });
    }
    return makeChain({ data: [], error: null });
  });
}

describe('PerfilMobileView (Módulo 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.avatarUrl = null;
    configurarMocksReales();
  });

  it('calcula el nivel real a partir del XP acumulado (1150 XP -> NIVEL 3)', async () => {
    const { getByText, getByTestId } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy());
    // Racha real (2 días consecutivos: hoy + ayer) y "Clases (mes)" (2 días
    // distintos con asistencia este mes) -- ya no un placeholder fijo ni el
    // conteo histórico total bajo la etiqueta "Clases".
    expect(getByTestId('stat-racha').props.children).toBe(2);
    expect(getByTestId('stat-clases').props.children).toBe(2);
  });

  it('muestra la barra de progreso "X / 500 XP" del nivel actual', async () => {
    const { getByText } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('150 / 500 XP')).toBeTruthy());
  });

  it('muestra el plan activo (Pase Libre) con su badge de estado', async () => {
    const { getByText } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('Pase Libre')).toBeTruthy());
    expect(getByText('Activo')).toBeTruthy();
  });

  it('navega a "Mis Datos" a través de onNavigate cuando está conectado', async () => {
    const onNavigate = jest.fn();
    const { getByText } = render(<PerfilMobileView onNavigate={onNavigate} />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy()); // espera a que asiente la carga async
    fireEvent.press(getByText('Mis Datos'));
    expect(onNavigate).toHaveBeenCalledWith('mis-datos');
  });

  it('el acceso "Soporte" abre WhatsApp directo sin pasar por onNavigate', async () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    const onNavigate = jest.fn();
    const { getByText } = render(<PerfilMobileView onNavigate={onNavigate} />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy());
    fireEvent.press(getByText('Soporte'));
    expect(openURLSpy).toHaveBeenCalledWith(expect.stringContaining('wa.me'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('el botón "¿Cómo ganar XP?" abre el modal con la única regla vigente (asistencia acreditada por el Admin)', async () => {
    const { getByText, getByLabelText, queryByText } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy());

    fireEvent.press(getByLabelText('¿Cómo ganar XP?'));

    await waitFor(() => expect(getByText('¿Cómo ganar XP?')).toBeTruthy());
    expect(getByText('Asistencia diaria')).toBeTruthy();
    expect(getByText(/Acreditados presencialmente al realizar tu check-in en el gimnasio/)).toBeTruthy();
    // Publicar/PR/Metas dejaron de otorgar XP -- ya no se listan acá.
    expect(queryByText('Publicar en la Comunidad')).toBeNull();
    expect(queryByText('Superar un Récord Personal (PR)')).toBeNull();
    expect(queryByText('Completar una Meta Personal')).toBeNull();
  });

  it('tocar el avatar sube una foto nueva y la refleja al instante vía updateAvatarUrl', async () => {
    const { getByText, getByLabelText } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy());

    fireEvent.press(getByLabelText('Cambiar foto de perfil'));

    await waitFor(() => expect(checkAvatarDisponible).toHaveBeenCalled());
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(subirAvatarPerfil).toHaveBeenCalledWith('user-1', 'file:///tmp/foto.jpg')
    );
    await waitFor(() =>
      expect(mockUpdateAvatarUrl).toHaveBeenCalledWith('https://cdn/avatars/user-1/avatar.jpg?t=123')
    );
  });

  it('si la función de avatar todavía no está disponible, no intenta abrir el picker', async () => {
    (checkAvatarDisponible as jest.Mock).mockResolvedValue(false);
    const { getByText, getByLabelText } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy());

    fireEvent.press(getByLabelText('Cambiar foto de perfil'));

    await waitFor(() => expect(checkAvatarDisponible).toHaveBeenCalled());
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('el botón sutil de "Cerrar sesión" llama a logout()', async () => {
    const { getByText, getByLabelText } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy());

    fireEvent.press(getByLabelText('Cerrar sesión'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
