import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, DISCIPLINA_CROSSFIT, DISCIPLINA_APARATOS } from './support/fixtures';

// Checklist "Dinamismo total de packs y precios desde el Admin": "Elegí tu
// pack" tiene que mostrar EXACTAMENTE lo que hay en `packs` -- sin nada
// hardcodeado. Si Seba crea/edita un pack desde Configuración > Planes y
// Precios (PAGINA SUPABASE, otro repo), esto es lo que confirma que la PWA
// lo refleja tal cual, apenas se abre el modal.
const PACK_CROSSFIT = {
  id: 'pack-crossfit-12',
  name: 'Pack 12 clases CrossFit',
  credits: 12,
  duration_days: null,
  price: 30000,
  is_active: true,
  discipline: DISCIPLINA_CROSSFIT,
};

const PACK_APARATOS = {
  id: 'pack-aparatos-mes',
  name: 'Mes libre Aparatos',
  credits: null,
  duration_days: 30,
  price: 21000,
  is_active: true,
  discipline: DISCIPLINA_APARATOS,
};

// El botón "Renovar" (que abre "Elegí tu pack") solo aparece si alguna
// disciplina está vencida -- se fuerza con un balance de CrossFit en 0.
const BALANCE_VENCIDO = {
  id: 'uc-vencido',
  user_id: SOCIO_DEMO.id,
  remaining_credits: 0,
  expires_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  discipline: DISCIPLINA_CROSSFIT,
  pack: null,
};

test.describe('PWA -- Elegí tu pack (packs dinámicos desde el Admin)', () => {
  test('muestra los packs reales de `packs`, con precio/créditos/días exactos -- nada hardcodeado', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_VENCIDO], packs: [PACK_CROSSFIT, PACK_APARATOS] },
    });

    await page.getByText('Renovar').click();
    await expect(page.getByText('Elegí tu pack')).toBeVisible();

    await expect(page.getByText('Pack 12 clases CrossFit')).toBeVisible();
    await expect(page.getByText('CrossFit · 12 créditos')).toBeVisible();
    await expect(page.getByText('$ 30.000', { exact: false })).toBeVisible();

    await expect(page.getByText('Mes libre Aparatos')).toBeVisible();
    await expect(page.getByText('Aparatos · 30 días')).toBeVisible();
    await expect(page.getByText('$ 21.000', { exact: false })).toBeVisible();
  });

  test('un pack nuevo (recién creado en el Admin) aparece con solo recargar -- sin nada hardcodeado que actualizar en la PWA', async ({
    page,
  }) => {
    const packNuevo = {
      id: 'pack-6-crossfit',
      name: 'Pack 6 clases CrossFit',
      credits: 6,
      duration_days: null,
      price: 10000,
      is_active: true,
      discipline: DISCIPLINA_CROSSFIT,
    };
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_VENCIDO], packs: [packNuevo] },
    });

    await page.getByText('Renovar').click();
    await expect(page.getByText('Pack 6 clases CrossFit')).toBeVisible();
    await expect(page.getByText('CrossFit · 6 créditos')).toBeVisible();
  });

  test('sin ningún pack cargado, muestra el mensaje de "no hay packs" en vez de una lista vacía muda', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_VENCIDO], packs: [] },
    });

    await page.getByText('Renovar').click();
    await expect(page.getByText('No hay packs disponibles todavía.')).toBeVisible();
  });

  // Bug crítico (2026-08-07): "React Native WebView does not support this
  // platform" al tocar un pack en Web -- react-native-webview no soporta ese
  // entorno, así que ahí PaymentWebViewScreen redirige la pestaña entera
  // (window.location.href) en vez de embeber un WebView. `mercadopago.com.ar`
  // se intercepta para no navegar de verdad a internet -- lo que se prueba
  // es que la redirección se dispara con la URL real de la preferencia, sin
  // que aparezca ningún error de plataforma en el camino.
  test('tocar un pack en Web redirige la pestaña entera al Checkout de Mercado Pago -- sin el crash de WebView', async ({
    page,
  }) => {
    await page.route('https://www.mercadopago.com.ar/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Checkout Mercado Pago (mock)</body></html>' })
    );

    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_VENCIDO], packs: [PACK_CROSSFIT] },
    });

    await page.getByText('Renovar').click();
    await page.getByText('Pack 12 clases CrossFit').click();

    await page.waitForURL(/mercadopago\.com\.ar/, { timeout: 15_000 });
    await expect(page.getByText('Checkout Mercado Pago (mock)')).toBeVisible();
    await expect(page.getByText('does not support this platform')).toHaveCount(0);
  });
});
