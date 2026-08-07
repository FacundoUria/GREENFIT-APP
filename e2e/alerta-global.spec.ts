import { test, expect } from '@playwright/test';
import { loginComoSocio } from './support/auth';
import { tablasBase } from './support/fixtures';

// "Alerta Global / Anuncio Flotante" -- activada desde Configuración en el
// Admin (alerta_app_activa/alerta_app_mensaje en `configuracion`), se lee acá
// vía ConfiguracionContext y se muestra como banner flotante al cargar Inicio.
test.describe('PWA -- Alerta Global (banner flotante de Inicio)', () => {
  test('si la alerta está activa, se muestra al cargar Inicio y se puede cerrar con la X', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        configuracion: [{ id: 1, alerta_app_activa: true, alerta_app_mensaje: 'El sábado cerramos a las 14 hs' }],
      },
    });

    await expect(page.getByText('El sábado cerramos a las 14 hs')).toBeVisible();

    await page.getByLabel('Cerrar aviso').click();
    await expect(page.getByText('El sábado cerramos a las 14 hs')).not.toBeVisible();
  });

  test('si la alerta está desactivada, no se muestra nada', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        configuracion: [{ id: 1, alerta_app_activa: false, alerta_app_mensaje: 'Mensaje viejo, ya no aplica' }],
      },
    });

    await expect(page.getByText('Mensaje viejo, ya no aplica')).toHaveCount(0);
  });

  test('sin fila de configuración (o campos todavía no migrados), Inicio funciona igual sin romperse', async ({
    page,
  }) => {
    await loginComoSocio(page, { tables: tablasBase() }); // tablasBase() no trae `configuracion`

    await expect(page.getByText(/^Hola, /)).toBeVisible();
    await expect(page.getByLabel('Cerrar aviso')).toHaveCount(0);
  });
});
