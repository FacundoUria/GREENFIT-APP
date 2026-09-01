import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, CLASE_HOY, CLASE_APARATOS_HOY, DISCIPLINA_CROSSFIT, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Cubre el checklist de Agenda: tarjetas de clases con el estilo renovado
// (verde flúor / badge "Disponible") y la ausencia del botón flotante "+"
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
            expires_at: null,
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
    await expect(tarjetaClase.getByText('Disponible')).toBeVisible();

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
            expires_at: null,
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
            expires_at: null,
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
    await expect(page.getByTestId('agenda-card-class-crossfit-hoy').getByText('Disponible')).toBeVisible();
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
          expires_at: null,
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

    await page.getByText('Confirmar', { exact: true }).click();

    await expect(page.getByText('¡Reserva confirmada!')).toBeVisible();
    await page.getByText('Listo').click();
    await expect(page.getByTestId('agenda-card-class-crossfit-hoy').getByText('Reservada')).toBeVisible();
  });
});
