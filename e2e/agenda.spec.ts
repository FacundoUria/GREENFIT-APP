import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, CLASE_HOY, CLASE_APARATOS_HOY, DISCIPLINA_CROSSFIT, HOY_STR, EN_30_DIAS } from './support/fixtures';
import { irATab } from './support/nav';

// Texto corto de reafirmación de salud (BookingConfirmModal) -- exacto,
// mismo string que CONSENT_TEXT_SHORT en src/lib/consentApi.ts (duplicado a
// mano: esta suite nunca importa de src/, ver fixtures.ts).
const REAFIRMACION_SALUD =
  'Declaro que mi estado de salud no ha cambiado desde mi última declaración y que me encuentro en condiciones de realizar la actividad.';

// Cubre el checklist de Agenda: tarjetas de clases con el estilo renovado
// (pill decorativo "Reservar" dentro de la tarjeta tocable) y la ausencia del botón flotante "+"
// (se sacó de acá -- ahora es exclusivo de Comunidad).
test.describe('PWA -- Mi Agenda', () => {
  // Reloj congelado a las 08:00 de HOY (mismo día real que HOY_STR, solo
  // fijamos la hora): CLASE_HOY es a las 19:00 -- item 4 del ticket
  // ("ocultar clases de HOY cuyo horario de inicio ya pasó", ver
  // classesApi.ts) la escondería si esta suite corriera de noche, después
  // de las 19:00, rompiendo estos tests sin que el producto tenga ningún
  // bug real. Se instala ANTES de cualquier navegación para que la app
  // arranque ya con esta hora.
  test.beforeEach(async ({ page }) => {
    const hoyALasOcho = new Date();
    hoyALasOcho.setHours(8, 0, 0, 0);
    await page.clock.install({ time: hoyALasOcho });
  });

  test('muestra las tarjetas de clases del día y NO tiene el botón flotante "+"', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY],
        user_credits: [
          {
            id: 'uc-1',
            user_id: SOCIO_DEMO.id,
            remaining_credits: 5,
            expires_at: EN_30_DIAS,
            created_at: '2026-08-01T00:00:00.000Z',
            discipline: DISCIPLINA_CROSSFIT,
            pack: null,
          },
        ],
      },
    });

    await irATab(page, 'Agenda');

    await expect(page.getByText('Mi Agenda')).toBeVisible();
    // Scopeada por testID: Home (todavía montado de fondo) también muestra
    // "CrossFit" en su Hero Card a partir del mismo fixture de user_credits.
    const tarjetaClase = page.getByTestId('agenda-card-class-crossfit-hoy');
    await expect(tarjetaClase.getByText('CrossFit')).toBeVisible();
    await expect(tarjetaClase.getByText('Reservar', { exact: true })).toBeVisible();

    // El FAB de Agenda ("Volver a hoy") se sacó -- y el de Comunidad
    // ("Nueva publicación") nunca debería aparecer acá.
    await expect(page.getByLabel('Volver a hoy')).toHaveCount(0);
    await expect(page.getByLabel('Nueva publicación')).toHaveCount(0);
  });

  // Checklist punto 2: una disciplina con el switch "Mostrar en la Agenda de
  // reservas de la PWA" desactivado en el Admin (show_in_agenda=false, ej.
  // Aparatos/pase libre) no debe listar sus franjas horarias acá, aunque
  // tenga clases/franjas reales cargadas para ese día.
  test('una disciplina con show_in_agenda=false (pase libre) no aparece en la Agenda', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY, CLASE_APARATOS_HOY],
        user_credits: [
          {
            id: 'uc-1',
            user_id: SOCIO_DEMO.id,
            remaining_credits: 5,
            expires_at: EN_30_DIAS,
            created_at: '2026-08-01T00:00:00.000Z',
            discipline: DISCIPLINA_CROSSFIT,
            pack: null,
          },
        ],
      },
    });

    await irATab(page, 'Agenda');

    await expect(page.getByTestId('agenda-card-class-crossfit-hoy')).toBeVisible();
    await expect(page.getByTestId('agenda-card-class-aparatos-hoy')).toHaveCount(0);
    await expect(page.getByText('Aparatos libre')).toHaveCount(0);
  });

  // Pedido del cliente: ver cuánta gente está anotada en un turno antes de
  // reservar. CLASE_HOY tiene capacity=12 (ver support/fixtures.ts); acá se
  // cargan 3 reservas reales de OTROS socios para esa clase+fecha y se
  // verifica que la tarjeta muestre "3/12 cupos" -- el mismo COUNT real que
  // ejercitan los tests de bookedCount en classesApi.test.ts, acá de punta a
  // punta contra la UI.
  test('muestra la cantidad de inscriptos ("X/Y cupos") contando las reservas activas reales de esa clase', async ({
    page,
  }) => {
    const reservasDeOtrosSocios = [
      { id: 'bk-1', user_id: 'otro-socio-1', class_id: CLASE_HOY.id, booking_date: HOY_STR },
      { id: 'bk-2', user_id: 'otro-socio-2', class_id: CLASE_HOY.id, booking_date: HOY_STR },
      { id: 'bk-3', user_id: 'otro-socio-3', class_id: CLASE_HOY.id, booking_date: HOY_STR },
    ];
    await loginComoSocio(page, {
      tables: { ...tablasBase(), classes: [CLASE_HOY], bookings: reservasDeOtrosSocios },
    });

    await irATab(page, 'Agenda');

    const tarjetaClase = page.getByTestId('agenda-card-class-crossfit-hoy');
    await expect(tarjetaClase.getByText('3/12 cupos')).toBeVisible();
  });

  // Item 2 del ticket ("evitar accidentes"): tocar una clase disponible ya
  // NO reserva directo (one-tap) -- abre un modal de confirmación primero.
  // book_class recién se llama al tocar "Confirmar" ahí adentro.
  test('tocar una clase disponible pide confirmación antes de reservar -- cancelar el modal NO reserva', async ({
    page,
  }) => {
    let bookClassLlamado = false;
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY],
        user_credits: [
          {
            id: 'uc-1',
            user_id: SOCIO_DEMO.id,
            remaining_credits: 5,
            expires_at: EN_30_DIAS,
            created_at: '2026-08-01T00:00:00.000Z',
            discipline: DISCIPLINA_CROSSFIT,
            pack: null,
          },
        ],
      },
      rpc: { book_class: () => ((bookClassLlamado = true), 'e2e-booking-id') },
    });

    await irATab(page, 'Agenda');
    await page.getByTestId('agenda-card-class-crossfit-hoy').click();

    await expect(page.getByText('Reservar CrossFit')).toBeVisible();
    await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toBeVisible();

    await page.getByText('Cancelar', { exact: true }).click();
    await expect(page.getByText('Reservar CrossFit')).toHaveCount(0);
    expect(bookClassLlamado).toBe(false);
    await expect(page.getByTestId('agenda-card-class-crossfit-hoy').getByText('Reservar', { exact: true })).toBeVisible();
  });

  // Rediseño: el pill "Reservar" es PURAMENTE decorativo -- tocar justo
  // encima de él (en un navegador real) hace exactamente lo mismo que tocar
  // cualquier otra parte de la tarjeta: abre la confirmación, no reserva directo.
  test('tocar encima del pill "Reservar" hace lo mismo que tocar la tarjeta (no es un botón aparte)', async ({ page }) => {
    let bookClassLlamado = false;
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY],
        user_credits: [
          {
            id: 'uc-1',
            user_id: SOCIO_DEMO.id,
            remaining_credits: 5,
            expires_at: EN_30_DIAS,
            created_at: '2026-08-01T00:00:00.000Z',
            discipline: DISCIPLINA_CROSSFIT,
            pack: null,
          },
        ],
      },
      rpc: { book_class: () => ((bookClassLlamado = true), 'e2e-booking-id') },
    });

    await irATab(page, 'Agenda');
    // Clic REAL del mouse en las coordenadas del pill (no locator.click():
    // Playwright se niega a clickear un elemento con pointer-events: none,
    // que es justamente lo que hace que el toque le llegue a la tarjeta).
    const pill = page.getByTestId('agenda-card-class-crossfit-hoy').getByText('Reservar', { exact: true });
    await expect(pill).toBeVisible();
    const caja = await pill.boundingBox();
    if (!caja) throw new Error('el pill no tiene caja visible');
    // Lo que el navegador tiene justo debajo de ese punto es la tarjeta, no el pill.
    const debajo = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      [caja.x + caja.width / 2, caja.y + caja.height / 2]
    );
    expect(debajo).toBe('agenda-card-class-crossfit-hoy');
    await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);

    await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toBeVisible();
    expect(bookClassLlamado).toBe(false);
  });

  // Mismo flujo, pero confirmando: book_class se llama, el badge pasa a
  // "Reservada" y aparece el modal gamificado de reserva confirmada.
  test('confirmar el modal reserva de verdad -- llama a book_class y la tarjeta pasa a "Reservada"', async ({
    page,
  }) => {
    const tables = {
      ...tablasBase(),
      classes: [CLASE_HOY],
      user_credits: [
        {
          id: 'uc-1',
          user_id: SOCIO_DEMO.id,
          remaining_credits: 5,
          expires_at: EN_30_DIAS,
          created_at: '2026-08-01T00:00:00.000Z',
          discipline: DISCIPLINA_CROSSFIT,
          pack: null,
        },
      ],
      bookings: [] as any[],
    };
    await loginComoSocio(page, {
      tables,
      rpc: {
        // El RPC real inserta la fila en `bookings` -- se simula lo mismo
        // acá para que el siguiente `load()` (loadAgendaClasses) ya vea la
        // reserva y la tarjeta refleje "Reservada" de verdad, no un estado
        // optimista falso.
        book_class: () => {
          tables.bookings.push({ id: 'bk-e2e', user_id: SOCIO_DEMO.id, class_id: CLASE_HOY.id, booking_date: HOY_STR });
          return 'e2e-booking-id';
        },
      },
    });

    await irATab(page, 'Agenda');
    await page.getByTestId('agenda-card-class-crossfit-hoy').click();
    await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toBeVisible();

    // Reafirmación corta de salud (segundo gate, coexiste con el
    // consentimiento informado completo -- ver ConsentModal.tsx): se pide
    // SIEMPRE, "Confirmar" no habilita hasta marcarla.
    await page.getByText(REAFIRMACION_SALUD).click();
    await page.getByText('Confirmar', { exact: true }).click();

    await expect(page.getByText('¡Reserva confirmada!')).toBeVisible();
    await page.getByText('Listo').click();
    await expect(page.getByTestId('agenda-card-class-crossfit-hoy').getByText('Reservada')).toBeVisible();
  });

  // Gate nuevo, aparte del de "perfil obligatorio" (perfil-obligatorio.spec.ts,
  // que bloquea la pestaña Perfil entera y no se toca acá): sin nombre Y
  // teléfono de contacto de emergencia, no se deja avanzar a reservar.
  // `emergencyContactName: null` a propósito (no domicilio/phone) -- deja
  // el resto del perfil "completo" para aislar ESTE gate del otro.
  test.describe('gate de contacto de emergencia (nombre + teléfono)', () => {
    test('sin el nombre del contacto de emergencia cargado, tocar una clase disponible bloquea con un mensaje claro -- NO reserva', async ({
      page,
    }) => {
      let bookClassLlamado = false;
      await loginComoSocio(page, {
        user: { ...SOCIO_DEMO, emergencyContactName: null },
        tables: {
          ...tablasBase(),
          classes: [CLASE_HOY],
          user_credits: [
            {
              id: 'uc-1',
              user_id: SOCIO_DEMO.id,
              remaining_credits: 5,
              expires_at: EN_30_DIAS,
              created_at: '2026-08-01T00:00:00.000Z',
              discipline: DISCIPLINA_CROSSFIT,
              pack: null,
            },
          ],
        },
        rpc: { book_class: () => ((bookClassLlamado = true), 'e2e-booking-id') },
      });

      await irATab(page, 'Agenda');
      await page.getByTestId('agenda-card-class-crossfit-hoy').click();

      await expect(page.getByText('Completá tu contacto de emergencia')).toBeVisible();
      await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toHaveCount(0);
      expect(bookClassLlamado).toBe(false);
    });

    test('tocar "Completar mis datos" lleva directo a "Mis datos" (Perfil), donde puede cargar el contacto', async ({
      page,
    }) => {
      await loginComoSocio(page, {
        user: { ...SOCIO_DEMO, emergencyContactName: null },
        tables: {
          ...tablasBase(),
          classes: [CLASE_HOY],
          user_credits: [
            {
              id: 'uc-1',
              user_id: SOCIO_DEMO.id,
              remaining_credits: 5,
              expires_at: EN_30_DIAS,
              created_at: '2026-08-01T00:00:00.000Z',
              discipline: DISCIPLINA_CROSSFIT,
              pack: null,
            },
          ],
        },
      });

      await irATab(page, 'Agenda');
      await page.getByTestId('agenda-card-class-crossfit-hoy').click();
      await expect(page.getByText('Completá tu contacto de emergencia')).toBeVisible();

      await page.getByText('Completar mis datos', { exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Mis datos' })).toBeVisible();
      await expect(page.getByText('Nombre del contacto')).toBeVisible();
    });
  });

  // Segundo gate de reserva, coexiste con el de contacto de emergencia de
  // arriba (no se toca) -- ver ConsentModal.tsx / consentApi.ts.
  // `consentimientos_socio: []` a propósito para simular un socio sin
  // ninguna aceptación (tablasBase() lo deja vigente por defecto).
  test.describe('gate de consentimiento informado / declaración de salud', () => {
    function tablasSinConsentimiento() {
      return {
        ...tablasBase(),
        consentimientos_socio: [] as any[],
        classes: [CLASE_HOY],
        user_credits: [
          {
            id: 'uc-1',
            user_id: SOCIO_DEMO.id,
            remaining_credits: 5,
            expires_at: EN_30_DIAS,
            created_at: '2026-08-01T00:00:00.000Z',
            discipline: DISCIPLINA_CROSSFIT,
            pack: null,
          },
        ],
      };
    }

    test('socio sin ninguna aceptación: al reservar ve la pantalla completa del consentimiento, ANTES de BookingConfirmModal', async ({
      page,
    }) => {
      await loginComoSocio(page, { tables: tablasSinConsentimiento() });

      await irATab(page, 'Agenda');
      await page.getByTestId('agenda-card-class-crossfit-hoy').click();

      await expect(
        page.getByText('Declaración de salud y consentimiento para realizar actividad física')
      ).toBeVisible();
      await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toHaveCount(0);
    });

    test('"No acepto" no deja avanzar -- "Continuar" queda deshabilitado', async ({ page }) => {
      await loginComoSocio(page, { tables: tablasSinConsentimiento() });

      await irATab(page, 'Agenda');
      await page.getByTestId('agenda-card-class-crossfit-hoy').click();
      await expect(
        page.getByText('Declaración de salud y consentimiento para realizar actividad física')
      ).toBeVisible();

      await page.getByText('No acepto.', { exact: true }).click();
      await page.getByText('Continuar', { exact: true }).click();

      await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toHaveCount(0);
    });

    test('aceptar la declaración completa registra el consentimiento y sigue derecho a BookingConfirmModal, sin volver a tocar la tarjeta', async ({
      page,
    }) => {
      await loginComoSocio(page, { tables: tablasSinConsentimiento() });

      await irATab(page, 'Agenda');
      await page.getByTestId('agenda-card-class-crossfit-hoy').click();
      await expect(
        page.getByText('Declaración de salud y consentimiento para realizar actividad física')
      ).toBeVisible();

      await page
        .getByText(
          'Acepto la declaración de salud, el consentimiento informado y las condiciones de participación.',
          { exact: true }
        )
        .click();
      await page.getByText('Continuar', { exact: true }).click();

      // Directo a BookingConfirmModal -- no hace falta volver a tocar la tarjeta.
      await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toBeVisible();
    });
  });
});

