import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

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

describe('ComunidadMobileView (Módulo 6 -- Feed, Grupos, Ranking)', () => {
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

  it('dar "¡A tope!" a un post suma el contador de reacciones', async () => {
    const { getByText, getAllByText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText(/Bienvenidos a la Comunidad GreenFit/)).toBeTruthy());

    const reactionButtons = getAllByText(/¡A tope!/);
    fireEvent.press(reactionButtons[0]);

    await waitFor(() => expect(getByText('¡A tope! · 1')).toBeTruthy());
  });

  it('el tab Ranking muestra el conteo real propio + el aviso de datos de ejemplo', async () => {
    const { getByText } = render(<ComunidadMobileView />);
    await waitFor(() => expect(getByText('Feed')).toBeTruthy());

    fireEvent.press(getByText('Ranking'));

    await waitFor(() => expect(getByText(/Ranking de ejemplo/)).toBeTruthy());
    expect(getByText('0 XP')).toBeTruthy(); // "Vos: 0 XP totales" -- real, sin datos simulados
    expect(getByText('Lucía Fernández')).toBeTruthy();
  });
});
