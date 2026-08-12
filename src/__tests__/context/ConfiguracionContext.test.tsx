import React from 'react';
import { Text } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';

// Mismo patrón que HomeScreen.render.test.tsx para la suscripción en vivo de
// user_credits: on/subscribe encadenan (mockReturnThis-style) igual que el
// cliente real de supabase-js, capturados en variables `mock...` porque la
// factory de jest.mock corre hoisteada.
const mockChannelOn = jest.fn(function (this: unknown, ..._args: unknown[]) {
  return this;
});
const mockChannelSubscribe = jest.fn(function (this: unknown, ..._args: unknown[]) {
  return this;
});
const mockedFrom = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockedFrom(...args),
    channel: jest.fn(() => ({ on: mockChannelOn, subscribe: mockChannelSubscribe })),
    removeChannel: jest.fn(),
  },
}));

import { supabase } from '../../lib/supabase';
import { ConfiguracionProvider, useConfiguracion } from '../../context/ConfiguracionContext';

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  ['select', 'eq'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  return chain;
}

function filaConfiguracion(overrides: Record<string, unknown> = {}) {
  return {
    precio_crossfit: 0,
    precio_boxeo: 0,
    precio_kickboxing: 0,
    precio_aparatos: 0,
    dias_tolerancia: 5,
    limite_cancelacion_minutos: 120,
    alias_cvu: 'greenfit.gym',
    titular_cuenta: 'Greenfit SRL',
    alerta_app_activa: false,
    alerta_app_mensaje: '',
    ...overrides,
  };
}

// Sonda mínima -- expone lo que el Provider calcula, sin depender de ninguna
// pantalla real (HomeScreen, etc.) para no acoplar este test a su UI.
function Sonda() {
  const { configuracion, loading } = useConfiguracion();
  return (
    <>
      <Text>{loading ? 'cargando' : 'listo'}</Text>
      <Text>{configuracion.aliasCvu}</Text>
      <Text>{configuracion.titularCuenta}</Text>
    </>
  );
}

describe('ConfiguracionContext -- Alias/CVU y Titular en vivo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFrom.mockImplementation(() => makeChain({ data: filaConfiguracion(), error: null }));
  });

  it('carga Alias/CVU y Titular al montar', async () => {
    const { getByText } = render(
      <ConfiguracionProvider>
        <Sonda />
      </ConfiguracionProvider>
    );
    await waitFor(() => expect(getByText('listo')).toBeTruthy());
    expect(getByText('greenfit.gym')).toBeTruthy();
    expect(getByText('Greenfit SRL')).toBeTruthy();
  });

  // Antes, la fila de `configuracion` se pedía UNA sola vez al montar el
  // Provider -- si Seba cambiaba el Alias/CVU o el Titular desde el panel
  // Admin mientras un socio ya tenía la Home abierta con el modal "Elegí tu
  // pack" a mano, seguía viendo el dato viejo hasta cerrar y reabrir la app.
  it('se suscribe en vivo a cambios de `configuracion` y refresca Alias/Titular cuando llega un evento', async () => {
    const { getByText } = render(
      <ConfiguracionProvider>
        <Sonda />
      </ConfiguracionProvider>
    );
    await waitFor(() => expect(getByText('listo')).toBeTruthy());

    expect(supabase.channel).toHaveBeenCalledWith('configuracion-gimnasio');
    expect(mockChannelOn).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'configuracion', filter: 'id=eq.1' },
      expect.any(Function)
    );
    expect(mockChannelSubscribe).toHaveBeenCalled();

    // Seba edita Alias/Titular desde el Admin y guarda -- simula el valor
    // nuevo que devolvería el próximo fetch real.
    mockedFrom.mockImplementation(() =>
      makeChain({ data: filaConfiguracion({ alias_cvu: 'nuevo.alias', titular_cuenta: 'Nuevo Titular SRL' }), error: null })
    );

    const callbackRealtime = mockChannelOn.mock.calls[0][2] as (payload: unknown) => void;
    await act(async () => {
      callbackRealtime({});
    });

    await waitFor(() => expect(getByText('nuevo.alias')).toBeTruthy());
    expect(getByText('Nuevo Titular SRL')).toBeTruthy();
  });

  it('al desmontar, da de baja el canal de Realtime (no deja una suscripción huérfana)', async () => {
    const { getByText, unmount } = render(
      <ConfiguracionProvider>
        <Sonda />
      </ConfiguracionProvider>
    );
    await waitFor(() => expect(getByText('listo')).toBeTruthy());

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });
});
