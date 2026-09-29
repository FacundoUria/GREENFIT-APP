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

// Mismo objeto `user` en cada render, como en la app real (AuthContext lo
// guarda en estado) -- si no, `load` cambia de identidad en cada render y el
// useEffect vuelve a cargar la agenda sin parar (isLoading nunca se asienta).
const mockAuthValue = { user: { id: 'user-1', name: 'Facundo Uria', dni: '30111222' } };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));
// jest.fn() (no un objeto fijo) -- algunos tests necesitan un
// limiteCancelacionMinutos DISTINTO de 120 para confirmar que el mensaje de
// "no se reintegra el crédito" lee el valor real de Configuración en vez de
// un texto fijo ("2 horas" hardcodeado, bug real ya arreglado).
const mockUseConfiguracion = jest.fn(() => ({
  configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120 },
}));
jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => mockUseConfiguracion(),
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

// Relativo a AHORA (no una fecha absoluta fija) -- withinCancelLimit se
// calcula contra Date.now() real (este archivo no congela el reloj), así
// que una fecha hardcodeada "vence" apenas el calendario real la deja
// atrás: exactamente lo que pasó acá (2026-08-10 quedó en el pasado y
// volvía withinCancelLimit siempre true, deshabilitando "Confirmar
// cancelación" en TODOS los tests de cancelar -- bug de fixture expuesto
// por el nuevo bloqueo de cancel_booking(), no causado por él). 3 horas es
// un margen cómodo por encima de cualquier tiempo de gracia real
// configurado (120 min por default).
const EN_3_HORAS = new Date(Date.now() + 3 * 60 * 60 * 1000);

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
  occurrenceDate: EN_3_HORAS.toISOString().slice(0, 10),
  startAt: EN_3_HORAS.toISOString(),
  endAt: new Date(EN_3_HORAS.getTime() + 60 * 60 * 1000).toISOString(),
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
    // Default 120 -- clearAllMocks() NO borra un mockReturnValue puesto por
    // un test anterior (solo mockReset lo haría), así que se reafirma acá
    // para que el override puntual de un test no se filtre a los de al lado.
    mockUseConfiguracion.mockReturnValue({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120 } });
  });

  it('muestra la clase disponible (pill decorativo "Reservar") cuando el socio todavía no la reservó', async () => {
    mockFromDefault({ data: [], error: null });
    const { getByText } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());
    expect(getByText('Reservar')).toBeTruthy();
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
      expect(mockedRpc).toHaveBeenCalledWith('book_class', { p_class_id: 'class-1', p_booking_date: CLASE_BASE.occurrenceDate })
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
        p_booking_date: CLASE_BASE.occurrenceDate,
        p_reason: null,
      })
    );
    await waitFor(() => expect(getByText('Reservar')).toBeTruthy());
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

  it('cancelar TARDE (fuera del límite de gracia): la RPC devuelve false y el modal avisa que NO se reintegra el crédito (con 120 min configurados, se lee "2 horas")', async () => {
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

  // BUG REAL -- este mensaje decía "2 horas" como texto FIJO, sin leer
  // configuracion.limite_cancelacion_minutos (a diferencia del aviso PREVIO
  // del mismo modal, que sí lo leía) -- con el límite configurado en 10
  // minutos, el socio seguía viendo "2 horas", un dato falso.
  it('con limite_cancelacion_minutos=10, el mensaje de "no se reintegra" dice "10 minutos", NO "2 horas"', async () => {
    mockUseConfiguracion.mockReturnValue({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 10 } });
    mockFromDefault({ data: [{ class_id: 'class-1' }], error: null });
    mockedRpc.mockImplementation((fn: string) =>
      fn === 'cancel_booking' ? Promise.resolve({ data: false, error: null }) : Promise.resolve({ data: null, error: null })
    );

    const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() =>
      expect(getByText('Como cancelaste con menos de 10 minutos de anticipación, no se reintegra el crédito.')).toBeTruthy()
    );
    expect(queryByText(/2 horas/)).toBeNull();
  });

  // 90 no es una cantidad entera de horas -- formatLimite() (mismo
  // formateo que ya usa el aviso PREVIO de este modal) lo lee como "1 hora
  // 30 min", no como "90 minutos" en crudo. Confirma que se reusa esa
  // MISMA función, no un formateo propio inventado acá.
  it('con otro valor configurado (90 minutos), el mensaje refleja ese número real, formateado igual que el aviso previo', async () => {
    mockUseConfiguracion.mockReturnValue({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 90 } });
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
      expect(getByText('Como cancelaste con menos de 1 hora 30 min de anticipación, no se reintegra el crédito.')).toBeTruthy()
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

  // BUG REAL, ticket "cancel_booking bloquea dentro del tiempo de gracia" --
  // cancel_booking() ahora rechaza (en vez de cancelar sin reintegrar) si
  // faltan menos de limite_cancelacion_minutos para la clase. El gate
  // cliente (withinCancelLimit, ver CancelBookingModal) ya deshabilita el
  // botón para este caso normalmente -- este test simula que el SERVIDOR
  // igual rechaza (reloj del cliente desincronizado, o cualquier otra
  // carrera) con CLASE_BASE (3hs en el futuro, el cliente la deja pasar):
  // confirma que se muestra el mensaje REAL del backend (no uno genérico) y
  // que la reserva NO se toca -- sigue viéndose "Reservada".
  it('si cancel_booking rechaza por estar dentro de la ventana, muestra el mensaje real del backend y la reserva sigue viéndose (no se borró nada)', async () => {
    mockFromDefault({ data: [{ class_id: 'class-1' }], error: null });
    mockedRpc.mockImplementation((fn: string) =>
      fn === 'cancel_booking'
        ? Promise.resolve({
            data: null,
            error: { message: 'No podés cancelar esta reserva -- faltan menos de 120 minutos para que empiece la clase.' },
          })
        : Promise.resolve({ data: null, error: null })
    );

    const { getByText, queryByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);
    await waitFor(() => expect(getByText('Reservada')).toBeTruthy());

    fireEvent.press(getByTestId('agenda-card-class-1'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() => expect(getByText('No se pudo cancelar')).toBeTruthy());
    expect(
      getByText('No podés cancelar esta reserva -- faltan menos de 120 minutos para que empiece la clase.')
    ).toBeTruthy();
    expect(queryByText('Reserva cancelada')).toBeNull();
    // La reserva sigue existiendo -- load() nunca se llamó por el camino de error.
    expect(getByText('Reservada')).toBeTruthy();
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
        expect(mockedRpc).toHaveBeenCalledWith('book_class', { p_class_id: 'class-1', p_booking_date: CLASE_BASE.occurrenceDate })
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
        expect(mockedRpc).toHaveBeenCalledWith('book_class', { p_class_id: 'class-1', p_booking_date: CLASE_BASE.occurrenceDate })
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

// Rediseño visual (mockup "Agenda - GreenFit"): SOLO estilo. Toda la tarjeta
// sigue siendo el único elemento tocable; el pill de estado es decorativo.
describe('AgendaMobileView -- rediseño visual (sin cambios de lógica)', () => {
  const DISPONIBLE = { ...CLASE_BASE, id: 'c-disp', title: 'CrossFit', startTime: '11:00:00' };
  const RESERVADA = { ...CLASE_BASE, id: 'c-res', title: 'Funcional', startTime: '12:00:00' };
  const LLENA = { ...CLASE_BASE, id: 'c-llena', title: 'Kickstrike', bookedCount: 10, startTime: '13:00:00' };
  // disc-2 no tiene saldo en el mock de fetchUserBalances -> "Sin créditos".
  const SIN_CREDITOS = { ...CLASE_BASE, id: 'c-sincred', title: 'Boxeo', disciplineId: 'disc-2', startTime: '14:00:00' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRpc.mockResolvedValue({ data: null, error: null });
    mockUseConfiguracion.mockReturnValue({ configuracion: { diasTolerancia: 5, limiteCancelacionMinutos: 120 } });
  });

  // Sube desde un nodo hasta el primer ancestro con onPress (lo que dispararía un toque ahí).
  function manejadorDelToque(nodo: any) {
    let actual = nodo;
    while (actual && !actual.props?.onPress) actual = actual.parent;
    return actual;
  }

  it('los 4 estados reales se ven con su pill: Reservar / Reservada / Sin cupo / Sin créditos', async () => {
    mockedLoadClasses.mockResolvedValue([DISPONIBLE, RESERVADA, LLENA, SIN_CREDITOS]);
    mockFromDefault({ data: [{ class_id: 'c-res' }], error: null });
    const { getByText, getByTestId } = render(<AgendaMobileView navigation={navigation} />);

    await waitFor(() => expect(getByText('Kickstrike')).toBeTruthy());
    const dentro = (id: string, texto: string) =>
      expect(
        getByTestId(`agenda-card-${id}`).findAll((n: any) => n.props.children === texto).length
      ).toBeGreaterThan(0);
    dentro('c-disp', 'Reservar');
    dentro('c-res', 'Reservada');
    dentro('c-llena', 'Sin cupo');
    dentro('c-sincred', 'Sin créditos');
    // Nada de "Disponible" (el pill de ese estado ahora dice "Reservar").
    expect(() => getByText('Disponible')).toThrow();
  });

  it('el pill es DECORATIVO: no tiene manejador propio y tocarlo dispara el handlePress de la tarjeta', async () => {
    mockedLoadClasses.mockResolvedValue([DISPONIBLE]);
    mockFromDefault({ data: [], error: null });
    const { getByText } = render(<AgendaMobileView navigation={navigation} />);

    await waitFor(() => expect(getByText('Reservar')).toBeTruthy());
    const pillTexto = getByText('Reservar');
    // El primer ancestro con onPress es la TARJETA entera, no el pill.
    const tocable = manejadorDelToque(pillTexto);
    expect(tocable?.props.testID).toBe('agenda-card-c-disp');
    // Y el contenedor del pill deja pasar el toque (pointerEvents="none").
    let n: any = pillTexto;
    let pointerNone = false;
    while (n && n !== tocable) {
      if (n.props?.pointerEvents === 'none') pointerNone = true;
      n = n.parent;
    }
    expect(pointerNone).toBe(true);

    // Tocar "encima del pill" hace lo mismo que tocar la tarjeta: abre la confirmación.
    fireEvent.press(pillTexto);
    await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
    expect(mockedRpc).not.toHaveBeenCalledWith('book_class', expect.anything());
  });

  it('mientras espera al servidor, la tarjeta muestra la ruedita en lugar del pill', async () => {
    mockedLoadClasses.mockResolvedValue([DISPONIBLE]);
    // La consulta de consentimiento queda colgada -> la tarjeta queda "pendiente".
    let liberar: (v: any) => void = () => {};
    const colgada = new Promise((res) => (liberar = res));
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain(CONTACTO_COMPLETO);
      if (table === 'consentimientos_socio') {
        const chain = makeChain(null);
        chain.then = (resolve: any, reject: any) => colgada.then(resolve, reject);
        return chain;
      }
      return makeChain({ data: [], error: null });
    });
    const { getByText, getByTestId, queryByText } = render(<AgendaMobileView navigation={navigation} />);

    await waitFor(() => expect(getByText('Reservar')).toBeTruthy());
    fireEvent.press(getByTestId('agenda-card-c-disp'));

    await waitFor(() => expect(getByTestId('agenda-card-cargando-c-disp')).toBeTruthy());
    expect(queryByText('Reservar')).toBeNull();
    liberar(CONSENT_VIGENTE);
    await waitFor(() => expect(getByText('¿Confirmás tu lugar en esta clase?')).toBeTruthy());
  });

  it('header con el nombre real del socio y SIN ningún total de créditos; cantidad de turnos y cuenta regresiva', async () => {
    mockedLoadClasses.mockResolvedValue([DISPONIBLE, RESERVADA]);
    mockFromDefault({ data: [], error: null });
    const { getByText, getAllByText, queryByText } = render(<AgendaMobileView navigation={navigation} />);

    await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());
    expect(getByText('Hola, Facundo')).toBeTruthy();
    expect(getByText('Mi Agenda')).toBeTruthy();
    expect(queryByText(/\d+\s*créditos/i)).toBeNull();
    expect(getByText('2 turnos')).toBeTruthy();
    // EN_3_HORAS -> la cuenta regresiva se mantiene.
    expect(getAllByText(/En 3 horas/)).toHaveLength(2); // una por tarjeta, en la línea de detalles
  });
});

describe('DaySelector -- estilo nuevo, mismos 10 días', () => {
  it('muestra 10 días (hoy + 9): "Hoy" y después el día abreviado a 3 letras (sin "Mañana"), con el elegido marcado', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DaySelector = require('../../components/DaySelector').default;
    const hoy = new Date();
    const { getAllByRole, getByText, getAllByText } = render(<DaySelector selectedDate={hoy} onSelect={jest.fn()} />);

    const dias = getAllByRole('button');
    expect(dias).toHaveLength(10);
    expect(getByText('Hoy')).toBeTruthy();
    // El segundo día usa el mismo formato corto que el resto de la fila.
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    expect(getAllByText(['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][manana.getDay()]).length).toBeGreaterThan(0);
    expect(() => getByText('Mañana')).toThrow();
    expect(dias.filter((d: any) => d.props.accessibilityState?.selected)).toHaveLength(1);
  });
});
