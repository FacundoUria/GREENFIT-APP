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
  price: 30000,
  is_active: true,
  incluye_aparatos: false,
  dias_vigencia: null,
  creditos: [{ discipline_id: DISCIPLINA_CROSSFIT.id, credits: 12 }],
};

const PACK_APARATOS = {
  id: 'pack-aparatos-mes',
  name: 'Mes libre Aparatos',
  price: 21000,
  is_active: true,
  incluye_aparatos: true,
  dias_vigencia: 30,
  creditos: [],
};

// El botón "Renovar" (que abre "Elegí tu pack") solo aparece si alguna
// disciplina está vencida -- se fuerza con un balance de CrossFit en 0.
// Sin nada vencido, el acceso es "Elegir mi pack"/"Agregar otro pack" (ver
// el describe de arriba, "Acceso para comprar").
const BALANCE_VENCIDO = {
  id: 'uc-vencido',
  user_id: SOCIO_DEMO.id,
  remaining_credits: 0,
  expires_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  discipline: DISCIPLINA_CROSSFIT,
  pack: null,
};

// Bug real detectado (2026-08-22): el único botón que abría "Elegí tu
// pack" era "Renovar", y ese solo aparece si hayVencido -- un socio nuevo
// (0 packs) o uno con todo activo no tenía NINGÚN botón en toda la PWA
// para llegar a comprar. Estos 2 tests cubren los accesos nuevos.
test.describe('PWA -- Acceso para comprar (antes solo "Renovar", oculto salvo con algo vencido)', () => {
  test('socio nuevo (0 packs activos): "Elegir mi pack" abre "Elegí tu pack" con el catálogo real', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), packs: [PACK_CROSSFIT, PACK_APARATOS] }, // user_credits: [] por defecto
    });

    await expect(page.getByText('Renovar')).toHaveCount(0);
    await page.getByText('Elegir mi pack', { exact: true }).click();

    await expect(page.getByText('Elegí tu pack')).toBeVisible();
    await expect(page.getByText('Pack 12 clases CrossFit')).toBeVisible();
  });

  test('con un pack activo y nada vencido: "Agregar otro pack" abre el mismo modal (no "Renovar")', async ({ page }) => {
    const BALANCE_ACTIVO = {
      id: 'uc-activo',
      user_id: SOCIO_DEMO.id,
      remaining_credits: 5,
      expires_at: null,
      created_at: '2026-08-01T00:00:00.000Z',
      discipline: DISCIPLINA_CROSSFIT,
      pack: null,
    };
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_ACTIVO], packs: [PACK_CROSSFIT, PACK_APARATOS] },
    });

    await expect(page.getByText('Renovar')).toHaveCount(0);
    await page.getByText('Agregar otro pack', { exact: true }).click();

    await expect(page.getByText('Elegí tu pack')).toBeVisible();
    await expect(page.getByText('Mes libre Aparatos')).toBeVisible();
  });
});

