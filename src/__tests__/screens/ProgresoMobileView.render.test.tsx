import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria' } }),
}));

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'gte', 'lte', 'is', 'limit', 'order'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../lib/supabase';
import ProgresoMobileView from '../../screens/user/ProgresoMobileView';

const mockedFrom = supabase.from as jest.Mock;

describe('ProgresoMobileView (Módulo 5 -- PRs y evolución de cargas)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    // Sin bookings del mes/históricos -- simplifica las métricas a 0 y deja
    // el foco de estos tests en la parte de PRs, que es 100% local.
    // metas_personales aparte: .maybeSingle() espera null (no []) cuando no
    // hay meta activa.
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'metas_personales') return makeChain({ data: null, error: null });
      return makeChain({ data: [], error: null });
    });
  });

  it('arranca con el estado vacío del gráfico cuando no hay PRs cargados', async () => {
    const { getByText } = render(<ProgresoMobileView />);
    await waitFor(() => expect(getByText(/Registrá tu primer PR/)).toBeTruthy());
  });

  it('registrar un PR de Back Squat lo muestra en su card', async () => {
    const { getByText, getByPlaceholderText } = render(<ProgresoMobileView />);
    await waitFor(() => expect(getByText('Back Squat')).toBeTruthy());

    fireEvent.press(getByText('Back Squat'));
    await waitFor(() => expect(getByPlaceholderText('Ej: 82.5')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('Ej: 82.5'), '100');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => expect(getByText('100 kg')).toBeTruthy());
  });

  it('el gráfico SVG deja el placeholder vacío tras registrar un 2do PR de peso', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(<ProgresoMobileView />);
    await waitFor(() => expect(getByText('Back Squat')).toBeTruthy());

    fireEvent.press(getByText('Back Squat'));
    fireEvent.changeText(getByPlaceholderText('Ej: 82.5'), '100');
    fireEvent.press(getByText('Guardar'));
    await waitFor(() => expect(getByText('100 kg')).toBeTruthy());

    fireEvent.press(getByText('Peso Muerto'));
    fireEvent.changeText(getByPlaceholderText('Ej: 82.5'), '140');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => expect(queryByText(/Registrá tu primer PR/)).toBeNull());
    expect(getByText(/kg totales/)).toBeTruthy();
  });

  it('rechaza un valor inválido sin guardar el PR', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    const { getByText, getByPlaceholderText } = render(<ProgresoMobileView />);
    await waitFor(() => expect(getByText('Back Squat')).toBeTruthy());

    fireEvent.press(getByText('Back Squat'));
    fireEvent.changeText(getByPlaceholderText('Ej: 82.5'), 'no-es-un-numero');
    fireEvent.press(getByText('Guardar'));

    expect(alertSpy).toHaveBeenCalledWith('Valor inválido', expect.any(String));
    alertSpy.mockRestore();
  });
});
