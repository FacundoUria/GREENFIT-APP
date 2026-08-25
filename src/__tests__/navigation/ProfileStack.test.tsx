import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render, waitFor } from '@testing-library/react-native';

// Mismo criterio que MainTabs.test.tsx: si al socio le falta algún campo
// obligatorio del perfil, esta pila arranca directo en "MyData" (Mis datos)
// Y las demás rutas (ProfileHome/History/Progreso) quedan estructuralmente
// AFUERA del árbol -- no solo "sin mostrarse", sino sin existir, así que es
// imposible navegar a ellas desde acá mientras dure el bloqueo (ver
// ProfileScreen.test.tsx para el caso "Más opciones" oculto en ese estado).
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

let mockUser: any = { id: 'user-1', perfilCompleto: true };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import ProfileStack from '../../navigation/ProfileStack';

describe('ProfileStack -- redirección inicial por perfil incompleto', () => {
  it('socio con perfil completo: arranca en el listado de Perfil (comportamiento de siempre)', async () => {
    mockUser = { id: 'user-1', perfilCompleto: true };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <ProfileStack />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('ProfileHomeStub')).toBeTruthy());
    expect(queryByText('MyDataStub')).toBeNull();
  });

  it('socio con perfil incompleto: arranca directo en "Mis datos" y ninguna otra pantalla del perfil existe en el árbol', async () => {
    mockUser = { id: 'user-1', perfilCompleto: false };
    const { getByText, queryByText } = render(
      <NavigationContainer>
        <ProfileStack />
      </NavigationContainer>
    );
    await waitFor(() => expect(getByText('MyDataStub')).toBeTruthy());
    expect(queryByText('ProfileHomeStub')).toBeNull();
    expect(queryByText('HistoryStub')).toBeNull();
    expect(queryByText('ProgresoStub')).toBeNull();
  });
});
