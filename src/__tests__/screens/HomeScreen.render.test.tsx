import React from 'react';
import { Alert, Platform, RefreshControl } from 'react-native';
import { render, fireEvent, waitFor, act, screen, within } from '@testing-library/react-native';

// HomeScreen usa useFocusEffect (no useEffect simple) para el refresh al
// volver de la WebView de pago -- sin un NavigationContainer real alrededor,
// hay que mockearlo para que dispare el callback una vez al montar, igual
// que un focus real haría la primera vez.
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
  useAuth: () => ({ user: { id: 'user-1', name: 'Facundo Uria', avatarUrl: null } }),
}));
// jest.fn() (no un objeto fijo) -- algunos tests necesitan un
// limiteCancelacionMinutos DISTINTO de 120 para confirmar que el mensaje de
// "no se reintegra el crédito" lee el valor real de Configuración en vez de
// un texto fijo ("2 horas" hardcodeado, bug real ya arreglado).
const mockUseConfiguracion = jest.fn(() => ({
  configuracion: {
    diasTolerancia: 5,
    limiteCancelacionMinutos: 120,
    aliasCvu: null,
    titularCuenta: null,
    alertaActiva: false,
    alertaMensaje: '',
  },
}));
jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => mockUseConfiguracion(),
}));
jest.mock('../../hooks/useTicker', () => ({ useTicker: () => {} }));
jest.mock('../../lib/notificationsBadge', () => ({ fetchUnreadNotificationCount: jest.fn().mockResolvedValue(0) }));
jest.mock('../../lib/creditsApi', () => ({
  // buildPackSubtitle/creditosOriginalesPara son lógica pura (sin red) --
  // se dejan reales en vez de mockearlas, mismo criterio que xpApi más
  // abajo, para no dejar un import undefined que reviente recién el día
  // que un test futuro sí puebla `packs`/balances.
  ...jest.requireActual('../../lib/creditsApi'),
  fetchUserBalances: jest.fn().mockResolvedValue([]),
  fetchPacks: jest.fn().mockResolvedValue([]),
  syncMyMembership: jest.fn().mockResolvedValue(undefined),
}));
// on/subscribe encadenan (mockReturnThis-style) igual que el cliente real de
// supabase-js -- capturados en variables de nombre `mock...` porque la
// factory de jest.mock corre hoisteada y Jest solo permite referenciar acá
// identificadores con ese prefijo.
const mockChannelOn = jest.fn(function (this: unknown, ..._args: unknown[]) {
  return this;
});
const mockChannelSubscribe = jest.fn(function (this: unknown, ..._args: unknown[]) {
  return this;
});
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    channel: jest.fn(() => ({ on: mockChannelOn, subscribe: mockChannelSubscribe })),
    removeChannel: jest.fn(),
  },
}));

// fetchTotalXp/fetchAsistenciaHoyRegistrada/fetchEntrenamientosHoy se mockean
// (tocan red); calcularResumenXp/XP_POR_NIVEL quedan REALES (son lógica pura,
// ya cubierta aparte en xpApi.test.ts) para no reinventar la fórmula acá.
// Inicio ya NO pide racha / miembro desde / clases del mes (viven en Mi
// Perfil) -- ver el test "no hace las queries de la tarjeta de perfil".
jest.mock('../../lib/xpApi', () => ({
  ...jest.requireActual('../../lib/xpApi'),
  fetchTotalXp: jest.fn(),
  fetchAsistenciaHoyRegistrada: jest.fn(),
  fetchEntrenamientosHoy: jest.fn(),
  registrarHoyEntrene: jest.fn(),
}));
// Mockeado acá también -- el selector de método de pago (Mercado Pago vs.
// transferencia) puede terminar disparando handleSelectPack, que llama a
// createPaymentPreference (Edge Function real vía supabase.functions.invoke,
// no cubierto por el mock de supabase de arriba).
jest.mock('../../lib/paymentsApi', () => ({ createPaymentPreference: jest.fn() }));

import { supabase } from '../../lib/supabase';
import { fetchUserBalances, fetchPacks } from '../../lib/creditsApi';
import { createPaymentPreference } from '../../lib/paymentsApi';
import {
  fetchTotalXp,
  fetchAsistenciaHoyRegistrada,
  fetchEntrenamientosHoy,
  registrarHoyEntrene,
} from '../../lib/xpApi';
import HomeScreen from '../../screens/user/HomeScreen';

