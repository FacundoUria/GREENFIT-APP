jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../lib/supabase';
import {
  CONSENT_VERSION,
  fetchTieneConsentimientoVigente,
  registrarConsentimiento,
} from '../../lib/consentApi';

const mockedFrom = supabase.from as jest.Mock;

// Chain encadenable para el SELECT (.select().eq().eq().limit()) -- el
// mismo patrón de "thenable al final de la cadena" que ya usan los tests de
// AgendaMobileView.render.test.tsx para `bookings`/`profiles`.
function makeSelectChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'limit'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchTieneConsentimientoVigente (gate de consentimiento informado -- fail-closed a propósito, decisión explícita)', () => {
  it('devuelve tieneConsentimiento=true cuando existe una fila con la versión vigente, filtrando por user_id y CONSENT_VERSION', async () => {
    const chain = makeSelectChain({ data: [{ id: 'consent-1' }], error: null });
    mockedFrom.mockReturnValue(chain);

    const result = await fetchTieneConsentimientoVigente('user-1');

    expect(mockedFrom).toHaveBeenCalledWith('consentimientos_socio');
    expect(chain.select).toHaveBeenCalledWith('id');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(chain.eq).toHaveBeenCalledWith('version', CONSENT_VERSION);
    expect(result).toEqual({ tieneConsentimiento: true, error: null });
  });

  it('devuelve tieneConsentimiento=false cuando no hay ninguna fila (socio nuevo, o solo tiene una versión vieja)', async () => {
    mockedFrom.mockReturnValue(makeSelectChain({ data: [], error: null }));

    const result = await fetchTieneConsentimientoVigente('user-1');

    expect(result).toEqual({ tieneConsentimiento: false, error: null });
  });

  // Fail-closed a propósito (a diferencia del gate de contacto de
  // emergencia): es un registro legal, así que ante un error real de
  // red/consulta el caller NO debe dejar avanzar la reserva. El error se
  // devuelve (no se tira) para que AgendaMobileView.tsx decida el mensaje.
  it('ante un error de red/consulta, devuelve tieneConsentimiento=false junto con el mensaje de error (fail-closed)', async () => {
    mockedFrom.mockReturnValue(makeSelectChain({ data: null, error: { message: 'network error' } }));

    const result = await fetchTieneConsentimientoVigente('user-1');

    expect(result).toEqual({ tieneConsentimiento: false, error: 'network error' });
  });
});

describe('registrarConsentimiento (inserta la aceptación -- nunca UPDATE, cada aceptación es una fila nueva)', () => {
  it('inserta con la versión vigente y el nombre/DNI recibidos como snapshot', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ insert: insertMock });

    await registrarConsentimiento('user-1', 'Ana Pérez', '30111222');

    expect(mockedFrom).toHaveBeenCalledWith('consentimientos_socio');
    expect(insertMock).toHaveBeenCalledWith({
      user_id: 'user-1',
      version: CONSENT_VERSION,
      nombre_declarado: 'Ana Pérez',
      dni_declarado: '30111222',
    });
  });

  it('con un error real del insert (ej. RLS), lo propaga tal cual', async () => {
    mockedFrom.mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: { message: 'permission denied' } }) });

    await expect(registrarConsentimiento('user-1', 'Ana Pérez', '30111222')).rejects.toThrow('permission denied');
  });
});
