import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase } from './support/fixtures';
import { irATab } from './support/nav';

// Cubre el checklist de Perfil: avatar sincronizado, racha/"Clases (mes)"
// reales y el botón sutil de Logout.
test.describe('PWA -- Mi Perfil', () => {
  test('muestra avatar real, nivel/racha/clases calculados sobre XP real', async ({ page }) => {
    const avatarUrl = 'https://e2e-mock.supabase.co/storage/v1/object/public/avatars/e2e/avatar.jpg';
    await loginComoSocio(page, {
      user: { ...SOCIO_DEMO, avatarUrl },
      tables: tablasBase(),
    });

    await irATab(page, 'Perfil');
    await expect(page.getByText('Mi Perfil')).toBeVisible();

    // Nivel real: 700 + 450 = 1150 XP -> NIVEL 3, 150/500 de progreso.
    // `.last()`: Inicio (montado de fondo) ahora tiene su PROPIA tarjeta de
    // perfil gamificada con los mismos datos/testIDs -- Perfil se montó
    // DESPUÉS (recién al navegar acá), así que es la última en el árbol.
    await expect(page.getByText('NIVEL 3').last()).toBeVisible();
    await expect(page.getByText('150 / 500 XP').last()).toBeVisible();

    // Avatar real (no el fallback de iniciales) -- sincronizado desde
    // profiles.avatar_url. React Native Web puede renderizar <Image> como
    // <img src> o como un <div> con background-image según la versión --
    // se busca la URL en cualquiera de las dos formas en vez de asumir una.
    // `.last()` (no `.first()`): Inicio también renderiza el mismo avatar
    // ahora (su propia tarjeta de perfil), pero montado de fondo/oculto --
    // el de Perfil, el que está realmente visible, es el último en el DOM.
    await expect(page.locator(`img[src*="avatar.jpg"], [style*="avatar.jpg"]`).last()).toBeVisible();
    // Y el fallback de iniciales ("FE") NO debe estar -- confirma que
    // realmente se está usando la foto, no cayendo al fallback por error.
    await expect(page.getByText('FE', { exact: true })).toHaveCount(0);

    // Racha (2 días consecutivos: hoy + ayer) y "Clases (mes)" (2 días
    // distintos con asistencia este mes) -- ya no un placeholder fijo.
    await expect(page.getByTestId('stat-racha').last()).toHaveText('2');
    await expect(page.getByTestId('stat-clases').last()).toHaveText('2');
  });

  test('el ícono "¿Cómo ganar XP?" abre el modal con la única regla vigente (asistencia acreditada por el Admin)', async ({
    page,
  }) => {
    await loginComoSocio(page, { tables: tablasBase() });
    await irATab(page, 'Perfil');
    await expect(page.getByText('Mi Perfil')).toBeVisible();

    // .last(): React Navigation mantiene Home (tab inicial) montado de
    // fondo -- Home también tiene su propio ícono "¿Cómo ganar XP?" en el
    // widget de Progreso Diario, así que hay 2 en el DOM. Perfil se montó
    // DESPUÉS (recién al navegar acá), por lo que es el último en el árbol.
    await page.getByLabel('¿Cómo ganar XP?').last().click();

    await expect(page.getByText('¿Cómo ganar XP?')).toBeVisible();
    await expect(page.getByText('Asistencia diaria', { exact: true })).toBeVisible();
    await expect(page.getByText(/Acreditados presencialmente al realizar tu check-in en el gimnasio/)).toBeVisible();
    // Publicar/PR/Metas dejaron de otorgar XP -- ya no se listan acá.
    await expect(page.getByText('Publicar en la Comunidad')).toHaveCount(0);
    await expect(page.getByText('Superar un Récord Personal (PR)')).toHaveCount(0);
    await expect(page.getByText('Completar una Meta Personal')).toHaveCount(0);
  });

  test('el botón sutil de Logout cierra la sesión y vuelve a Login', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });
    await irATab(page, 'Perfil');
    await expect(page.getByText('Mi Perfil')).toBeVisible();

    await page.getByLabel('Cerrar sesión').click();

    await expect(page.getByPlaceholder('DNI')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Ingresar', { exact: true })).toBeVisible();
  });

  // "Dejanos tu reseña en Google" -- se mudó acá desde Inicio en el
  // rediseño UX (acción secundaria, no algo operativo del día a día). Abre
  // la ficha real de Maps en una pestaña nueva; se verifica la URL exacta
  // que el .env trae por defecto.
  test('la tarjeta de reseña de Google abre la ficha real de Maps en una pestaña nueva', async ({ page, context }) => {
    await loginComoSocio(page, { tables: tablasBase() });
    await irATab(page, 'Perfil');
    await expect(page.getByText('Mi Perfil')).toBeVisible();

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
