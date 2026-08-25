import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

// Formulario obligatorio de emergencia (exigencia de seguridad médica del
// gimnasio) -- ver AuthContext.tsx / RootNavigator.tsx / DatosEmergenciaGate.tsx.
// Esta pantalla ("Mis Datos") es la misma que RootNavigator monta a solas
// cuando `user.datosEmergenciaCompletos` es false; estos tests cubren la
// lógica de bloqueo/validación/desbloqueo que vive ACA (el gating de
// navegación en sí -- qué stack se monta -- se cubre en el E2E).

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
const mockMarcarDatosEmergenciaCompletos = jest.fn();
let mockUser: any = {
  id: 'user-1',
  name: 'Isa Giurato',
  dni: '30111222',
  phone: null,
  role: 'socio',
  avatarUrl: null,
  datosEmergenciaCompletos: false,
};
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: mockLogout,
    marcarDatosEmergenciaCompletos: mockMarcarDatosEmergenciaCompletos,
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
  phone: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  medical_notes: null,
};

const PERFIL_COMPLETO = {
  full_name: 'Isa Giurato',
  dni: '30111222',
  phone: '1122334455',
  emergency_contact_name: 'Juan Pérez',
  emergency_contact_phone: '1155667788',
  medical_notes: 'Sin condiciones preexistentes.',
};

let mockUpdateResult: any = { data: null, error: null };

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

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

describe('ProfileScreen ("Mis Datos") -- formulario obligatorio de emergencia', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateResult = { data: null, error: null };
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('socio bloqueado (datos de emergencia incompletos): muestra el banner de aviso obligatorio', async () => {
    mockUser = { ...mockUser, datosEmergenciaCompletos: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByLabelText, getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByLabelText('Datos de emergencia obligatorios')).toBeTruthy());
    expect(getByText(/el gimnasio exige tener cargados tus datos de emergencia/)).toBeTruthy();
  });

  it('socio ya completo: NO muestra el banner de bloqueo', async () => {
    mockUser = { ...mockUser, datosEmergenciaCompletos: true };
    configurarMocks(PERFIL_COMPLETO);
    const { queryByLabelText, getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());
    expect(queryByLabelText('Datos de emergencia obligatorios')).toBeNull();
  });

  it('"Más opciones" (historial de clases) SIEMPRE se muestra, incluso mientras faltan datos de emergencia -- no hay bloqueo de navegación', async () => {
    mockUser = { ...mockUser, datosEmergenciaCompletos: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<ProfileScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Ver historial de clases')).toBeTruthy());
    fireEvent.press(getByText('Ver historial de clases'));
    expect(navigation.navigate).toHaveBeenCalledWith('History');
  });

  it('guardar con Contacto de emergencia / Ficha médica vacíos: bloquea el guardado con un Alert, no llama a marcarDatosEmergenciaCompletos', async () => {
    mockUser = { ...mockUser, datosEmergenciaCompletos: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Faltan datos obligatorios',
        expect.stringContaining('Contacto de emergencia')
      )
    );
    expect(mockMarcarDatosEmergenciaCompletos).not.toHaveBeenCalled();
    // `from('profiles')` solo se llamó una vez (la carga inicial) -- la
    // validación cortó ANTES de intentar el `update` con datos vacíos.
    expect(mockedFrom).toHaveBeenCalledTimes(1);
  });

  it('completa los 3 campos obligatorios y guarda: persiste en `profiles` y desbloquea la navegación vía marcarDatosEmergenciaCompletos', async () => {
    mockUser = { ...mockUser, datosEmergenciaCompletos: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByText, getByPlaceholderText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Nombre del contacto'), 'Juan Pérez');
    fireEvent.changeText(getByPlaceholderText('Teléfono del contacto'), '1155667788');
    fireEvent.changeText(
      getByPlaceholderText('Lesiones, condiciones físicas u otras observaciones...'),
      'Sin condiciones preexistentes.'
    );

    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => expect(mockMarcarDatosEmergenciaCompletos).toHaveBeenCalledTimes(1));
    expect(Alert.alert).toHaveBeenCalledWith('Guardado', 'Tus datos se actualizaron.');
    expect(Alert.alert).not.toHaveBeenCalledWith('Faltan datos obligatorios', expect.anything());
  });

  it('si falla el guardado en el backend, NO desbloquea la navegación (marcarDatosEmergenciaCompletos no se llama)', async () => {
    mockUser = { ...mockUser, datosEmergenciaCompletos: false };
    configurarMocks(PERFIL_INCOMPLETO);
    mockUpdateResult = { data: null, error: { message: 'Network error' } };
    const { getByText, getByPlaceholderText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Nombre del contacto'), 'Juan Pérez');
    fireEvent.changeText(getByPlaceholderText('Teléfono del contacto'), '1155667788');
    fireEvent.changeText(
      getByPlaceholderText('Lesiones, condiciones físicas u otras observaciones...'),
      'Sin condiciones preexistentes.'
    );

    fireEvent.press(getByText('Guardar cambios'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Error', 'Network error'));
    expect(mockMarcarDatosEmergenciaCompletos).not.toHaveBeenCalled();
  });

  it('el botón "Cerrar sesión" queda siempre visible y funcional, incluso bloqueado (salir no es "usar la app")', async () => {
    mockUser = { ...mockUser, datosEmergenciaCompletos: false };
    configurarMocks(PERFIL_INCOMPLETO);
    const { getByText } = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(getByText('Guardar cambios')).toBeTruthy());

    fireEvent.press(getByText('Cerrar sesión'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