const mockedFrom = supabase.from as jest.Mock;
const navigation = { navigate: jest.fn() };

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  // 'is' -- lo usa fetchEntrenamientosHoy (discipline_id is null) desde que
  // HomeScreen empezó a llamarla en cada load().
  ['select', 'eq', 'gte', 'order', 'is'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('HomeScreen (rediseño: carrusel de créditos + vencimiento + anillo de nivel)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFrom.mockImplementation(() => makeChain({ data: [], error: null })); // sin reservas próximas
    (fetchTotalXp as jest.Mock).mockResolvedValue(650); // nivel 2, 150/500 XP, faltan 350
    (fetchAsistenciaHoyRegistrada as jest.Mock).mockResolvedValue(false);
    (fetchEntrenamientosHoy as jest.Mock).mockResolvedValue(0);
    // Default 120 -- clearAllMocks() NO borra un mockReturnValue puesto por
    // un test anterior (solo mockReset lo haría), así que se reafirma acá
    // para que el override puntual de un test no se filtre a los de al lado.
    mockUseConfiguracion.mockReturnValue({
      configuracion: {
        diasTolerancia: 5,
        limiteCancelacionMinutos: 120,
        aliasCvu: null,
        titularCuenta: null,
        alertaActiva: false,
        alertaMensaje: '',
      },
    });
  });

  it('NO renderiza la tarjeta "Mi Pase / Comprar" (removida -- esa gestión ahora vive en Perfil > Pagos y Facturas)', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
    expect(queryByText('Mi Pase')).toBeNull();
    expect(queryByText('Comprar')).toBeNull();
  });

  // Bug real detectado: el único botón que abría "Elegí tu pack" era
  // "Renovar", y ese SOLO se renderiza si hayVencido -- un socio nuevo (0
  // packs) o uno con todo activo no tenía NINGÚN botón en toda la PWA para
  // llegar a comprar. Estos 3 tests cubren los 3 estados posibles del Hero
  // Card, confirmando que siempre hay EXACTAMENTE una forma de abrir el
  // modal, con la etiqueta correcta para cada caso.
  describe('acceso para comprar un pack (Hero Card) -- antes solo existía "Renovar", oculto salvo con algo vencido', () => {
    it('sin ningún pack activo, muestra "Elegir mi pack" (no "Renovar") y abre "Elegí tu pack" al tocarlo', async () => {
      const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());

      expect(queryByText('Renovar')).toBeNull();
      const boton = getByText('Elegir mi pack');
      fireEvent.press(boton);

      await waitFor(() => expect(getByText('Elegí tu pack')).toBeTruthy());
    });

    it('con un pack activo y nada vencido, muestra "Agregar otro pack" (no "Renovar" ni "Elegir mi pack")', async () => {
      // mockResolvedValueOnce (no mockResolvedValue) -- el default `[]` del
      // factory de arriba vive para SIEMPRE si se pisa con la variante
      // persistente, contaminando cualquier test que corra después de este
      // en el mismo archivo (no hay un beforeEach que lo vuelva a poner en
      // `[]`, a diferencia de fetchTotalXp y compañía).
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        {
          id: 'bal-1',
          userId: 'user-1',
          remainingCredits: 5,
          expiresAt: null,
          createdAt: '2026-01-01',
          discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' },
          pack: null,
        },
      ]);

      const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(getByText('CrossFit')).toBeTruthy());

      expect(queryByText('Renovar')).toBeNull();
      expect(queryByText('Elegir mi pack')).toBeNull();
      expect(getByText('Agregar otro pack')).toBeTruthy();
    });

    it('con algo vencido, sigue mostrando "Renovar" -- no el botón nuevo (comportamiento existente, sin tocar)', async () => {
      // mockResolvedValueOnce (no mockResolvedValue) -- el default `[]` del
      // factory de arriba vive para SIEMPRE si se pisa con la variante
      // persistente, contaminando cualquier test que corra después de este
      // en el mismo archivo (no hay un beforeEach que lo vuelva a poner en
      // `[]`, a diferencia de fetchTotalXp y compañía).
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        {
          id: 'bal-1',
          userId: 'user-1',
          remainingCredits: 0,
          expiresAt: null,
          createdAt: '2026-01-01',
          discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' },
          pack: null,
        },
      ]);

      const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(getByText('Renovar')).toBeTruthy());

      expect(queryByText('Elegir mi pack')).toBeNull();
      expect(queryByText('Agregar otro pack')).toBeNull();
    });
  });

  // Anillo de nivel (rediseño): el centro muestra SOLO el número de nivel --
  // el "150/500" ya no se escribe como texto (vive en Mi Perfil) -- pero el
  // ARCO sigue siendo el progreso REAL dentro del nivel (xpEnNivel / 500).
  it('el anillo muestra el número de nivel real, sin texto de XP ("150/500") ni el explicativo "Te faltan"', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
    expect(screen.getByTestId('nivel-numero').props.children).toBe(2);
    expect(getByText('NIVEL')).toBeTruthy();
    expect(queryByText('150/500')).toBeNull();
    expect(queryByText(/[/]500/)).toBeNull();
    expect(queryByText(/Te faltan/)).toBeNull();
  });

  describe('el arco del anillo es el % REAL de XP dentro del nivel (no un valor fijo)', () => {
    // Misma geometría que XpProgressRing (size 208, strokeWidth 7 en Home).
    const RADIO = (208 - 7 * 4) / 2;
    const CIRC = 2 * Math.PI * RADIO;
    const dashoffset = () => Number(screen.getByTestId('nivel-ring-arco').props.strokeDashoffset);

    it.each([
      [0, 1, 0],
      [650, 2, 150 / 500],
      [1150, 3, 150 / 500],
      [1249, 3, 249 / 500],
      [500, 2, 0],
    ])('con %i XP: nivel %i y arco al %d del recorrido', async (xp, nivelEsperado, progreso) => {
      (fetchTotalXp as jest.Mock).mockResolvedValue(xp);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText(`Nivel ${nivelEsperado}`)).toBeTruthy());
      expect(dashoffset()).toBeCloseTo(CIRC * (1 - progreso), 3);
    });

    it('el pie de accesibilidad expone el progreso sin escribirlo como texto', async () => {
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(screen.getByTestId('nivel-ring').props.accessibilityValue).toEqual({ min: 0, max: 500, now: 150 });
    });
  });

  // AsistenciaHoyStatus ("Esperando check-in...") se sacó de Inicio en el
  // rediseño -- sigue existiendo y probado en su propio
  // AsistenciaHoyStatus.test.tsx, esto solo confirma que ya NO vive acá.
  it('ya NO muestra el estado de check-in de hoy ("Esperando check-in...") -- se sacó de Inicio en el rediseño', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
    expect(queryByText('Esperando check-in en el gimnasio...')).toBeNull();
    expect(queryByText(/Seba registró tu asistencia/)).toBeNull();
  });

  // Rediseño del CTA de reservas: sin ninguna reserva próxima, un botón
  // grande de acción directa reemplaza al viejo bloque de texto gris
  // "Todavía no tenés reservas".
  it('sin reservas: muestra el botón grande "📅 Reservar próxima clase" (no el bloque de texto gris)', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('📅 Reservar próxima clase')).toBeTruthy());
    expect(queryByText('Todavía no tenés reservas')).toBeNull();
    expect(queryByText('Elegí tu próxima clase')).toBeNull();

    fireEvent.press(getByText('📅 Reservar próxima clase'));
    expect(navigation.navigate).toHaveBeenCalledWith('Reservas');
  });

  it('con una reserva próxima: la muestra como un ticket limpio (disciplina + día + hora), sin la etiqueta "Tu próxima clase" ni el countdown', async () => {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().slice(0, 10);

    mockedFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return makeChain({
          data: [
            { class_id: 'clase-1', booking_date: mananaStr, classes: { title: 'CrossFit', start_time: '19:00:00' } },
          ],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });

    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText(/CrossFit/)).toBeTruthy());

    expect(queryByText('Tu próxima clase')).toBeNull();
    expect(queryByText('📅 Reservar próxima clase')).toBeNull();
    expect(getByText('Cancelar')).toBeTruthy();
  });

  // BUG REAL -- el mensaje de resultado tras cancelar decía "2 horas" como
  // texto FIJO, sin leer configuracion.limite_cancelacion_minutos (a
  // diferencia del aviso PREVIO del mismo modal, que sí lo leía). Con 10
  // minutos configurados, el socio seguía viendo "2 horas", un dato falso.
  it('cancelar fuera del límite de gracia (10 minutos configurados) -- el aviso dice "10 minutos", NO "2 horas"', async () => {
    mockUseConfiguracion.mockReturnValue({
      configuracion: {
        diasTolerancia: 5,
        limiteCancelacionMinutos: 10,
        aliasCvu: null,
        titularCuenta: null,
        alertaActiva: false,
        alertaMensaje: '',
      },
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().slice(0, 10);
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return makeChain({
          data: [
            { class_id: 'clase-1', booking_date: mananaStr, classes: { title: 'CrossFit', start_time: '19:00:00' } },
          ],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: false, error: null }); // fuera del límite -- NO reintegra

    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Cancelar')).toBeTruthy());

    fireEvent.press(getByText('Cancelar'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Reserva cancelada',
        'Como cancelaste con menos de 10 minutos de anticipación, no se reintegra el crédito.'
      )
    );
  });

  // BUG REAL, ticket "cancel_booking bloquea dentro del tiempo de gracia" --
  // ahora rechaza (en vez de cancelar sin reintegrar) si faltan menos de
  // limite_cancelacion_minutos. Reserva de MAÑANA (el gate cliente la deja
  // pasar, botón habilitado) pero el RPC mockeado rechaza igual -- simula
  // que el servidor lo bloqueó (reloj desincronizado u otra carrera):
  // confirma que se muestra el mensaje REAL del backend, con showAlert (no
  // Alert.alert nativo directo), y que no se dice "cancelada".
  it('si cancel_booking rechaza por estar dentro de la ventana, showAlert muestra el mensaje real del backend (no genérico)', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().slice(0, 10);
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return makeChain({
          data: [
            { class_id: 'clase-1', booking_date: mananaStr, classes: { title: 'CrossFit', start_time: '19:00:00' } },
          ],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'No podés cancelar esta reserva -- faltan menos de 120 minutos para que empiece la clase.' },
    });

    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Cancelar')).toBeTruthy());

    fireEvent.press(getByText('Cancelar'));
    await waitFor(() => expect(getByText('Confirmar cancelación')).toBeTruthy());
    fireEvent.press(getByText('Confirmar cancelación'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'No se pudo cancelar',
        'No podés cancelar esta reserva -- faltan menos de 120 minutos para que empiece la clase.'
      )
    );
    // Alert.alert es un no-op mockeado -- no renderiza nada en el árbol, así
    // que lo que importa es que nunca se lo llamó con el título de éxito
    // (queryByText('Reserva cancelada') sería trivialmente null de todos
    // modos, ya que Alert.alert nunca pinta JSX).
    expect(Alert.alert).not.toHaveBeenCalledWith('Reserva cancelada', expect.anything());
  });

  // La reseña de Google se mudó a Mi Perfil (es una acción secundaria) --
  // Inicio queda reservado a lo operativo del día a día.
  it('ya NO muestra la tarjeta de reseña de Google -- se mudó a Mi Perfil', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
    expect(queryByText('¿Te gusta entrenar en GreenFit?')).toBeNull();
  });

  it('el ícono "¿Cómo ganar XP?" abre el modal con la única regla vigente (asistencia acreditada por el Admin)', async () => {
    const { getByText, getByLabelText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());

    // Un solo ícono ⓘ (junto al anillo) -- la tarjeta de perfil gamificada
    // ya no está en Inicio.
    fireEvent.press(getByLabelText('¿Cómo ganar XP?'));

    await waitFor(() => expect(getByText('¿Cómo ganar XP?')).toBeTruthy());
    expect(getByText('Asistencia diaria')).toBeTruthy();
    expect(getByText(/Acreditados presencialmente al realizar tu check-in en el gimnasio/)).toBeTruthy();
    // Reservar una clase también otorga XP (regla nueva, con clawback al cancelar).
    expect(getByText('Reservar una clase')).toBeTruthy();
    expect(getByText(/Se descuentan si cancelás la reserva/)).toBeTruthy();
    // Las reglas dadas de baja ya no aparecen.
    expect(queryByText('Publicar en la Comunidad')).toBeNull();
    expect(queryByText('Superar un Récord Personal (PR)')).toBeNull();
    expect(queryByText('Completar una Meta Personal')).toBeNull();
  });

  // Bug crítico de sincronización Admin↔PWA (2026-08-07): un ajuste de
  // créditos hecho desde el panel Admin (user_credits) solo se veía acá
  // recién al salir de Inicio y volver a entrar (useFocusEffect). Esto
  // prueba que, ADEMÁS, hay una suscripción en vivo -- si la pantalla ya
  // está abierta cuando el Admin ajusta algo, el balance se refresca solo,
  // sin que el socio tenga que navegar a ningún lado.
  it('se suscribe en vivo a cambios de user_credits del propio socio y refresca el balance cuando llega un evento', async () => {
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());

    expect(supabase.channel).toHaveBeenCalledWith('user-credits-user-1');
    expect(mockChannelOn).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_credits', filter: 'user_id=eq.user-1' },
      expect.any(Function)
    );
    expect(mockChannelSubscribe).toHaveBeenCalled();

    (fetchUserBalances as jest.Mock).mockClear();
    const callbackRealtime = mockChannelOn.mock.calls[0][2] as (payload: unknown) => void;
    await act(async () => {
      callbackRealtime({});
    });

    await waitFor(() => expect(fetchUserBalances).toHaveBeenCalledTimes(1));
  });

  it('al desmontar la pantalla, se da de baja el canal de Realtime (no deja una suscripción huérfana)', async () => {
    const { getByText, unmount } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Carrusel de créditos + tarjeta de Vencimiento (rediseño). Regla de estos
  // tests: NINGÚN dato sale del mockup -- se usan disciplinas, números y
  // fechas DISTINTOS a los de ejemplo (Yoga/Pilates/..., no Crossfit 15) para
  // que un valor escrito a mano en el componente no pase desapercibido.
  // ---------------------------------------------------------------------
  const bal = (
    id: string,
    name: string,
    kind: 'credits' | 'membership',
    remainingCredits: number | null,
    expiresAt: string | null,
    lotes?: { id: string; remainingCredits: number; expiresAt: string }[]
  ) => ({
    id: `bal-${id}`,
    userId: 'user-1',
    remainingCredits,
    expiresAt,
    createdAt: '2026-01-01',
    discipline: { id: `disc-${id}`, name, kind },
    pack: null,
    lotes,
  });
  const conLote = (id: string, name: string, cantidad: number, expiresAt: string) =>
    bal(id, name, 'credits', cantidad, expiresAt, [{ id: `lote-${id}`, remainingCredits: cantidad, expiresAt }]);

  describe('carrusel de créditos -- una tarjeta por disciplina activa, todo desde balances', () => {
    it('5 disciplinas (nombres y cantidades que NO son los del mockup): 5 tarjetas con su nombre y su número reales', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        conLote('yoga', 'Yoga', 23, '2026-11-08T12:00:00.000Z'),
        conLote('pilates', 'Pilates', 6, '2026-11-08T12:00:00.000Z'),
        conLote('spin', 'Spinning', 11, '2026-11-08T12:00:00.000Z'),
        conLote('nat', 'Natación', 9, '2026-11-08T12:00:00.000Z'),
        bal('apar', 'Aparatos', 'membership', null, '2026-11-08T12:00:00.000Z'),
      ]);

      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('credito-card-disc-yoga')).toBeTruthy());

      for (const [id, nombre, numero] of [
        ['yoga', 'Yoga', '23'],
        ['pilates', 'Pilates', '6'],
        ['spin', 'Spinning', '11'],
        ['nat', 'Natación', '9'],
      ]) {
        const tarjeta = within(screen.getByTestId(`credito-card-disc-${id}`));
        expect(tarjeta.getByText(nombre)).toBeTruthy();
        expect(tarjeta.getByText(numero)).toBeTruthy();
        expect(tarjeta.getByText('créditos')).toBeTruthy();
      }
      // 5 tarjetas en total -- ni más ni menos que balances.
      expect(screen.getByTestId('creditos-carrusel')).toBeTruthy();
      expect(screen.getAllByTestId(/^credito-card-/)).toHaveLength(5);
    });

    it('con 2 disciplinas se ven 2 tarjetas (no hay una cantidad fija)', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        conLote('a', 'Escalada', 3, '2026-11-08T12:00:00.000Z'),
        conLote('b', 'Yoga', 14, '2026-11-08T12:00:00.000Z'),
      ]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByText('Escalada')).toBeTruthy());
      expect(screen.getAllByTestId(/^credito-card-/)).toHaveLength(2);
    });

    it('Aparatos (membership): "∞" y "pase libre", SIN ningún número', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        bal('apar', 'Aparatos', 'membership', null, '2026-11-01T12:00:00.000Z'),
      ]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('credito-card-disc-apar')).toBeTruthy());

      const tarjeta = within(screen.getByTestId('credito-card-disc-apar'));
      expect(tarjeta.getByText('Aparatos')).toBeTruthy();
      expect(tarjeta.getByText('∞')).toBeTruthy();
      expect(tarjeta.getByText('pase libre')).toBeTruthy();
      expect(tarjeta.queryByText('créditos')).toBeNull();
      expect(tarjeta.queryByText(/^\d+$/)).toBeNull();
    });

    it('1 solo crédito: la etiqueta va en singular', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([conLote('x', 'Yoga', 1, '2026-11-08T12:00:00.000Z')]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('credito-card-disc-x')).toBeTruthy());
      const tarjeta = within(screen.getByTestId('credito-card-disc-x'));
      expect(tarjeta.getByText('1')).toBeTruthy();
      expect(tarjeta.getByText('crédito')).toBeTruthy();
    });

    it('sin ningún pack activo: no hay carrusel, hay el mensaje vacío + "Elegir mi pack"', async () => {
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByText('Todavía no tenés ningún pack activo.')).toBeTruthy());
      expect(screen.queryByTestId('creditos-carrusel')).toBeNull();
      expect(screen.queryByTestId('vencimiento-card')).toBeNull();
    });
  });

  describe('tarjeta de Vencimiento -- UNA fecha, desde user_credits (no desde socios.fecha_vencimiento)', () => {
    it('socio de SOLO CRÉDITOS (sin Aparatos): muestra la fecha del plan con el badge "Activo al día"', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z')]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('vencimiento-card')).toBeTruthy());

      expect(within(screen.getByTestId('vencimiento-card')).getByText('19 de Diciembre, 2026')).toBeTruthy();
      expect(within(screen.getByTestId('vencimiento-card')).getByText('Activo al día')).toBeTruthy();
      expect(screen.getByText('Vencimiento de cuota')).toBeTruthy();
    });

    it('créditos + Aparatos con la MISMA fecha: UNA sola tarjeta de vencimiento (no una por disciplina)', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z'),
        bal('apar', 'Aparatos', 'membership', null, '2026-12-19T12:00:00.000Z'),
      ]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('vencimiento-card')).toBeTruthy());
      expect(screen.getAllByTestId('vencimiento-card')).toHaveLength(1);
      expect(screen.getByText('19 de Diciembre, 2026')).toBeTruthy();
    });

    it('a 3 días de vencer: el badge dice "Por vencer" (misma lógica de membershipStatus.ts)', async () => {
      const enTresDias = new Date(Date.now() + 3 * 86_400_000).toISOString();
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([conLote('a', 'Yoga', 5, enTresDias)]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('vencimiento-card')).toBeTruthy());
      expect(within(screen.getByTestId('vencimiento-card')).getByText('Por vencer')).toBeTruthy();
      expect(within(screen.getByTestId('vencimiento-card')).queryByText('Activo al día')).toBeNull();
    });

    it('datos viejos con 2 fechas distintas: muestra la MÁS LEJANA y deja un aviso en consola', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        bal('apar', 'Aparatos', 'membership', null, '2026-10-08T12:00:00.000Z'),
        conLote('a', 'Yoga', 12, '2026-11-08T12:00:00.000Z'),
      ]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('vencimiento-card')).toBeTruthy());

      expect(screen.getByText('8 de Noviembre, 2026')).toBeTruthy();
      expect(screen.queryByText('8 de Octubre, 2026')).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 fechas de vencimiento activas distintas'));
      warn.mockRestore();
    });
  });

  describe('header y alcance del rediseño', () => {
    it('saludo con el nombre real del usuario y acceso a la credencial', async () => {
      const { getByText, getByLabelText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(getByText(/Hola, Facundo Uria/)).toBeTruthy();

      fireEvent.press(getByLabelText('Ver mi credencial'));
      expect(navigation.navigate).toHaveBeenCalledWith('Credential');
    });

    it('la campanita muestra el contador REAL de no leídas (y "9+" si pasa de 9)', async () => {
      const { fetchUnreadNotificationCount } = require('../../lib/notificationsBadge');
      (fetchUnreadNotificationCount as jest.Mock).mockResolvedValueOnce(4);
      const primero = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(primero.getByText('4')).toBeTruthy());
      primero.unmount();

      (fetchUnreadNotificationCount as jest.Mock).mockResolvedValueOnce(27);
      const segundo = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(segundo.getByText('9+')).toBeTruthy());
    });

    it('sin no leídas no aparece ningún badge numérico', async () => {
      const { queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(queryByText('9+')).toBeNull();
      expect(queryByText('0')).toBeNull();
    });

    it('el avatar se puede tocar para cambiar la foto (conserva el comportamiento de antes)', async () => {
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(screen.getByLabelText('Cambiar foto de perfil')).toBeTruthy();
    });

    it('NO muestra el trío Racha / Miembro desde / Clases (mes) ni la barra de XP: viven solo en Mi Perfil', async () => {
      const { queryByText, queryByTestId } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(queryByText('Racha')).toBeNull();
      expect(queryByText('Miembro desde')).toBeNull();
      expect(queryByText('Clases (mes)')).toBeNull();
      expect(queryByText(/\d+ \/ 500 XP/)).toBeNull();
      expect(queryByText(/^NIVEL \d+$/)).toBeNull(); // el badge "NIVEL N" de la tarjeta de perfil
      expect(queryByTestId('stat-racha')).toBeNull();
    });

    it('ya no hace las queries de la tarjeta de perfil (racha / miembro desde / clases del mes)', async () => {
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(mockedFrom).not.toHaveBeenCalledWith('profiles'); // fetchMiembroDesde
      expect(supabase.rpc).not.toHaveBeenCalledWith('mi_dia_corte'); // fetchClasesDelMes
      expect(mockedFrom).not.toHaveBeenCalledWith('xp_events'); // fetchFechasAsistencia (racha)
    });
  });

  // ---------------------------------------------------------------------
  // REACTIVIDAD -- la pantalla YA ABIERTA tiene que reflejar cambios reales
  // de datos (lo que hace el Admin: -1 crédito, mover la fecha del plan,
  // agregar/quitar disciplina, dejar al socio sin nada), sin reiniciar la
  // app. Los dos caminos que refrescan son (1) el evento de Realtime sobre
  // user_credits, que dispara load(), y (2) el pull-to-refresh -- ambos
  // vuelven a pedir fetchUserBalances() y reemplazan el estado entero (no
  // hay ningún caché que conserve el valor viejo). Cada test arma el estado
  // "antes" y el "después" como dos respuestas sucesivas del backend.
  // ---------------------------------------------------------------------
  describe('reactividad: cambios de datos con la pantalla abierta (Realtime -> load())', () => {
    const disparaRealtime = async () => {
      // La suscripción se re-registra en cada render (el mock de useAuth
      // devuelve un `user` nuevo cada vez) -- se usa la más reciente.
      const llamadas = mockChannelOn.mock.calls;
      const callback = llamadas[llamadas.length - 1][2] as (payload: unknown) => void;
      await act(async () => {
        callback({});
      });
    };

    it('1) sacar créditos (-1 desde el Admin o reservar una clase): el número de la tarjeta baja', async () => {
      (fetchUserBalances as jest.Mock)
        .mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z')])
        .mockResolvedValueOnce([conLote('a', 'Yoga', 11, '2026-12-19T12:00:00.000Z')]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(within(screen.getByTestId('credito-card-disc-a')).getByText('12')).toBeTruthy());

      await disparaRealtime();

      await waitFor(() => expect(within(screen.getByTestId('credito-card-disc-a')).getByText('11')).toBeTruthy());
      expect(within(screen.getByTestId('credito-card-disc-a')).queryByText('12')).toBeNull();
    });

    it('2) cambiar la fecha del plan ("Vencimiento del plan"): la tarjeta muestra la fecha NUEVA, no la vieja', async () => {
      (fetchUserBalances as jest.Mock)
        .mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z')])
        .mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2027-01-15T12:00:00.000Z')]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('vencimiento-fecha').props.children).toBe('19 de Diciembre, 2026'));

      await disparaRealtime();

      await waitFor(() => expect(screen.getByTestId('vencimiento-fecha').props.children).toBe('15 de Enero, 2027'));
      expect(screen.queryByText('19 de Diciembre, 2026')).toBeNull();
    });

    it('3) agregar una disciplina y Aparatos: aparecen tarjetas nuevas en el carrusel, sin recargar', async () => {
      (fetchUserBalances as jest.Mock)
        .mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z')])
        .mockResolvedValueOnce([
          conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z'),
          conLote('b', 'Pilates', 4, '2026-12-19T12:00:00.000Z'),
          bal('apar', 'Aparatos', 'membership', null, '2026-12-19T12:00:00.000Z'),
        ]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getAllByTestId(/^credito-card-/)).toHaveLength(1));

      await disparaRealtime();

      await waitFor(() => expect(screen.getAllByTestId(/^credito-card-/)).toHaveLength(3));
      expect(within(screen.getByTestId('credito-card-disc-b')).getByText('Pilates')).toBeTruthy();
      expect(within(screen.getByTestId('credito-card-disc-b')).getByText('4')).toBeTruthy();
      expect(within(screen.getByTestId('credito-card-disc-apar')).getByText('∞')).toBeTruthy();
      // Sigue habiendo UNA sola tarjeta de vencimiento.
      expect(screen.getAllByTestId('vencimiento-card')).toHaveLength(1);
    });

    it('4) quitar una disciplina: su tarjeta desaparece del carrusel y las demás quedan intactas', async () => {
      (fetchUserBalances as jest.Mock)
        .mockResolvedValueOnce([
          conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z'),
          conLote('b', 'Pilates', 4, '2026-12-19T12:00:00.000Z'),
        ])
        .mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z')]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('credito-card-disc-b')).toBeTruthy());

      await disparaRealtime();

      await waitFor(() => expect(screen.queryByTestId('credito-card-disc-b')).toBeNull());
      expect(screen.getAllByTestId(/^credito-card-/)).toHaveLength(1);
      expect(within(screen.getByTestId('credito-card-disc-a')).getByText('12')).toBeTruthy();
    });

    it('5) sin NADA activo: estado vacío con "Elegir mi pack" -- sin carrusel, sin tarjeta de vencimiento, sin tarjetas rotas', async () => {
      (fetchUserBalances as jest.Mock)
        .mockResolvedValueOnce([
          conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z'),
          bal('apar', 'Aparatos', 'membership', null, '2026-12-19T12:00:00.000Z'),
        ])
        .mockResolvedValueOnce([]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByText('Agregar otro pack')).toBeTruthy());

      await disparaRealtime();

      await waitFor(() => expect(screen.getByText('Todavía no tenés ningún pack activo.')).toBeTruthy());
      expect(screen.getByText('Elegir mi pack')).toBeTruthy();
      expect(screen.queryByText('Agregar otro pack')).toBeNull();
      expect(screen.queryByTestId('creditos-carrusel')).toBeNull();
      expect(screen.queryByTestId('vencimiento-card')).toBeNull();
      expect(screen.queryAllByTestId(/^credito-card-/)).toHaveLength(0);
      // Sin disciplinas activas tampoco se ofrece "Hoy Entrené".
      expect(screen.queryByText('💪 Hoy Entrené')).toBeNull();
    });

    it('el pull-to-refresh también trae los datos nuevos (mismo load() que Realtime y que volver a la pestaña)', async () => {
      (fetchUserBalances as jest.Mock)
        .mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z')])
        .mockResolvedValueOnce([conLote('a', 'Yoga', 7, '2026-12-19T12:00:00.000Z')]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(within(screen.getByTestId('credito-card-disc-a')).getByText('12')).toBeTruthy());

      const refresh = screen.UNSAFE_getByType(RefreshControl);
      await act(async () => {
        await refresh.props.onRefresh();
      });

      await waitFor(() => expect(within(screen.getByTestId('credito-card-disc-a')).getByText('7')).toBeTruthy());
    });

    it('un cambio de datos NO deja al socio con una tarjeta vieja: cada load() reemplaza el estado completo', async () => {
      (fetchUserBalances as jest.Mock)
        .mockResolvedValueOnce([conLote('a', 'Yoga', 12, '2026-12-19T12:00:00.000Z')])
        .mockResolvedValueOnce([conLote('b', 'Natación', 3, '2026-12-19T12:00:00.000Z')]);
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByTestId('credito-card-disc-a')).toBeTruthy());

      await disparaRealtime();

      await waitFor(() => expect(screen.getByTestId('credito-card-disc-b')).toBeTruthy());
      expect(screen.queryByTestId('credito-card-disc-a')).toBeNull();
    });
  });

  describe('6) el anillo de nivel se mueve con el XP real', () => {
    const CIRC = 2 * Math.PI * ((208 - 7 * 4) / 2);
    const dashoffset = () => Number(screen.getByTestId('nivel-ring-arco').props.strokeDashoffset);

    it('"Hoy Entrené" cruzando de nivel (450/500 -> 550): sube a NIVEL 3 y el arco vuelve a 10%', async () => {
      (fetchTotalXp as jest.Mock).mockResolvedValue(950); // nivel 2, 450/500
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([conLote('a', 'Yoga', 5, '2026-12-19T12:00:00.000Z')]);
      (registrarHoyEntrene as jest.Mock).mockResolvedValue({
        otorgado: true,
        xpOtorgado: 100,
        entrenamientosHoy: 1,
        entrenamientosMaximos: 3,
      });
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(dashoffset()).toBeCloseTo(CIRC * (1 - 450 / 500), 3);

      fireEvent.press(screen.getByText('💪 Hoy Entrené'));

      await waitFor(() => expect(screen.getByLabelText('Nivel 3')).toBeTruthy());
      expect(dashoffset()).toBeCloseTo(CIRC * (1 - 50 / 500), 3);
    });

    it('cuando el RPC no otorga nada (tope diario), el arco NO se mueve', async () => {
      (fetchTotalXp as jest.Mock).mockResolvedValue(650);
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([conLote('a', 'Yoga', 5, '2026-12-19T12:00:00.000Z')]);
      (registrarHoyEntrene as jest.Mock).mockResolvedValue({
        otorgado: false,
        xpOtorgado: 0,
        entrenamientosHoy: 1,
        entrenamientosMaximos: 1,
      });
      render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      const antes = dashoffset();

      fireEvent.press(screen.getByText('💪 Hoy Entrené'));

      // El texto aparece dos veces (botón agotado + mensaje de feedback).
      await waitFor(() => expect(screen.getAllByText('Ya registraste todos tus entrenamientos de hoy').length).toBeGreaterThan(0));
      expect(dashoffset()).toBeCloseTo(antes, 6);
    });
  });

  describe('botón "Hoy Entrené" (autoreporte con tope = disciplinas activas)', () => {
    it('sin ninguna disciplina activa (balances vacío, default), no muestra el botón', async () => {
      const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(queryByText('💪 Hoy Entrené')).toBeNull();
    });

    it('con 1 disciplina activa, muestra el botón; al tocarlo, actualiza el XP en pantalla AL INSTANTE (sin refetch)', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        {
          id: 'bal-1',
          userId: 'user-1',
          remainingCredits: 5,
          expiresAt: null,
          createdAt: '2026-01-01',
          discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' },
          pack: null,
        },
      ]);
      (registrarHoyEntrene as jest.Mock).mockResolvedValue({
        otorgado: true,
        xpOtorgado: 100,
        entrenamientosHoy: 1,
        entrenamientosMaximos: 1,
      });

      const { getByText } = render(<HomeScreen navigation={navigation} />);
      // 650 XP (mock del beforeEach) -> nivel 2, 150/500 -> el arco queda al 30%.
      const CIRC = 2 * Math.PI * ((208 - 7 * 4) / 2);
      const dashoffset = () => Number(screen.getByTestId('nivel-ring-arco').props.strokeDashoffset);
      await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
      expect(dashoffset()).toBeCloseTo(CIRC * (1 - 150 / 500), 3);

      fireEvent.press(getByText('💪 Hoy Entrené'));

      // 650 + 100 = 750 -> sigue nivel 2, 250/500 -- el arco se actualiza
      // solo con la respuesta del RPC, sin volver a llamar fetchTotalXp.
      await waitFor(() => expect(dashoffset()).toBeCloseTo(CIRC * (1 - 250 / 500), 3));
      expect(getByText('Ya registraste todos tus entrenamientos de hoy')).toBeTruthy();
      // fetchTotalXp: 1 vez en el load() inicial nomás -- el +100 de acá
      // fue 100% optimista/local, no un refetch.
      expect(fetchTotalXp).toHaveBeenCalledTimes(1);
    });

    it('con 2 disciplinas activas, el botón queda disponible para un segundo click después del primero', async () => {
      (fetchUserBalances as jest.Mock).mockResolvedValueOnce([
        {
          id: 'bal-1',
          userId: 'user-1',
          remainingCredits: 5,
          expiresAt: null,
          createdAt: '2026-01-01',
          discipline: { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' },
          pack: null,
        },
        {
          id: 'bal-2',
          userId: 'user-1',
          remainingCredits: 3,
          expiresAt: null,
          createdAt: '2026-01-01',
          discipline: { id: 'disc-boxeo', name: 'Boxeo', kind: 'credits' },
          pack: null,
        },
      ]);
      (registrarHoyEntrene as jest.Mock).mockResolvedValue({
        otorgado: true,
        xpOtorgado: 100,
        entrenamientosHoy: 1,
        entrenamientosMaximos: 2,
      });

      const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(getByText('💪 Hoy Entrené')).toBeTruthy());

      fireEvent.press(getByText('💪 Hoy Entrené'));

      await waitFor(() => expect(getByText('¡Bien! Te queda 1 entrenamiento disponible hoy')).toBeTruthy());
      // Con 1 de 2 usados, el botón sigue habilitado para el segundo.
      expect(getByText('💪 Hoy Entrené')).toBeTruthy();
      expect(queryByText('Ya registraste todos tus entrenamientos de hoy')).toBeNull();
    });
  });

  // Fase 4: Mercado Pago se desconectó de la interfaz -- transferencia
  // (Fase 2) queda como único camino, así que el selector "¿Cómo querés
  // pagar?" (que existió entre Fase 2 y Fase 3) se sacó: con una sola
  // opción no tenía sentido preguntar. handleSelectPack/createPaymentPreference
  // NO se borraron del código (ver el comentario en HomeScreen.tsx), solo
  // dejaron de estar cableados a ningún botón -- por eso esta suite confirma
  // que ya no se llaman desde acá, sin importar que la función siga existiendo.
  describe('tocar un pack (Mercado Pago desconectado de la UI -- Fase 4)', () => {
    const PACK_TEST = {
      id: 'pack-1',
      name: 'Combo 8+8',
      creditos: [],
      incluyeAparatos: false,
      diasVigencia: null,
      price: 15000,
      isActive: true,
    };

    beforeEach(() => {
      (fetchPacks as jest.Mock).mockResolvedValueOnce([PACK_TEST]);
    });

    it('al tocar un pack en "Elegí tu pack", navega directo a TransferReceipt -- ya no pregunta "¿Cómo querés pagar?"', async () => {
      const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(getByText('Elegir mi pack')).toBeTruthy());
      fireEvent.press(getByText('Elegir mi pack'));
      await waitFor(() => expect(getByText('Combo 8+8')).toBeTruthy());

      fireEvent.press(getByText('Combo 8+8'));

      expect(navigation.navigate).toHaveBeenCalledWith('TransferReceipt', {
        packId: 'pack-1',
        packName: 'Combo 8+8',
        monto: 15000,
      });
      expect(queryByText('¿Cómo querés pagar?')).toBeNull();
      expect(queryByText('Pagar con Mercado Pago')).toBeNull();
      expect(createPaymentPreference).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalledWith('PaymentWebView', expect.anything());
    });
  });
});

