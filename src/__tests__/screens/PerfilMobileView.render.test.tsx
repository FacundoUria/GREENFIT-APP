import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria', dni: '30111222', phone: null, role: 'socio' } }),
}));

jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => ({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120 } }),
}));

jest.mock('../../lib/creditsApi', () => ({
  fetchUserBalances: jest.fn().mockResolvedValue([
    {
      id: 'bal-1',
      userId: 'user-1',
      remainingCredits: null,
      expiresAt: '2026-12-31',
      createdAt: '2026-01-01',
      discipline: { id: 'disc-1', name: 'Aparatos', kind: 'membership' },
      pack: { id: 'pack-1', name: 'Pase Libre', credits: null, durationDays: 30, price: 1000, isActive: true, discipline: { id: 'disc-1', name: 'Aparatos', kind: 'membership' } },
    },
  ]),
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
import PerfilMobileView from '../../screens/user/PerfilMobileView';

const mockedFrom = supabase.from as jest.Mock;

// 1150 XP reales en xp_events -> nivel floor(1150/500)+1 = 3, con 150/500
// XP de progreso dentro de ese nivel (fórmula que xpApi.test.ts verifica
// por separado, acá solo se prueba que PerfilMobileView la conecta bien al
// badge y a la barra de progreso).
function configurarMocksReales() {
  mockedFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return makeChain({ count: 12, error: null });
    if (table === 'profiles') return makeChain({ data: { created_at: '2025-01-15T00:00:00.000Z' }, error: null });
    if (table === 'xp_events') return makeChain({ data: [{ xp_amount: 700 }, { xp_amount: 450 }], error: null });
    return makeChain({ data: [], error: null });
  });
}

describe('PerfilMobileView (Módulo 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configurarMocksReales();
  });

  it('calcula el nivel real a partir del XP acumulado (1150 XP -> NIVEL 3)', async () => {
    const { getByText } = render(<PerfilMobileView />);
    await waitFor(() => expect(getByText('NIVEL 3')).toBeTruthy());
    expect(getByText('12')).toBeTruthy(); // stat "Clases"
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
});
