import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, AYER_STR } from './support/fixtures';

// Cubre el checklist de Home: widget "Progreso Diario" (anillo de XP +
// "¡Hoy entrené!" + reglas), y la ausencia de la vieja tarjeta "Mi Pase".
test.describe('PWA -- Home / Dashboard', () => {
  test('muestra el widget Progreso Diario y NO la tarjeta "Mi Pase / Comprar"', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    await expect(page.getByText('Progreso Diario')).toBeVisible();
    await expect(page.getByText('N3')).toBeVisible(); // 1150 XP -> NIVEL 3

    await expect(page.getByText('Mi Pase')).toHaveCount(0);
    await expect(page.getByText('Comprar')).toHaveCount(0);
  });

  test('el botón "¡Hoy entrené!" otorga +100 XP y pasa a estado registrado', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        // Sin fila de HOY a propósito -- el check-in todavía no se hizo.
        xp_events: [
          { id: 'xp-ayer', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 450, event_date: AYER_STR, reference_id: null },
        ],
      },
    });

    const boton = page.getByText('¡Hoy entrené! (+100 XP)', { exact: true });
    await expect(boton).toBeVisible();

    await boton.click();

    await expect(page.getByText('Entrenamiento de hoy ya registrado')).toBeVisible();
  });

  test('el ícono de reglas de XP abre el modal', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    await page.getByLabel('¿Cómo ganar XP?').click();

    await expect(page.getByText('¿Cómo ganar XP?')).toBeVisible();
    await expect(page.getByText('Asistencia diaria / ¡Hoy entrené!')).toBeVisible();
  });
});