test.describe('PWA -- Elegí tu pack (packs dinámicos desde el Admin)', () => {
  test('muestra los packs reales de `packs`, con precio/créditos/días exactos -- nada hardcodeado', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_VENCIDO], packs: [PACK_CROSSFIT, PACK_APARATOS] },
    });

    await page.getByText('Renovar').click();
    await expect(page.getByText('Elegí tu pack')).toBeVisible();

    await expect(page.getByText('Pack 12 clases CrossFit')).toBeVisible();
    await expect(page.getByText('12 créditos CrossFit')).toBeVisible();
    await expect(page.getByText('$ 30.000', { exact: false })).toBeVisible();

    await expect(page.getByText('Mes libre Aparatos')).toBeVisible();
    await expect(page.getByText('Aparatos Pase Libre')).toBeVisible();
    await expect(page.getByText('$ 21.000', { exact: false })).toBeVisible();
  });

  test('un pack nuevo (recién creado en el Admin) aparece con solo recargar -- sin nada hardcodeado que actualizar en la PWA', async ({
    page,
  }) => {
    const packNuevo = {
      id: 'pack-6-crossfit',
      name: 'Pack 6 clases CrossFit',
      price: 10000,
      is_active: true,
      incluye_aparatos: false,
      dias_vigencia: null,
      creditos: [{ discipline_id: DISCIPLINA_CROSSFIT.id, credits: 6 }],
    };
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_VENCIDO], packs: [packNuevo] },
    });

    await page.getByText('Renovar').click();
    await expect(page.getByText('Pack 6 clases CrossFit')).toBeVisible();
    await expect(page.getByText('6 créditos CrossFit')).toBeVisible();
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

  // Bug crítico (2026-08-07): "Tuvimos un problema (COW00...)" en el
  // checkout de Mercado Pago -- create-payment-preference ahora puede
  // rechazar la preferencia con un error real (token vencido, Mercado Pago
  // la rechazó, etc.). Antes, paymentsApi.ts caía SIEMPRE al mock ante
  // cualquier error (aunque la función estuviera desplegada), así que la
  // PWA redirigía igual a una URL de mentira sin avisar nada -- y
  // Alert.alert no muestra nada en Web (es un no-op literal en
  // react-native-web), así que ni siquiera hacía falta este bug para que
  // el socio se quedara sin feedback.
  test('si create-payment-preference devuelve un error real, avisa con un mensaje claro en vez de redirigir a una URL rota', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [BALANCE_VENCIDO], packs: [PACK_CROSSFIT] },
    });

    // Sobreescribe el mock exitoso por defecto de create-payment-preference
    // (ver e2e/support/supabaseMock.ts) -- simula que la Edge Function SÍ
    // está desplegada pero Mercado Pago rechazó la preferencia.
    await page.route('**/functions/v1/create-payment-preference', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Mercado Pago respondió 400 al crear la preferencia.' }),
      })
    );

    let mensajeDialog = '';
    page.once('dialog', async (dialog) => {
      mensajeDialog = dialog.message();
      await dialog.dismiss();
    });

    await page.getByText('Renovar').click();
    await page.getByText('Pack 12 clases CrossFit').click();

    await expect.poll(() => mensajeDialog).toBe('Mercado Pago respondió 400 al crear la preferencia.');
    expect(page.url()).not.toContain('mercadopago');
  });
});

