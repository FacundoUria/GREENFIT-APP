import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render, waitFor } from '@testing-library/react-native';

// Mismo criterio que MainTabs.test.tsx: si al socio le faltan datos de
// emergencia, esta pila arranca directo en "MyData" (Mis datos) en vez del
// listado -- una sola vez al montar, sin quitar ninguna otra ruta (History/
// Progreso siguen registradas y alcanzables, ver ProfileScreen.test.tsx
// para el caso "Más opciones" siempre visible).
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
jest.mock('../../screens/user/ProfileScreen', () => mockStub('MyDataStub'));
jest.mock('../../screens/user/PerfilMobileView', () => mockStub('ProfileHomeStub'));
jest.mock('../../screens/user/HistoryScreen', () => mockStub('HistoryStub'));
jest.mock('../../screens/user/ProgresoMobileView', () => mockStub('ProgresoStub'));

let mockUser: any = { id: 'user-1', datosEmergenciaCompletos: true };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import ProfileStack from '../../navigation/ProfileStack';

describe('ProfileStack -- redirección inicial por datos de emergencia incompletos', () => {
  it('socio con datos completos: arranca en el listado de Perfil (comportamiento de siempre)', async () => {
    mockUser = { id: 'user-1', datosEmergenciaCompletos: true };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <ProfileStack />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('ProfileHomeStub')).toBeTruthy());
    expect(queryByText('MyDataStub')).toBeNull();
  });

  it('socio con datos de emergencia incompletos: arranca directo en "Mis datos"', async () => {
    mockUser = { id: 'user-1', datosEmergenciaCompletos: false };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <ProfileStack />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('MyDataStub')).toBeTruthy());
    expect(queryByText('ProfileHomeStub')).toBeNull();
  });
});
