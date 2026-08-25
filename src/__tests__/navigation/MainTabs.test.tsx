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

let mockUser: any = { id: 'user-1', datosEmergenciaCompletos: true };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import MainTabs from '../../navigation/MainTabs';

describe('MainTabs -- redirección inicial por datos de emergencia incompletos', () => {
  it('socio con datos completos: arranca en Inicio (comportamiento de siempre)', async () => {
    mockUser = { id: 'user-1', datosEmergenciaCompletos: true };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <MainTabs />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('HomeStackStub')).toBeTruthy());
    expect(queryByText('ProfileStackStub')).toBeNull();
  });

  it('socio con datos de emergencia incompletos: arranca en Perfil (una sola vez al montar)', async () => {
    mockUser = { id: 'user-1', datosEmergenciaCompletos: false };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <MainTabs />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('ProfileStackStub')).toBeTruthy());
    expect(queryByText('HomeStackStub')).toBeNull();
  });
});
