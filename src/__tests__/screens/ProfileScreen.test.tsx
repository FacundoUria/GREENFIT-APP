import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

// Perfil obligatorio (pedido del cliente): Nombre, Apellido, DNI, Correo,
// Teléfono, Teléfono de emergencia y Domicilio -- ver AuthContext.tsx /
// MainTabs.tsx / ProfileStack.tsx. Esta pantalla ("Mis Datos") es la misma
// que ProfileStack monta a solas (bloqueando el resto de las pantallas DE
// LA PESTAÑA Perfil, no de la app entera) cuando `user.perfilCompleto` es
// false. Estos tests cubren la validación/guardado/desbloqueo que vive ACÁ
// -- el gating de navegación en sí (qué stack se monta) se cubre en el E2E.

jest.mock('../../hooks/usePushPermission', () => ({
  usePushPermission: () => ({
    supported: false,
    enabled: false,
    permission: null,
    isLoading: false,
    toggle: jest.fn(),
    iosNeedsInstall: false,
  }),
}));

const mockLogout = jest.fn();
const mockMarcarPerfilCompleto = jest.fn();
let mockUser: any = {
  id: 'user-1',
  name: 'Isa Giurato',
  dni: '30111222',
  phone: null,
  role: 'socio',
  avatarUrl: null,
  perfilCompleto: false,
};
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: mockLogout,
    marcarPerfilCompleto: mockMarcarPerfilCompleto,
  }),
}));

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'update', 'eq', 'order', 'limit'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.single = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const PERFIL_INCOMPLETO = {
  full_name: 'Isa Giurato',
  dni: '30111222',
  email: 'isa@greenfit.test',
  phone: null,
  domicilio: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  medical_notes: null,
};

const PERFIL_COMPLETO = {
  full_name: 'Isa Giurato',
  dni: '30111222',
  email: 'isa@greenfit.test',
  phone: '1122334455',
  domicilio: 'Av. Siempre Viva 742',
  emergency_contact_name: 'Juan Pérez',
  emergency_contact_phone: '1155667788',
  medical_notes: 'Sin condiciones preexistentes.',
};

let mockUpdateResult: any = { data: null, error: null };
let mockRpcResult: any = { data: null, error: null };

const mockRpc = jest.fn((..._args: any[]) => Promise.resolve(mockRpcResult));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: (...args: any[]) => mockRpc(...args) } }));

import { supabase } from '../../lib/supabase';
import ProfileScreen from '../../screens/user/ProfileScreen';

const mockedFrom = supabase.from as jest.Mock;

function configurarMocks(perfil: any) {
  mockedFrom.mockImplementation((table: string) => {
    if (table !== 'profiles') throw new Error(`Tabla inesperada: ${table}`);
    const chain = makeChain({ data: perfil, error: null });
    // .update(...).eq(...) no pasa por .single() -- lo resuelve el `then`
    // del propio chain, así que apuntamos su resultado (mockUpdateResult)
    // ahí en vez de en `.single`.
    chain.then = (resolve: any, reject: any) => Promise.resolve(mockUpdateResult).then(resolve, reject);
    return chain;
  });
}