// Flujo de punta a punta pedido ("Prueba 1: Pack por Créditos" / "Prueba 2:
// Membresía por Vencimiento"): Admin crea el pack -> PWA lo muestra
// dinámicamente -> compra aprobada por Mercado Pago -> el socio ve el
// crédito/vencimiento acreditado. Los pasos 1-2 (alta del pack en el Admin)
// y el paso de "Actividad Reciente" viven en el OTRO repo (PAGINA SUPABASE,
// ver e2e/planes-packs.spec.js y e2e/actividad-reciente-mp.spec.js ahí) --
// acá se cubre el lado PWA completo: el pack recién creado se ve en "Elegí
// tu pack" (ya cubierto arriba) Y, apenas la compra queda aprobada, el
// socio ve el resultado real.
//
// "Simular la compra aprobada" NO puede ser un click en un botón de Mercado
// Pago real desde un E2E (es un dominio externo, y la acreditación la hace
// el webhook mp_process_payment -- server a server, entre Mercado Pago y
// Supabase, sin ningún request del navegador de por medio que un mock de
// REST pueda interceptar). Lo que SÍ es fiel a producción: sembrar el
// mismo estado en `pagos_socio`/`user_credits` que ese webhook ya aprobado
// deja escrito (ver mp_process_payment en
// backend/supabase_migration_mercadopago_payments.sql) y verificar que la
// PWA lo refleja tal cual -- en la práctica el webhook corre en
// segundos, mucho antes de que el socio vuelva a mirar el Home.
test.describe('PWA -- flujo de punta a punta: pack nuevo del Admin -> compra aprobada -> crédito/vencimiento acreditado', () => {
  test('Prueba 1 (Créditos): tras una compra aprobada de "Pack 4 clases CrossFit" ($15.000), el Home muestra 4 créditos de CrossFit sumados', async ({
    page,
  }) => {
    const PACK_4_CROSSFIT = {
      id: 'pack-4-crossfit',
      name: 'Pack 4 clases CrossFit',
      price: 15000,
      is_active: true,
      incluye_aparatos: false,
      dias_vigencia: null,
      creditos: [{ discipline_id: DISCIPLINA_CROSSFIT.id, credits: 4 }],
    };
    // Estado que deja mp_process_payment tras aprobar este pack: fila en
    // pagos_socio (estado='pagado', origen='mercado_pago') + user_credits
    // con remaining_credits = 4 para CrossFit (coalesce(0, previo) + 4).
    const BALANCE_POST_COMPRA = {
      id: 'uc-crossfit-post-compra',
      user_id: SOCIO_DEMO.id,
      remaining_credits: 4,
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      created_at: new Date().toISOString(),
      discipline: DISCIPLINA_CROSSFIT,
      pack: PACK_4_CROSSFIT,
    };

    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        packs: [PACK_4_CROSSFIT],
        user_credits: [BALANCE_POST_COMPRA],
        pagos_socio: [
          {
            id: 'pago-mp-4-crossfit',
            user_id: SOCIO_DEMO.id,
            paquete: 'Pack 4 clases CrossFit',
            monto: 15000,
            metodo_pago: 'mercado_pago',
            estado: 'pagado',
            origen: 'mercado_pago',
            mercado_pago_payment_id: 'mp-e2e-4-crossfit',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    await expect(page.getByText('CrossFit')).toBeVisible();
    await expect(page.getByText(/4.*clases restantes/)).toBeVisible();
    await expect(page.getByText('Activo', { exact: true })).toBeVisible();

    // El pack recién creado sigue disponible para una PRÓXIMA compra --
    // nada hardcodeado se rompió por haber comprado uno.
    await expect(page.getByText('Renovar')).toHaveCount(0); // con crédito activo, no hace falta renovar todavía
  });

  test('Prueba 2 (Vencimiento): tras una compra aprobada de "Pase 2 Meses Aparatos" ($70.000), el Home muestra el vencimiento extendido 60 días', async ({
    page,
  }) => {
    const PASE_2_MESES = {
      id: 'pack-2-meses-aparatos',
      name: 'Pase 2 Meses Aparatos',
      price: 70000,
      is_active: true,
      incluye_aparatos: true,
      dias_vigencia: 60,
      creditos: [],
    };
    // mp_process_payment extiende desde la fecha vigente previa (o desde
    // hoy si ya estaba vencida) -- acá simula el caso "ya estaba vencida":
    // greatest(vencimiento_previo_vencido, ahora) + 60 días = hoy + 60 días.
    const HOY = new Date();
    const VENCIMIENTO_ESPERADO = new Date(HOY.getTime() + 60 * 86_400_000);
    const membresiaPostCompra = {
      id: 'uc-aparatos-post-compra',
      user_id: SOCIO_DEMO.id,
      remaining_credits: null,
      expires_at: VENCIMIENTO_ESPERADO.toISOString(),
      created_at: HOY.toISOString(),
      discipline: DISCIPLINA_APARATOS,
      pack: PASE_2_MESES,
    };

    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        packs: [PASE_2_MESES],
        user_credits: [membresiaPostCompra],
        pagos_socio: [
          {
            id: 'pago-mp-2-meses-aparatos',
            user_id: SOCIO_DEMO.id,
            paquete: 'Pase 2 Meses Aparatos',
            monto: 70000,
            metodo_pago: 'mercado_pago',
            estado: 'pagado',
            origen: 'mercado_pago',
            mercado_pago_payment_id: 'mp-e2e-2-meses-aparatos',
            created_at: HOY.toISOString(),
          },
        ],
      },
    });

    // Réplica EXACTA de formatLongDate() (src/lib/membershipStatus.ts) en vez
    // de Intl/toLocaleDateString -- evita cualquier diferencia de huso
    // horario entre el ISO string (UTC) sembrado en el fixture y cómo lo
    // parsea la propia app (slice a YYYY-MM-DD + medianoche LOCAL).
    const mesesEs = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    const fechaLocal = new Date(`${membresiaPostCompra.expires_at.slice(0, 10)}T00:00:00`);
    const mes = mesesEs[fechaLocal.getMonth()];
    const fechaEsperada = `${fechaLocal.getDate()} de ${mes.charAt(0).toUpperCase()}${mes.slice(1)}, ${fechaLocal.getFullYear()}`;

    await expect(page.getByText('Aparatos / Musculación')).toBeVisible();
    await expect(page.getByText(`Vence el ${fechaEsperada}`)).toBeVisible();
    await expect(page.getByText('Vencido', { exact: true })).toHaveCount(0);
  });
});
