import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, CLASE_HOY, CLASE_APARATOS_HOY, DISCIPLINA_CROSSFIT, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Cubre el checklist de Agenda: tarjetas de clases con el estilo renovado
// (verde flúor / badge "Disponible") y la ausencia del botón flotante "+"
// (se sacó de acá -- ahora es exclusivo de Comunidad).
test.describe('PWA -- Mi Agenda', () => {
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
});