// Bug crítico (2026-08-07): "React Native WebView does not support this
// platform" al volver de Mercado Pago en Web -- ahí no hay WebView que
// intercepte la navegación como en nativo, así que HomeScreen es quien lee
// el resultado directo de la URL con la que la PWA volvió a cargar (back_url
// = origin real de la PWA, ver resolveBackUrls en el Edge Function).
describe('HomeScreen -- Web/PWA: detecta la vuelta de Mercado Pago desde la URL', () => {
  const originalWindow = (global as any).window;
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFrom.mockImplementation(() => makeChain({ data: [], error: null }));
    (fetchTotalXp as jest.Mock).mockResolvedValue(650);
    (fetchAsistenciaHoyRegistrada as jest.Mock).mockResolvedValue(false);
    (fetchEntrenamientosHoy as jest.Mock).mockResolvedValue(0);
  });

  afterEach(() => {
    (global as any).window = originalWindow;
    Platform.OS = originalPlatformOS;
  });

  it('con status=approved en la URL, navega a PaymentWebView con el resultado ya resuelto y limpia la URL', async () => {
    Platform.OS = 'web';
    const replaceState = jest.fn();
    (global as any).window = {
      location: { href: 'https://app.greenfit.test/?status=approved&payment_id=1', pathname: '/' },
      history: { replaceState },
    };

    render(<HomeScreen navigation={navigation} />);

    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('PaymentWebView', { webResultado: 'approved' })
    );
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('sin ningún marcador de resultado en la URL (navegación normal a Inicio), no navega a ningún lado', async () => {
    Platform.OS = 'web';
    (global as any).window = {
      location: { href: 'https://app.greenfit.test/', pathname: '/' },
      history: { replaceState: jest.fn() },
    };

    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
    expect(navigation.navigate).not.toHaveBeenCalledWith('PaymentWebView', expect.anything());
  });

  it('en nativo (Platform.OS !== web), ignora la URL aunque window exista (no debería, pero por las dudas)', async () => {
    Platform.OS = 'ios';
    (global as any).window = {
      location: { href: 'https://app.greenfit.test/?status=approved', pathname: '/' },
      history: { replaceState: jest.fn() },
    };

    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByLabelText('Nivel 2')).toBeTruthy());
    expect(navigation.navigate).not.toHaveBeenCalledWith('PaymentWebView', expect.anything());
  });
});
