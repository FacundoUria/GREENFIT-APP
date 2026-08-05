import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, AYER_STR, HOY_STR } from './support/fixtures';

// Cubre el checklist de "Progreso Diario" (widget de XP en Home): el botón
// "¡Hoy entrené!" debe (a) sumar +100 XP al contador EN EL MISMO RENDER, sin
// recargar la pantalla, cuando todavía no se reclamó hoy, y (b) si ya se
// reclamó (al cargar la pantalla, o en un segundo intento en la misma
// sesión), quedar en estado "ya registrado" y avisar con un mensaje claro
// en vez de quedar mudo o volver a acreditar puntos.
test.describe('PWA -- Progreso Diario (reclamo de XP diario)', () => {
  test('al presionar "¡Hoy entrené!" sin haber reclamado hoy, suma +100 XP al contador al instante (sin recargar)', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        // Sin fila de HOY a propósito -- el check-in todavía no se hizo.
        // 450 XP (ayer) -> NIVEL 1, 450/500, faltan 50.
        xp_events: [
          { id: 'xp-ayer', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 450, event_date: AYER_STR, reference_id: null },
        ],
      },
    });

    await expect(page.getByText('N1')).toBeVisible();
    await expect(page.getByText('450/500')).toBeVisible();
    await expect(page.getByText('50 XP')).toBeVisible();

    await page.getByText('¡Hoy entrené! (+100 XP)', { exact: true }).click();

    // 450 + 100 = 550 XP -> sube a NIVEL 2, 50/500, faltan 450 -- todo en el
    // mismo render, sin recargar la página ni volver a foco.
    await expect(page.getByText('Entrenamiento de hoy ya registrado')).toBeVisible();
    await expect(page.getByText('N2')).toBeVisible();
    await expect(page.getByText('50/500')).toBeVisible();
    await expect(page.getByText('450 XP')).toBeVisible();
  });

  test('si ya se reclamó hoy, el botón arranca en estado registrado y un segundo intento muestra el aviso sin duplicar el XP', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        // Ya hay un evento de HOY -- el check-in de hoy ya se hizo (desde
        // el Admin, o desde este mismo botón en otra pestaña).
        xp_events: [
          { id: 'xp-hoy', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 100, event_date: HOY_STR, reference_id: null },
        ],
      },
    });

    const boton = page.getByText('Entrenamiento de hoy ya registrado', { exact: true });
    await expect(boton).toBeVisible();
    await expect(page.getByText('¡Hoy entrené! (+100 XP)')).toHaveCount(0);
    await expect(page.getByText('N1')).toBeVisible();
    await expect(page.getByText('100/500')).toBeVisible();

    // Un segundo intento (el botón sigue siendo tocable a propósito, no
    // queda `disabled` mudo) muestra el aviso claro en vez de no hacer nada.
    await boton.click();
    await expect(page.getByText(/ya fueron otorgados/)).toBeVisible();

    // Ningún XP de más -- sigue en 100/500, no 200/500.
    await expect(page.getByText('100/500')).toBeVisible();
  });
});
