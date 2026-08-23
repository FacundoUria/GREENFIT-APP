import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

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
jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => ({
    configuracion: {
      diasTolerancia: 5,
      limiteCancelacionMinutos: 120,
      aliasCvu: null,
      titularCuenta: null,
      alertaActiva: false,
      alertaMensaje: '',
    },
  }),
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

// fetchTotalXp/fetchAsistenciaHoyRegistrada/fetchClasesDelMes/
// fetchMiembroDesde/fetchFechasAsistencia se mockean (tocan red -- makeChain
// de abajo no implementa .single()/.maybeSingle(), así que la versión real
// de fetchMiembroDesde rompería contra ese mock); calcularResumenXp/
// calcularRachaDias/XP_POR_NIVEL quedan REALES (son lógica pura, ya
// cubierta aparte en xpApi.test.ts) para no reinventar la fórmula acá.
jest.mock('../../lib/xpApi', () => ({
  ...jest.requireActual('../../lib/xpApi'),
  fetchTotalXp: jest.fn(),
  fetchAsistenciaHoyRegistrada: jest.fn(),
  fetchClasesDelMes: jest.fn(),
  fetchMiembroDesde: jest.fn(),
  fetchFechasAsistencia: jest.fn(),
  fetchEntrenamientosHoy: jest.fn(),
  registrarHoyEntrene: jest.fn(),
}));

import { supabase } from '../../lib/supabase';
import { fetchUserBalances } from '../../lib/creditsApi';
import {
  fetchTotalXp,
  fetchAsistenciaHoyRegistrada,
  fetchClasesDelMes,
  fetchMiembroDesde,
  fetchFechasAsistencia,
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

describe('HomeScreen (Dashboard -- widget de Progreso Diario reemplaza a "Mi Pase")', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFrom.mockImplementation(() => makeChain({ data: [], error: null })); // sin reservas próximas
    (fetchTotalXp as jest.Mock).mockResolvedValue(650); // nivel 2, 150/500 XP, faltan 350
    (fetchAsistenciaHoyRegistrada as jest.Mock).mockResolvedValue(false);
    (fetchClasesDelMes as jest.Mock).mockResolvedValue(0);
    (fetchMiembroDesde as jest.Mock).mockResolvedValue(null);
    (fetchFechasAsistencia as jest.Mock).mockResolvedValue([]);
    (fetchEntrenamientosHoy as jest.Mock).mockResolvedValue(0);
  });

  it('NO renderiza la tarjeta "Mi Pase / Comprar" (removida -- esa gestión ahora vive en Perfil > Pagos y Facturas)', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());
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
      await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

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

  // Rediseño minimalista (menos carga cognitiva): el widget circular es
  // AHORA lo único que queda del bloque de Progreso Diario -- Nivel y XP de
  // progreso siguen siendo reales, pero sin el texto explicativo "Te faltan
  // X XP..." de al lado (removido a propósito) ni el estado de check-in de
  // abajo (AsistenciaHoyStatus, ver el test más abajo).
  it('el widget circular muestra el nivel y el XP de progreso reales, sin el texto explicativo de al lado', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('N2')).toBeTruthy());
    expect(getByText('150/500')).toBeTruthy();
    expect(queryByText(/Te faltan/)).toBeNull();
  });

  // AsistenciaHoyStatus ("Esperando check-in...") se sacó de Inicio en el
  // rediseño -- sigue existiendo y probado en su propio
  // AsistenciaHoyStatus.test.tsx, esto solo confirma que ya NO vive acá.
  it('ya NO muestra el estado de check-in de hoy ("Esperando check-in...") -- se sacó de Inicio en el rediseño', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());
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

  // La reseña de Google se mudó a Mi Perfil (es una acción secundaria) --
  // Inicio queda reservado a lo operativo del día a día.
  it('ya NO muestra la tarjeta de reseña de Google -- se mudó a Mi Perfil', async () => {
    const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());
    expect(queryByText('¿Te gusta entrenar en GreenFit?')).toBeNull();
  });

  it('el ícono "¿Cómo ganar XP?" abre el modal con la única regla vigente (asistencia acreditada por el Admin)', async () => {
    const { getByText, getAllByLabelText, queryByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

    // Hay 2 en pantalla ahora (la tarjeta de perfil gamificada de arriba +
    // el widget de Progreso Diario) -- las dos abren el mismo modal
    // (mismo estado xpInfoVisible), así que alcanza con tocar cualquiera.
    fireEvent.press(getAllByLabelText('¿Cómo ganar XP?')[0]);

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
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

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
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  // TAREA 2: reincorporación del autoreporte "Hoy Entrené" con tope diario
  // real (disciplinas activas), conectado de punta a punta -- RPC real,
  // balance de XP en pantalla actualizado al instante, estado del botón
  // persistido.
  describe('botón "Hoy Entrené" (autoreporte con tope = disciplinas activas)', () => {
    it('sin ninguna disciplina activa (balances vacío, default), no muestra el botón', async () => {
      const { getByText, queryByText } = render(<HomeScreen navigation={navigation} />);
      await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());
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
      // 650 XP (mock del beforeEach) -> nivel 2, 150/500.
      await waitFor(() => expect(getByText('150/500')).toBeTruthy());

      fireEvent.press(getByText('💪 Hoy Entrené'));

      // 650 + 100 = 750 -> sigue nivel 2, 250/500 -- el ring se actualiza
      // solo con la respuesta del RPC, sin volver a llamar fetchTotalXp.
      await waitFor(() => expect(getByText('250/500')).toBeTruthy());
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
    (fetchClasesDelMes as jest.Mock).mockResolvedValue(0);
    (fetchMiembroDesde as jest.Mock).mockResolvedValue(null);
    (fetchFechasAsistencia as jest.Mock).mockResolvedValue([]);
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
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());
    expect(navigation.navigate).not.toHaveBeenCalledWith('PaymentWebView', expect.anything());
  });

  it('en nativo (Platform.OS !== web), ignora la URL aunque window exista (no debería, pero por las dudas)', async () => {
    Platform.OS = 'ios';
    (global as any).window = {
      location: { href: 'https://app.greenfit.test/?status=approved', pathname: '/' },
      history: { replaceState: jest.fn() },
    };

    const { getByText } = render(<HomeScreen navigation={navigation} />);
    await waitFor(() => expect(getByText('Progreso Diario')).toBeTruthy());
    expect(navigation.navigate).not.toHaveBeenCalledWith('PaymentWebView', expect.anything());
  });
});