// Bug real (2026-10-01): viendo HOY con cupos reales, tocar "mañana" y volver
// a HOY dejaba los cupos de HOY en 0 (y "Reservar" reservaba la clase de
// mañana). Causa: carrera entre respuestas -- la de "mañana" llegaba después
// que la de "hoy" y pisaba la lista. Acá se fuerza ese orden demorando SOLO
// el conteo de cupos del día de mañana.
test.describe('PWA -- Mi Agenda: cambio de día', () => {
  const manana = new Date(Date.now() + 86_400_000);
  const MANANA_STR = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`;
  // Se dicta todos los días: existe hoy y mañana.
  const CLASE_DIARIA = { ...CLASE_HOY, id: 'class-diaria', days_of_week: [0, 1, 2, 3, 4, 5, 6] };
  // 4 anotados HOY, nadie mañana.
  const ANOTADOS_HOY = ['a', 'b', 'c', 'd'].map((u) => ({
    id: `b-${u}`,
    user_id: `otro-${u}`,
    class_id: CLASE_DIARIA.id,
    booking_date: HOY_STR,
  }));
  const CREDITOS = [
    {
      id: 'uc-1',
      user_id: SOCIO_DEMO.id,
      remaining_credits: 5,
      expires_at: EN_30_DIAS,
      created_at: '2026-08-01T00:00:00.000Z',
      discipline: DISCIPLINA_CROSSFIT,
      pack: null,
    },
  ];
  const chipDia = (page: any, indice: number) =>
    page
      .locator('[role="button"]')
      .filter({ hasText: /^(hoy|dom|lun|mar|mié|jue|vie|sáb)\s*\d+$/i })
      .nth(indice);

  test.beforeEach(async ({ page }) => {
    const hoyALasOcho = new Date();
    hoyALasOcho.setHours(8, 0, 0, 0);
    await page.clock.install({ time: hoyALasOcho });
  });

  test('una respuesta atrasada de "mañana" no pisa los cupos de HOY, y al cambiar de día no quedan tarjetas viejas', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), classes: [CLASE_DIARIA], bookings: ANOTADOS_HOY, user_credits: CREDITOS },
    });
    await irATab(page, 'Agenda');
    const tarjeta = page.getByTestId('agenda-card-class-diaria');
    await expect(tarjeta.getByText(/4\/12 cupos/)).toBeVisible();

    // A partir de acá, el conteo de cupos de MAÑANA tarda 3 s en responder.
    let respondioManana = false;
    await page.route(
      (url) => url.pathname.endsWith('/rpc/get_bookings_count_por_clase'),
      async (route) => {
        if (route.request().postDataJSON()?.p_booking_date === MANANA_STR) {
          await new Promise((r) => setTimeout(r, 3000));
          respondioManana = true;
        }
        await route.fallback();
      }
    );

    await chipDia(page, 1).click();
    // Mientras carga el día nuevo NO se ve la tarjeta del día anterior.
    await expect(tarjeta).toHaveCount(0);

    await chipDia(page, 0).click(); // vuelve a HOY antes de que responda mañana
    await expect(tarjeta.getByText(/4\/12 cupos/)).toBeVisible();

    // Llega (tarde) la respuesta de mañana: HOY tiene que seguir con sus cupos reales.
    await expect.poll(() => respondioManana, { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(1000);
    await expect(tarjeta.getByText(/4\/12 cupos/)).toBeVisible();
    await expect(tarjeta.getByText(/0\/12 cupos/)).toHaveCount(0);
  });

  test('el modal de confirmación muestra la fecha de la clase, no solo la hora', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), classes: [CLASE_DIARIA], bookings: ANOTADOS_HOY, user_credits: CREDITOS },
    });
    await irATab(page, 'Agenda');

    await page.getByTestId('agenda-card-class-diaria').click();
    await expect(page.getByText('¿Confirmás tu lugar en esta clase?')).toBeVisible();
    await expect(page.getByText(/^Hoy, (domingo|lunes|martes|miércoles|jueves|viernes|sábado) \d{1,2} de /)).toBeVisible();
    await page.getByText('Cancelar', { exact: true }).click();

    // En otro día, la fecha del modal es la de ESE día.
    await chipDia(page, 1).click();
    await expect(page.getByTestId('agenda-card-class-diaria').getByText(/0\/12 cupos/)).toBeVisible();
    await page.getByTestId('agenda-card-class-diaria').click();
    await expect(page.getByText(/^Mañana, (domingo|lunes|martes|miércoles|jueves|viernes|sábado) \d{1,2} de /)).toBeVisible();
  });
  test('el modal de cancelar muestra la fecha de la reserva que se cancela (la de la tarjeta)', async ({ page }) => {
    // El socio tiene reservada la clase de MAÑANA.
    const miReserva = { id: 'mia', user_id: SOCIO_DEMO.id, class_id: CLASE_DIARIA.id, booking_date: MANANA_STR };
    await loginComoSocio(page, {
      tables: { ...tablasBase(), classes: [CLASE_DIARIA], bookings: [...ANOTADOS_HOY, miReserva], user_credits: CREDITOS },
    });
    await irATab(page, 'Agenda');
    await chipDia(page, 1).click();

    const tarjeta = page.getByTestId('agenda-card-class-diaria');
    await expect(tarjeta.getByText('Reservada', { exact: true })).toBeVisible();
    await tarjeta.click();

    await expect(page.getByText('Cancelar CrossFit')).toBeVisible();
    await expect(page.getByText(/^Mañana, (domingo|lunes|martes|miércoles|jueves|viernes|sábado) \d{1,2} de /)).toBeVisible();
  });
});
