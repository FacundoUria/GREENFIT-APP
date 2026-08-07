import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, AYER_STR, HOY_STR } from './support/fixtures';

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

  // Regla de oro: los +100 XP diarios SOLO los acredita el Admin (Check-in
  // Rápido, o la asistencia confirmada de una clase reservada) -- el socio
  // ya no tiene ningún botón para autoreportarse. El widget de "Progreso
  // Diario" es de solo lectura, refleja lo que ya haya acreditado el Admin.
  test('sin check-in del Admin hoy, el widget muestra el estado neutro (sin ninguna acción para autoreportarse)', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        // Sin fila de HOY a propósito -- el Admin todavía no dio el check-in.
        xp_events: [
          { id: 'xp-ayer', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 450, event_date: AYER_STR, reference_id: null },
        ],
      },
    });

    await expect(page.getByText('Todavía no registraste tu entrada hoy')).toBeVisible();
    // El viejo botón autoreportable no existe en ningún lado de la pantalla.
    await expect(page.getByText('¡Hoy entrené!', { exact: false })).toHaveCount(0);
  });

  test('si el Admin ya acreditó la asistencia de hoy, el widget la muestra en verde apenas se carga la pantalla', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        xp_events: [
          { id: 'xp-hoy', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 100, event_date: HOY_STR, reference_id: null },
        ],
      },
    });

    await expect(page.getByText('Entrenamiento de hoy ya registrado')).toBeVisible();
  });

  test('el ícono de reglas de XP abre el modal con la única regla vigente', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    await page.getByLabel('¿Cómo ganar XP?').first().click();

    await expect(page.getByText('¿Cómo ganar XP?')).toBeVisible();
    await expect(page.getByText('Asistencia diaria', { exact: true })).toBeVisible();
    await expect(page.getByText(/Acreditados presencialmente al realizar tu check-in en el gimnasio/)).toBeVisible();
    await expect(page.getByText('Publicar en la Comunidad')).toHaveCount(0);
    await expect(page.getByText('Superar un Récord Personal (PR)')).toHaveCount(0);
    await expect(page.getByText('Completar una Meta Personal')).toHaveCount(0);
  });

  // Tarjeta de perfil gamificada -- vivía SOLO en Mi Perfil, ahora también
  // arriba de todo en Inicio (debajo del saludo), con los mismos datos
  // reales (racha=2, clases del mes=2, 1150 XP -> NIVEL 3).
  test('muestra la tarjeta de perfil gamificada debajo del saludo, con nivel/racha/clases reales', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    const saludo = page.getByText(/^Hola, /);
    await expect(saludo).toBeVisible();

    await expect(page.getByText('NIVEL 3')).toBeVisible();
    await expect(page.getByTestId('stat-racha')).toHaveText('2');
    await expect(page.getByTestId('stat-clases')).toHaveText('2');

    // Está debajo del saludo (no en cualquier lugar de la pantalla) --
    // confirma la jerarquía pedida, no solo que el dato exista en algún lado.
    const saludoBox = await saludo.boundingBox();
    const nivelBox = await page.getByText('NIVEL 3').boundingBox();
    expect(saludoBox!.y).toBeLessThan(nivelBox!.y);
  });

  // "Dejanos tu reseña en Google" -- abre la ficha real de Maps en una
  // pestaña nueva. Se verifica la URL exacta que el .env trae por defecto.
  test('la tarjeta de reseña de Google abre la ficha real de Maps en una pestaña nueva', async ({ page, context }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.getByLabel('Dejanos tu reseña en Google').click(),
    ]);
    await popup.waitForLoadState('domcontentloaded').catch(() => {
      // La URL es externa de verdad (maps.google.com) -- en el sandbox de
      // CI puede no resolver DNS; lo que importa acá es que SE INTENTÓ
      // abrir la URL correcta, no que la página externa cargue completa.
    });
    expect(popup.url()).toContain('google.com/maps/place/GREEN+FIT');
  });
});
