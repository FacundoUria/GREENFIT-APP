import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase } from './support/fixtures';
import { irATab } from './support/nav';

// Cubre el checklist de "Perfil Mobile": en un viewport de celular real
// (no el Desktop Chrome default del resto de la suite) la tarjeta de
// Mi Perfil renderiza los stats, el nivel de XP y los assets visuales
// (avatar real + mascota) correctamente, sin overflow ni elementos rotos.
// Solo el `viewport` de devices['iPhone 13'] (no el preset completo -- ese
// fuerza WebKit como motor, que no está instalado en este entorno, solo
// Chromium) alcanza para probar el layout a un ancho de celular real.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.describe('PWA -- Mi Perfil (viewport mobile real)', () => {
  test('la tarjeta de perfil renderiza stats, nivel de XP y assets visuales en un viewport de celular', async ({
    page,
  }) => {
    const avatarUrl = 'https://e2e-mock.supabase.co/storage/v1/object/public/avatars/e2e/avatar.jpg';
    await loginComoSocio(page, { user: { ...SOCIO_DEMO, avatarUrl }, tables: tablasBase() });

    await irATab(page, 'Perfil');
    await expect(page.getByText('Mi Perfil')).toBeVisible();

    // Nivel + barra de XP (700 + 450 = 1150 XP -> NIVEL 3, 150/500). `.last()`
    // en todos estos: Inicio (montado de fondo) ahora tiene su PROPIA
    // tarjeta de perfil gamificada con los mismos datos/testIDs -- Perfil se
    // montó DESPUÉS (recién al navegar acá), así que es la última en el árbol.
    await expect(page.getByText('NIVEL 3').last()).toBeVisible();
    await expect(page.getByText('150 / 500 XP').last()).toBeVisible();

    // Stats reales (racha/clases del mes) -- visibles y sin recortarse
    // fuera de la pantalla en un viewport angosto de celular.
    await expect(page.getByTestId('stat-racha').last()).toHaveText('2');
    await expect(page.getByTestId('stat-clases').last()).toHaveText('2');
    await expect(page.getByTestId('stat-racha').last()).toBeInViewport();
    await expect(page.getByTestId('stat-clases').last()).toBeInViewport();

    // Avatar real del socio. `.last()`: Inicio (montado de fondo/oculto)
    // también tiene su propio avatar ahora -- el de Perfil, el visible, es
    // el último en el DOM.
    await expect(page.locator(`img[src*="avatar.jpg"], [style*="avatar.jpg"]`).last()).toBeVisible();

    // Asset visual de la mascota (Pitbull) -- presente y realmente
    // visible (no un <img> roto ni oculto detrás de otro elemento).
    await expect(page.getByLabel('Mascota GreenFit').last()).toBeVisible();
  });
});
