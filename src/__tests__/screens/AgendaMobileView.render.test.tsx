import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// AgendaMobileView usa useFocusEffect (refresco del gate de contacto de
// emergencia al volver de "Mis datos") -- sin un NavigationContainer real
// alrededor, hay que mockearlo para que dispare el callback al montar,
// mismo patrón que HomeScreen.render.test.tsx.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => {
      callback();
    }, []);
  },
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria', dni: '30111222' } }),
}));
jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => ({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120 } }),
}));
jest.mock('../../hooks/useTicker', () => ({ useTicker: () => {} }));
jest.mock('../../lib/closedDaysApi', () => ({ fetchClosedDays: jest.fn().mockResolvedValue([]) }));
jest.mock('../../lib/calendarShare', () => ({
  addToCalendar: jest.fn().mockResolvedValue(undefined),
  shareReserva: jest.fn().mockResolvedValue('shared'),
}));
jest.mock('../../lib/classesApi', () => ({
  loadClassesForDate: jest.fn(),
  formatDateOnly: jest.fn(() => '2026-08-10'),
}));
jest.mock('../../lib/creditsApi', () => ({
  fetchUserBalances: jest.fn().mockResolvedValue([
    {
      id: 'bal-1',
      userId: 'user-1',
      remainingCredits: 3,
      expiresAt: null,
      createdAt: '2026-01-01',
      discipline: { id: 'disc-1', name: 'CrossFit', kind: 'credits' },
      pack: null,
    },
  ]),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { loadClassesForDate } from '../../lib/classesApi';
import { supabase } from '../../lib/supabase';
import { CONSENT_TEXT_SHORT } from '../../lib/consentApi';
import AgendaMobileView from '../../screens/user/AgendaMobileView';

const mockedLoadClasses = loadClassesForDate as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

const CLASE_BASE = {
  id: 'class-1',
  title: 'CrossFit',
  disciplineId: 'disc-1',
  instructor: 'Seba',
  location: 'Box 1',
  capacity: 10,
  daysOfWeek: [1, 3, 5],
  startTime: '19:00:00',
  endTime: '20:00:00',
  bookedCount: 2,
  occurrenceDate: '2026-08-10',
  startAt: new Date('2026-08-10T19:00:00').toISOString(),
  endAt: new Date('2026-08-10T20:00:00').toISOString(),
};

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'in', 'order', 'single', 'limit'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

// consentimientos_socio necesita, además de la cadena de SELECT de arriba
// (.select('id').eq(...).eq(...).limit(1)), un .insert(...) que resuelve
// aparte -- se comparten en un solo objeto porque ambos "viven" en la misma
// tabla mockeada por `from`.
function makeConsentChain(selectResult: any, insertResult: any = { error: null }) {
  return {
    ...makeChain(selectResult),
    insert: jest.fn().mockResolvedValue(insertResult),
  };
}

// Contacto de emergencia completo por defecto -- el foco de la mayoría de
// estos tests es reservar/cancelar, no el gate nuevo (ver el describe
// dedicado más abajo), así que por defecto no debe bloquear nada.
const CONTACTO_COMPLETO = {
  data: { emergency_contact_name: 'Ana Pérez', emergency_contact_phone: '2611234567' },
  error: null,
};

// Consentimiento vigente por defecto -- el foco de la mayoría de estos
// tests es reservar/cancelar, no el gate de consentimiento (ver el describe
// dedicado más abajo), así que por defecto no debe bloquear nada.
const CONSENT_VIGENTE = { data: [{ id: 'consent-1' }], error: null };

// `supabase.from` se llama para `bookings` (isBooked de cada clase),
// `profiles` (fetchTieneContactoEmergencia) y, ahora, `consentimientos_socio`
// (fetchTieneConsentimientoVigente/registrarConsentimiento) -- discrimina
// por tabla en vez de un mock ciego para cualquier `.from(...)`.
function mockFromDefault(
  bookingsResult: any,
  contactoResult: any = CONTACTO_COMPLETO,
  consentSelectResult: any = CONSENT_VIGENTE,
  consentInsertResult: any = { error: null }
) {
  mockedFrom.mockImplementation((table: string) => {
    if (table === 'profiles') return makeChain(contactoResult);
    if (table === 'consentimientos_socio') return makeConsentChain(consentSelectResult, consentInsertResult);
    return makeChain(bookingsResult);
  });
}

const navigation = { navigate: jest.fn() };

describe('AgendaMobileView (Módulo 2 -- reservar y cancelar desde la agenda)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadClasses.mockResolvedValue([{ ...CLASE_BASE }]);
    mockedRpc.mockResolvedValue({ data: null, error: null });
  });

  it('muestra la clase como Disponible cuando el socio todavía no la reservó', async () => {
    mockFromDefault({ data: [], error: null });
    const { getByText } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());
    expect(getByText('Disponible')).toBeTruthy();
  });

  // Antes reservaba directo al primer tap (one-tap) -- un socio que
  // scrolleaba con el dedo mal puesto se anotaba por accidente. Ahora el
  // tap solo abre BookingConfirmModal; book_class recién se llama al tocar
  // "Confirmar" ahí adentro.
  it('tocar una clase disponible abre el modal de confirmación en vez de reservar directo (evita el one-tap accidental)', async () => {
    mockFromDefault({ data: [], error: null });
    const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));

    await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
    expect(mockedRpc).not.toHaveBeenCalledWith('book_class', expect.anything());
  });

  it('confirmar en el modal llama a book_class y dispara el modal de confirmación gamificado', async () => {
    mockFromDefault({ data: [], error: null });
    const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
    fireEvent.press(getByText(CONSENT_TEXT_SHORT));
    fireEvent.press(getByText('Confirmar'));

    await waitFor(() =>
      expect(mockedRpc).toHaveBeenCalledWith('book_class', { p_class_id: 'class-1', p_booking_date: '2026-08-10' })
    );
    await waitFor(() => expect(getByText('¡Reserva confirmada!')).toBeTruthy());
  });

  it('muestra la clase como Reservada y permite cancelarla, liberando el cupo', async () => {
    mockFromDefault({ data: [{ class_id: 'class-1' }], error: null });
    const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());

    // Después de confirmar, la próxima carga (loadClassesForDate) ya no
    // debería devolver la clase como reservada -- simula que el cupo se liberó.
    mockFromDefault({ data: [], error: null });
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() =>
      expect(mockedRpc).toHaveBeenCalledWith('cancel_booking', {
        p_class_id: 'class-1',
        p_booking_date: '2026-08-10',
        p_reason: null,
      })
    );
    await waitFor(() => expect(getByText('Disponible')).toBeTruthy());
  });

  // TAREA 4 (bug de seguridad reportado: "una alumna canceló a tiempo y el
  // sistema no le devolvió el crédito"): cancel_booking() (backend, con
  // lock `for update` sobre la fila de user_credits -- ver
  // supabase_migration_cancel_booking_2h.sql) devuelve un boolean real
  // (true = reintegró, false = no) según el tiempo de gracia de
  // configuracion.limite_cancelacion_minutos. El resultado se muestra con
  // MessageModal (un Modal real, no Alert.alert -- ver crossPlatformAlert.ts
  // sobre por qué Alert.alert es un no-op en Web/PWA y por qué esto dejó de
  // usarlo), así que se verifica como texto renderizado, no como spy.
  it('cancelar A TIEMPO (dentro del límite de gracia): la RPC devuelve true y el modal confirma que se reintegró el crédito', async () => {
    mockFromDefault({ data: [{ class_id: 'class-1' }], error: null });
    mockedRpc.mockImplementation((fn: string) =>
      fn === 'cancel_booking' ? Promise.resolve({ data: true, error: null }) : Promise.resolve({ data: null, error: null })
    );

    const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() => expect(getByText('Reserva cancelada')).toBeTruthy());
    expect(getByText('Te devolvimos el crédito.')).toBeTruthy();
  });

  it('cancelar TARDE (fuera del límite de gracia): la RPC devuelve false y el modal avisa que NO se reintegra el crédito', async () => {
    mockFromDefault({ data: [{ class_id: 'class-1' }], error: null });
    mockedRpc.mockImplementation((fn: string) =>
      fn === 'cancel_booking' ? Promise.resolve({ data: false, error: null }) : Promise.resolve({ data: null, error: null })
    );

    const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() =>
      expect(
        getByText('Como cancelaste con menos de 2 horas de anticipación, no se reintegra el crédito.')
      ).toBeTruthy()
    );
  });

  it('si cancel_booking devuelve un error real, avisa con el motivo y NO dice "cancelada" (ningún crédito se pierde en el éter)', async () => {
    mockFromDefault({ data: [{ class_id: 'class-1' }], error: null });
    mockedRpc.mockImplementation((fn: string) =>
      fn === 'cancel_booking'
        ? Promise.resolve({ data: null, error: { message: 'No tenías una reserva en esta clase' } })
        : Promise.resolve({ data: null, error: null })
    );

    const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() => expect(getByText('No se pudo cancelar')).toBeTruthy());
    expect(getByText('No tenías una reserva en esta clase')).toBeTruthy();
    expect(queryByText('Reserva cancelada')).toBeNull();
  });

  it('NO muestra el botón flotante "+" (se sacó de Agenda -- ahora es exclusivo de Comunidad, para no confundirlo con "crear publicación")', async () => {
    mockFromDefault({ data: [], error: null });
    const { getByText, queryByLabelText } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());
    expect(queryByLabelText('Nueva publicación')).toBeNull();
    expect(queryByLabelText('Volver a hoy')).toBeNull();
  });

  // Gate nuevo, aparte del de "perfil obligatorio" de ProfileStack.tsx (ese
  // bloquea la pestaña Perfil entera y no se toca acá): sin nombre Y
  // teléfono de contacto de emergencia, no se deja avanzar a reservar.
  describe('gate de contacto de emergencia (nombre + teléfono, aparte del gate de "perfil obligatorio")', () => {
    const CONTACTO_INCOMPLETO = {
      data: { emergency_contact_name: null, emergency_contact_phone: null },
      error: null,
    };

    it('sin contacto de emergencia completo, tocar una clase disponible bloquea con el mensaje claro -- NO abre BookingConfirmModal ni llama a book_class', async () => {
      mockFromDefault({ data: [], error: null }, CONTACTO_INCOMPLETO);
      const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('Completá tu contacto de emergencia')).toBeTruthy());
      expect(
        getByText('Para poder reservar una clase, necesitamos el nombre y el teléfono de alguien a quien contactar en caso de emergencia.')
      ).toBeTruthy();
      expect(queryByText('¿Confirmás tu lugar en esta clase?')).toBeNull();
      expect(mockedRpc).not.toHaveBeenCalledWith('book_class', expect.anything());
    });

    it('con solo el teléfono cargado (falta el nombre), sigue bloqueando -- el gate pide los DOS campos', async () => {
      mockFromDefault(
        { data: [], error: null },
        { data: { emergency_contact_name: null, emergency_contact_phone: '2611234567' }, error: null }
      );
      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('Completá tu contacto de emergencia')).toBeTruthy());
      expect(mockedRpc).not.toHaveBeenCalledWith('book_class', expect.anything());
    });

    it('tocar "Completar mis datos" navega a Perfil > MyData (la misma pantalla que ya usa ProfileScreen.tsx)', async () => {
      mockFromDefault({ data: [], error: null }, CONTACTO_INCOMPLETO);
      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));
      await waitFor(() => expect(getByText('Completá tu contacto de emergencia')).toBeTruthy());
      fireEvent.press(getByText('Completar mis datos'));

      expect(navigation.navigate).toHaveBeenCalledWith('Perfil', { screen: 'MyData' });
    });

    it('con contacto de emergencia completo, el flujo de reservar sigue exactamente igual (sin cambios): abre el modal de confirmación y book_class se llama al confirmar', async () => {
      mockFromDefault({ data: [], error: null }); // CONTACTO_COMPLETO por defecto
      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));
      await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
      fireEvent.press(getByText(CONSENT_TEXT_SHORT));
      fireEvent.press(getByText('Confirmar'));

      await waitFor(() =>
        expect(mockedRpc).toHaveBeenCalledWith('book_class', { p_class_id: 'class-1', p_booking_date: '2026-08-10' })
      );
    });

    it('cancelar una reserva existente NO se bloquea por este gate (ya tiene el lugar -- solo aplica a RESERVAR una clase nueva)', async () => {
      mockFromDefault({ data: [{ class_id: 'class-1' }], error: null }, CONTACTO_INCOMPLETO);
      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    });

    it('si la consulta a profiles falla (error de red), no bloquea la agenda (fail-open) -- deja reservar igual', async () => {
      mockFromDefault({ data: [], error: null }, { data: null, error: { message: 'network error' } });
      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
    });
  });

  // Segundo gate de reserva, coexiste con el de contacto de emergencia de
  // arriba (no se toca) -- ver ConsentModal.tsx / consentApi.ts. Todos estos
  // tests usan CONTACTO_COMPLETO (por defecto de mockFromDefault) para que
  // el gate de emergencia no interfiera y el foco quede en este.
  describe('gate de consentimiento informado / declaración de salud (segundo gate, va después del de contacto de emergencia)', () => {
    const CONSENT_FALTA = { data: [], error: null };
    const CONSENT_ERROR = { data: null, error: { message: 'network error' } };
    const CONTACTO_INCOMPLETO = {
      data: { emergency_contact_name: null, emergency_contact_phone: null },
      error: null,
    };

    it('socio sin nada de contacto de emergencia NI consentimiento: primero bloquea el gate de emergencia (no llega a consultar consentimiento)', async () => {
      mockFromDefault({ data: [], error: null }, CONTACTO_INCOMPLETO, CONSENT_FALTA);
      const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('Completá tu contacto de emergencia')).toBeTruthy());
      expect(queryByText(/Declaración de salud y consentimiento/)).toBeNull();
    });

    it('socio nuevo (contacto de emergencia completo, pero sin ninguna aceptación): al reservar ve la pantalla completa del consentimiento, ANTES de BookingConfirmModal', async () => {
      mockFromDefault({ data: [], error: null }, CONTACTO_COMPLETO, CONSENT_FALTA);
      const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() =>
        expect(getByText(/Declaración de salud y consentimiento para realizar actividad física/)).toBeTruthy()
      );
      expect(queryByText('¿Confirmás tu lugar en esta clase?')).toBeNull();
      expect(mockedRpc).not.toHaveBeenCalledWith('book_class', expect.anything());
    });

    it('"No acepto" (o no marcar nada) no deja avanzar -- "Continuar" queda deshabilitado y no se registra nada ni se abre BookingConfirmModal', async () => {
      mockFromDefault({ data: [], error: null }, CONTACTO_COMPLETO, CONSENT_FALTA);
      const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));
      await waitFor(() =>
        expect(getByText(/Declaración de salud y consentimiento para realizar actividad física/)).toBeTruthy()
      );

      // Sin marcar nada, "Continuar" ya está deshabilitado.
      fireEvent.press(getByText('Continuar'));
      expect(queryByText('¿Confirmás tu lugar en esta clase?')).toBeNull();

      // Marcar "No acepto." tampoco lo habilita.
      fireEvent.press(getByText('No acepto.'));
      fireEvent.press(getByText('Continuar'));
      expect(queryByText('¿Confirmás tu lugar en esta clase?')).toBeNull();
    });

    it('aceptar la declaración completa: registra la fila (con nombre/DNI del socio) y sigue derecho a BookingConfirmModal, sin volver a tocar la tarjeta', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'profiles') return makeChain(CONTACTO_COMPLETO);
        if (table === 'consentimientos_socio') {
          const chain = makeConsentChain(CONSENT_FALTA);
          chain.insert = insertMock;
          return chain;
        }
        return makeChain({ data: [], error: null });
      });

      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));
      await waitFor(() =>
        expect(getByText(/Declaración de salud y consentimiento para realizar actividad física/)).toBeTruthy()
      );

      fireEvent.press(
        getByText('Acepto la declaración de salud, el consentimiento informado y las condiciones de participación.')
      );
      fireEvent.press(getByText('Continuar'));

      await waitFor(() =>
        expect(insertMock).toHaveBeenCalledWith({
          user_id: 'user-1',
          version: 'v1',
          nombre_declarado: 'Facundo Uria',
          dni_declarado: '30111222',
        })
      );
      // Directo a BookingConfirmModal -- no hace falta volver a tocar la tarjeta.
      await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
    });

    it('socio con la versión vigente ya aceptada: NO ve la pantalla completa -- va directo a BookingConfirmModal, con el checkbox corto de reafirmación y "Confirmar" deshabilitado hasta marcarlo', async () => {
      mockFromDefault({ data: [], error: null }); // CONTACTO_COMPLETO y CONSENT_VIGENTE por defecto
      const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
      expect(queryByText(/Declaración de salud y consentimiento para realizar actividad física/)).toBeNull();
      expect(getByText(CONSENT_TEXT_SHORT)).toBeTruthy();

      // "Confirmar" deshabilitado hasta marcar la reafirmación corta.
      fireEvent.press(getByText('Confirmar'));
      expect(mockedRpc).not.toHaveBeenCalledWith('book_class', expect.anything());

      fireEvent.press(getByText(CONSENT_TEXT_SHORT));
      fireEvent.press(getByText('Confirmar'));
      await waitFor(() =>
        expect(mockedRpc).toHaveBeenCalledWith('book_class', { p_class_id: 'class-1', p_booking_date: '2026-08-10' })
      );
    });

    // Simula un cambio de versión: CONSENT_VERSION en código pasó a ser
    // distinta de la que el socio tiene guardada -- la fila vieja no
    // matchea el filtro por versión de fetchTieneConsentimientoVigente, así
    // que la consulta devuelve vacío exactamente igual que un socio nuevo
    // (mismo mecanismo, sin distinguir "nunca aceptó" de "aceptó una
    // versión que ya no es la vigente").
    it('si el socio solo tiene aceptada una versión vieja (simulando que CONSENT_VERSION subió), le vuelve a pedir la pantalla completa', async () => {
      mockFromDefault({ data: [], error: null }, CONTACTO_COMPLETO, CONSENT_FALTA);
      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() =>
        expect(getByText(/Declaración de salud y consentimiento para realizar actividad física/)).toBeTruthy()
      );
    });

    it('fail-CLOSED: si la consulta a consentimientos_socio falla (error de red), bloquea con un mensaje claro -- NO abre ni la pantalla de consentimiento ni BookingConfirmModal (a diferencia del gate de contacto de emergencia, que es fail-open)', async () => {
      mockFromDefault({ data: [], error: null }, CONTACTO_COMPLETO, CONSENT_ERROR);
      const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('No se pudo verificar tu consentimiento')).toBeTruthy());
      expect(queryByText(/Declaración de salud y consentimiento para realizar actividad física/)).toBeNull();
      expect(queryByText('¿Confirmás tu lugar en esta clase?')).toBeNull();
      expect(mockedRpc).not.toHaveBeenCalledWith('book_class', expect.anything());
    });

    it('cancelar una reserva existente NO se bloquea por este gate (ya tiene el lugar -- solo aplica a RESERVAR una clase nueva)', async () => {
      mockFromDefault({ data: [{ class_id: 'class-1' }], error: null }, CONTACTO_COMPLETO, CONSENT_FALTA);
      const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
      await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

      fireEvent.press(getByTestId('agenda-card-class-1'));

      await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    });
  });
});
