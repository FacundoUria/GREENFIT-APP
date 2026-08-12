import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';

// ComunidadMobileView usa useFocusEffect (no useEffect a secas) para
// refrescar Feed/Ranking/Mensajes cada vez que el tab vuelve a foco -- ver
// el bugfix de sincronización de XP. Sin un NavigationContainer real, hay
// que mockearlo (mismo criterio que HomeScreen.render.test.tsx).
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => {
      callback();
    }, []);
  },
}));

// user como referencia estable (fuera del factory) -- si `useAuth()` devolviera
// un objeto nuevo en cada llamada, el `useCallback([user])` de la pantalla
// recrearía `load` en cada render y el useEffect([load]) reentraría en loop.
// En producción `user` sale de useState de AuthContext y es estable entre
// renders; acá hay que replicar eso a mano.
const MOCK_USER = { id: 'user-1', name: 'Facundo Uria' };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: MOCK_USER }),
}));

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'gte', 'lte', 'limit', 'order', 'in', 'insert'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { supabase } from '../../lib/supabase';
import ComunidadMobileView from '../../screens/user/ComunidadMobileView';

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

// Simula el estado REAL de este proyecto hoy: las tablas community_* y el
// RPC de ranking todavía no están desplegados (backend/supabase_migration_comunidad.sql
// sin correr) -- la vista debe caer sola a modo demo sin romperse.
function configurarComoNoDesplegado() {
  mockedFrom.mockImplementation((table: string) => {
    if (table === 'community_posts') {
      return makeChain({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    }
    // bookings (fetchMisClasesDelMes/fetchHistoricoPropio) -- tabla real,
    // sin actividad cargada para simplificar.
    return makeChain({ data: [], error: null, count: 0 });
  });
  mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
}

describe('ComunidadMobileView (Módulo 6 -- Feed, Mensajes/DM, Ranking)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    configurarComoNoDesplegado();
  });

  it('detecta que la migración no está aplicada y arranca en modo demo con el feed semilla', async () => {
    const { getByText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText(/Modo demo/)).toBeTruthy());
    expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy();
  });

  it('crear una publicación nueva la deja arriba del feed', async () => {
    const { getByText, getByPlaceholderText, getByLabelText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy());

    fireEvent.press(getByLabelText('Nueva publicación'));
    const input = await waitFor(() => getByPlaceholderText('¿Qué entrenaste hoy?'));
    fireEvent.changeText(input, 'Hoy rompí mi PR de Clean & Jerk 💪');
    fireEvent.press(getByText('Publicar'));

    await waitFor(() => expect(getByText('Hoy rompí mi PR de Clean & Jerk 💪')).toBeTruthy());
  });

  // Rediseño del botón de reacción: se eliminó el texto fijo "¡A tope!" --
  // ahora es solo el emoji del musculito + el contador numérico (ej. "💪 3"),
  // como un botón de "Me gusta" limpio estándar.
  it('el botón de reacción ya NO tiene el texto fijo "¡A tope!" -- solo el musculito y el contador', async () => {
    const { getByText, queryByText, getAllByText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy());

    expect(queryByText(/¡A tope!/)).toBeNull();
    expect(getAllByText('💪').length).toBeGreaterThan(0);
  });

  it('reaccionar a un post con el botón del musculito actualiza el contador', async () => {
    const { getByText, getAllByLabelText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy());

    const reactionButtons = getAllByLabelText('Reaccionar');
    const boton = reactionButtons[0];
    const contadorInicial = Number(within(boton).getByText(/^\d+$/).props.children);

    fireEvent.press(boton);

    await waitFor(() =>
      expect(Number(within(boton).getByText(/^\d+$/).props.children)).toBe(contadorInicial + 1)
    );
    // El botón pasa a estado "reaccionado" -- ya ofrece quitar la reacción.
    expect(boton.props.accessibilityLabel).toBe('Quitar reacción');
  });

  it('el tab Ranking muestra el conteo real propio + el aviso de datos de ejemplo', async () => {
    const { getByText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText('Feed')).toBeTruthy());

    fireEvent.press(getByText('Ranking'));

    await waitFor(() => expect(getByText(/Ranking de ejemplo/)).toBeTruthy());
    expect(getByText('0 XP')).toBeTruthy(); // "Vos: 0 XP totales" -- real, sin datos simulados
    expect(getByText('Lucía Fernández')).toBeTruthy();
  });

  it('la pestaña "Mi Box" se reemplazó por "Mensajes" -- arranca vacía, sin rastro de Grupos', async () => {
    const { getByText, queryByText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText('Feed')).toBeTruthy());

    expect(queryByText('Mi Box')).toBeNull();
    fireEvent.press(getByText('Mensajes'));

    await waitFor(() => expect(getByText(/Todavía no tenés conversaciones/)).toBeTruthy());
    expect(queryByText(/creá el primero/)).toBeNull(); // texto viejo de "crear grupo"
  });

  it('tocar el avatar de otro socio en el Feed abre un chat privado 1 a 1 y permite mandar un mensaje', async () => {
    const { getByText, getByPlaceholderText } = render(<ComunidadMobileView />);
    // "Equipo GreenFit" es el autor semilla del primer post demo -- distinto
    // del usuario actual (user-1), así que tocar su nombre debe abrir chat.
    await waitFor(() => expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy());

    fireEvent.press(getByText('Equipo GreenFit'));

    const input = await waitFor(() => getByPlaceholderText('Escribí un mensaje...'));
    fireEvent.changeText(input, '¡Hola equipo!');
    fireEvent.press(getByText('Ionicons:send'));

    await waitFor(() => expect(getByText('¡Hola equipo!')).toBeTruthy());
  });

  it('después de mandar un mensaje privado, el hilo aparece en la bandeja de Mensajes', async () => {
    const { getByText, getByPlaceholderText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy());

    fireEvent.press(getByText('Equipo GreenFit'));
    const input = await waitFor(() => getByPlaceholderText('Escribí un mensaje...'));
    fireEvent.changeText(input, '¡Hola equipo!');
    fireEvent.press(getByText('Ionicons:send'));
    await waitFor(() => expect(getByText('¡Hola equipo!')).toBeTruthy());

    // Cierra el chat y va a la bandeja
    fireEvent.press(getByText('Ionicons:close'));
    fireEvent.press(getByText('Mensajes'));

    await waitFor(() => expect(getByText('¡Hola equipo!')).toBeTruthy()); // preview del último mensaje
  });

  it('tocar el propio nombre de autor en un post propio NO abre ningún chat (no tiene sentido chatear con uno mismo)', async () => {
    const { getByText, getByPlaceholderText, queryByPlaceholderText, getAllByText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy());

    fireEvent.press(getByText('Ionicons:add'));
    const composerInput = await waitFor(() => getByPlaceholderText('¿Qué entrenaste hoy?'));
    fireEvent.changeText(composerInput, 'Mi propio post');
    fireEvent.press(getByText('Publicar'));
    await waitFor(() => expect(getByText('Mi propio post')).toBeTruthy());

    // "Facundo Uria" (MOCK_USER) aparece ahora como autor de su propio post
    // -- tocarlo no debe disparar el modal de chat privado.
    fireEvent.press(getAllByText('Facundo Uria')[0]);
    expect(queryByPlaceholderText('Escribí un mensaje...')).toBeNull();
  });
});
