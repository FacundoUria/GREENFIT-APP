import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render, waitFor } from '@testing-library/react-native';

// Redirección de "una sola vez al entrar" (exigencia de seguridad médica,
// ver types/index.ts): si al socio le faltan datos de emergencia, MainTabs
// arranca en el tab Perfil en vez de Inicio -- SIN ocultar ni deshabilitar
// ningún otro tab (ver MainTabs.tsx). Cada tab real se reemplaza por un
// stub liviano acá: lo único que interesa es CUÁL arranca montado, no el
// contenido real de cada pantalla (que ya tiene su propia suite).
// jest.mock() se hoistea antes de los imports -- la factory no puede
// referenciar `Text` importado arriba (out-of-scope), así que cada stub
// arma el elemento a mano con React.createElement + require() adentro.
function mockStub(texto: string) {
  return () => {
    const ReactActual = require('react');
    const { Text: TextActual } = require('react-native');
    return ReactActual.createElement(TextActual, null, texto);
  };
}
jest.mock('../../navigation/HomeStack', () => mockStub('HomeStackStub'));
jest.mock('../../screens/user/AgendaMobileView', () => mockStub('AgendaStub'));
jest.mock('../../navigation/ProfileStack', () => mockStub('ProfileStackStub'));
jest.mock('../../screens/user/UserRoutineScreen', () => mockStub('RutinaStub'));
jest.mock('../../screens/user/ComunidadMobileView', () => mockStub('ComunidadStub'));

jest.mock('../../hooks/useNotificationSubscription', () => ({ useNotificationSubscription: jest.fn() }));
jest.mock('../../hooks/usePushPermission', () => ({ useAutoRequestWebPush: jest.fn() }));

let mockUser: any = { id: 'user-1', perfilCompleto: true };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import MainTabs from '../../navigation/MainTabs';

describe('MainTabs -- redirección inicial por perfil incompleto', () => {
  it('socio con perfil completo: arranca en Inicio (comportamiento de siempre)', async () => {
    mockUser = { id: 'user-1', perfilCompleto: true };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <MainTabs />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('HomeStackStub')).toBeTruthy());
    expect(queryByText('ProfileStackStub')).toBeNull();
  });

  it('socio con perfil incompleto: arranca en Perfil (una sola vez al montar)', async () => {
    mockUser = { id: 'user-1', perfilCompleto: false };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <MainTabs />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('ProfileStackStub')).toBeTruthy());
    expect(queryByText('HomeStackStub')).toBeNull();
  });
});

describe('MainTabs -- barra flotante: mismas 5 pestañas, mismos nombres', () => {
  it('muestra Inicio, Agenda, Mi Rutina, Comunidad y Perfil (la ruta de Agenda sigue siendo "Reservas" pero se ve como "Agenda")', async () => {
    mockUser = { id: 'user-1', perfilCompleto: true };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <MainTabs />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('HomeStackStub')).toBeTruthy());
    for (const etiqueta of ['Inicio', 'Agenda', 'Mi Rutina', 'Comunidad', 'Perfil']) {
      expect(getByText(etiqueta)).toBeTruthy();
    }
    // Ninguna pestaña de más (ni la vieja "Reservas" como etiqueta visible).
    expect(queryByText('Reservas')).toBeNull();
    expect(queryByText('Notificaciones')).toBeNull();
    expect(queryByText('Progreso')).toBeNull();
  });
});

// Tanda visual (base): con la app instalada, la barra de gestos (zona segura de
// abajo) no tapa la barra de pestañas -- se suma al alto y al relleno de abajo.
describe('MainTabs -- zona segura de abajo', () => {
  function alturasDeLaBarra(root: any) {
    const { StyleSheet } = require('react-native');
    return root
      .findAll((n: any) => typeof n.type === 'string' && n.props?.style)
      .map((n: any) => StyleSheet.flatten(n.props.style))
      .filter((s: any) => s && s.height !== undefined && s.paddingBottom !== undefined)
      .map((s: any) => ({ height: s.height, paddingBottom: s.paddingBottom }));
  }

  async function renderConInsets(bottom: number) {
    const { SafeAreaProvider } = require('react-native-safe-area-context');
    mockUser = { id: 'user-1', perfilCompleto: true };
    const utils = render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom, left: 0, right: 0 } }}
      >
        <NavigationContainer>
          <MainTabs />
        </NavigationContainer>
      </SafeAreaProvider>
    );
    await waitFor(() => expect(utils.getByText('HomeStackStub')).toBeTruthy());
    return utils;
  }

  it('sin barra de gestos: la barra mide lo de siempre (84 de alto, 18 abajo)', async () => {
    const { UNSAFE_root } = await renderConInsets(0);
    expect(alturasDeLaBarra(UNSAFE_root)).toContainEqual({ height: 84, paddingBottom: 18 });
  });

  it('con 34 px de barra de gestos: 118 de alto y 52 abajo', async () => {
    const { UNSAFE_root } = await renderConInsets(34);
    expect(alturasDeLaBarra(UNSAFE_root)).toContainEqual({ height: 118, paddingBottom: 52 });
  });
});