describe('ProfileScreen ("Mis Datos") -- perfil obligatorio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateResult = { data: null, error: null };
    mockRpcResult = { data: null, error: null };
    // ProfileScreen.tsx llama a showAlert(), no a Alert.alert() directo (ver
    // crossPlatformAlert.ts -- Alert.alert es un no-op mudo en Web). Este
    // spy sigue siendo válido: jest-expo simula Platform.OS='ios' por
    // defecto, así que showAlert() cae en su rama nativa y llama a este
    // mismo Alert.alert de abajo -- pero esto NO cubre la rama Web (la que
    // realmente estaba rota). Ver crossPlatformAlert.test.ts para el test
    // que fuerza Platform.OS='web' y confirma window.alert.
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('socio bloqueado (perfil incompleto): muestra el banner de aviso, Nombre/Apellido separados y Correo de solo lectura', async () => {
    mockUser = { ...mockUser, perfilCompleto: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByLabelText, getByText, getByDisplayValue } = render(
      <ProfileScreen navigation={{ navigate: jest.fn() }} />
    );
    await waitFor(() => expect(getByLabelText('Perfil incompleto')).toBeTruthy());
    expect(getByText(/el gimnasio exige tener completos tus datos/)).toBeTruthy();
    // full_name = "Isa Giurato" se separa en Nombre/Apellido solo para
    // mostrarse -- no hay columnas nuevas de por medio.
    expect(getByDisplayValue('Isa')).toBeTruthy();
    expect(getByDisplayValue('Giurato')).toBeTruthy();
    expect(getByDisplayValue('isa@greenfit.test')).toBeTruthy();
  });

  it('socio con perfil completo: NO muestra el banner de bloqueo', async () => {
    mockUser = { ...mockUser, perfilCompleto: true };
    configurarMocks(PERFIL_COMPLETO);
    const { queryByLabelText, getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());
    expect(queryByLabelText('Perfil incompleto')).toBeNull();
  });

  it('mientras el perfil está incompleto, "Más opciones" (historial de clases) no se muestra -- esa ruta no existe en la pila reducida de ProfileStack', async () => {
    mockUser = { ...mockUser, perfilCompleto: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { queryByText, getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());
    expect(queryByText('Ver historial de clases')).toBeNull();
  });

  it('con perfil completo, "Más opciones" se muestra y navega a History', async () => {
    mockUser = { ...mockUser, perfilCompleto: true };
    configurarMocks(PERFIL_COMPLETO);
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<ProfileScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Ver historial de clases')).toBeTruthy());
    fireEvent.press(getByText('Ver historial de clases'));
    expect(navigation.navigate).toHaveBeenCalledWith('History');
  });

  it('guardar con Teléfono / Domicilio / Teléfono de emergencia vacíos: bloquea el guardado con un Alert, no llama a marcarPerfilCompleto', async () => {
    mockUser = { ...mockUser, perfilCompleto: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Faltan datos obligatorios',
        'Completá Teléfono, Domicilio y Teléfono de emergencia antes de guardar.'
      )
    );
    expect(mockMarcarPerfilCompleto).not.toHaveBeenCalled();
    // `from('profiles')` solo se llamó una vez (la carga inicial) -- la
    // validación cortó ANTES de intentar el `update` con datos vacíos.
    expect(mockedFrom).toHaveBeenCalledTimes(1);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('Contacto de emergencia (nombre) y Ficha médica quedaron afuera del set obligatorio: completar solo Teléfono/Domicilio/Teléfono de emergencia alcanza para guardar', async () => {
    mockUser = { ...mockUser, perfilCompleto: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByText, getByPlaceholderText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Teléfono / WhatsApp'), '1122334455');
    fireEvent.changeText(getByPlaceholderText('Calle, número, localidad'), 'Av. Siempre Viva 742');
    fireEvent.changeText(getByPlaceholderText('Teléfono del contacto'), '1155667788');

    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => expect(mockMarcarPerfilCompleto).toHaveBeenCalledTimes(1));
    expect(Alert.alert).toHaveBeenCalledWith('Guardado', 'Tus datos se actualizaron.');
    expect(Alert.alert).not.toHaveBeenCalledWith('Faltan datos obligatorios', expect.anything());
    // Sincronización estricta con el panel Admin -- ver
    // supabase_migration_domicilio_y_sync_telefono.sql.
    expect(mockRpc).toHaveBeenCalledWith('sincronizar_telefono_a_socio');
  });

  it('si el RPC de sincronización con el Admin falla (ej. migración no corrida todavía), el guardado igual se completa -- best-effort', async () => {
    mockUser = { ...mockUser, perfilCompleto: false };
    configurarMocks(PERFIL_INCOMPLETO);
    mockRpcResult = { data: null, error: { message: 'function not found in schema cache' } };
    const { getByText, getByPlaceholderText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Teléfono / WhatsApp'), '1122334455');
    fireEvent.changeText(getByPlaceholderText('Calle, número, localidad'), 'Av. Siempre Viva 742');
    fireEvent.changeText(getByPlaceholderText('Teléfono del contacto'), '1155667788');

    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => expect(mockMarcarPerfilCompleto).toHaveBeenCalledTimes(1));
    expect(Alert.alert).toHaveBeenCalledWith('Guardado', 'Tus datos se actualizaron.');
  });

  it('si falla el guardado en el backend, NO desbloquea la pestaña (marcarPerfilCompleto no se llama)', async () => {
    mockUser = { ...mockUser, perfilCompleto: false };
    configurarMocks(PERFIL_INCOMPLETO);
    mockUpdateResult = { data: null, error: { message: 'Network error' } };
    const { getByText, getByPlaceholderText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Teléfono / WhatsApp'), '1122334455');
    fireEvent.changeText(getByPlaceholderText('Calle, número, localidad'), 'Av. Siempre Viva 742');
    fireEvent.changeText(getByPlaceholderText('Teléfono del contacto'), '1155667788');

    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Error', 'Network error'));
    expect(mockMarcarPerfilCompleto).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('el botón "Cerrar sesión" queda siempre visible y funcional, incluso con el perfil incompleto (salir no es "usar la app")', async () => {
    mockUser = { ...mockUser, perfilCompleto: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.press(getByText('Cerrar sesión'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
