import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, CLASE_HOY, CLASE_APARATOS_HOY, DISCIPLINA_CROSSFIT } from './support/fixtures';
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
});
