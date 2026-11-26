import { test, expect, Page } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, CLASE_HOY, DISCIPLINA_CROSSFIT, EN_30_DIAS, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Tanda visual, parte 3 (hojas), en un navegador real, con la confirmación de
// reserva de la Agenda como caso (todas usan el mismo HojaInferior):
// * sube desde abajo en 600 ms con la curva de la app, pegada al borde, con manija;
// * se cierra en 200 ms tocando afuera, y mientras sale se sigue viendo;
// * arrastrada hacia abajo: más del 30 % de su alto (o un "flick") la cierra;
//   menos, vuelve a su lugar; empezar el arrastre sobre un botón NO lo activa;
// * con una acción en curso no se cierra (ni tocando afuera ni arrastrando):
//   la cancelación de una reserva;
// * con "reducir movimiento", abre con fundido.

test.use({ viewport: { width: 360, height: 760 }, hasTouch: true });

const CURVA = 'cubic-bezier(0.22, 1, 0.36, 1)';
const PREGUNTA = '¿Confirmás tu lugar en esta clase?';
const REAFIRMACION_SALUD =
  'Declaro que mi estado de salud no ha cambiado desde mi última declaración y que me encuentro en condiciones de realizar la actividad.';

test.beforeEach(async ({ page }) => {
  // A las 8 de hoy: la clase de las 19 se puede reservar (igual que agenda.spec.ts).
  const hoyALasOcho = new Date();
  hoyALasOcho.setHours(8, 0, 0, 0);
  await page.clock.install({ time: hoyALasOcho });
});

async function abrirConfirmacion(page: Page, opciones: { antesDeEntrar?: () => Promise<void> } = {}) {
  await loginComoSocio(page, {
    tables: {
      ...tablasBase(),
      classes: [CLASE_HOY],
      user_credits: [
        { id: 'uc-1', user_id: SOCIO_DEMO.id, remaining_credits: 5, expires_at: EN_30_DIAS, created_at: '2026-08-01T00:00:00.000Z', discipline: DISCIPLINA_CROSSFIT, pack: null },
      ],
      bookings: [],
    },
    rpc: { book_class: () => 'e2e-booking-id' },
    ...opciones,
  });
  await irATab(page, 'Agenda');
  await page.getByTestId(`agenda-card-${CLASE_HOY.id}`).click();
  await expect(page.getByText(PREGUNTA)).toBeVisible();
  const hoja = page.getByTestId('hoja-inferior');
  // Que termine de subir antes de seguir (600 ms).
  await expect.poll(() => hoja.evaluate((el) => el.getAnimations().length)).toBe(0);
  return hoja;
}

const transform = (hoja: ReturnType<Page['getByTestId']>) => hoja.evaluate((el) => getComputedStyle(el).transform);

// Arrastre con el mouse (eventos de puntero): de a `pasos`, `espera` ms entre cada uno.
async function arrastrar(page: Page, x: number, y: number, dy: number, pasos: number, espera: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= pasos; i++) {
    await page.mouse.move(x, y + (dy * i) / pasos);
    if (espera) await page.waitForTimeout(espera);
  }
  await page.mouse.up();
}

test.describe('PWA -- hojas inferiores (tanda visual, parte 3)', () => {
  test('sube desde abajo en 600 ms con la curva de la app, pegada al borde inferior y con manija', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY],
        user_credits: [
          { id: 'uc-1', user_id: SOCIO_DEMO.id, remaining_credits: 5, expires_at: EN_30_DIAS, created_at: '2026-08-01T00:00:00.000Z', discipline: DISCIPLINA_CROSSFIT, pack: null },
        ],
      },
    });
    await irATab(page, 'Agenda');
    await page.getByTestId(`agenda-card-${CLASE_HOY.id}`).click();
    const hoja = page.getByTestId('hoja-inferior');
    await expect(hoja).toBeVisible();
    const entrada = await hoja.evaluate((el) => {
      const s = getComputedStyle(el);
      const a = el.getAnimations()[0];
      return {
        duracion: s.animationDuration,
        curva: s.animationTimingFunction,
        desde: a ? ((a.effect as KeyframeEffect).getKeyframes()[0].transform as string) : null,
      };
    });
    expect(entrada).toEqual({ duracion: '0.6s', curva: CURVA, desde: 'translateY(100%)' });

    await expect.poll(() => hoja.evaluate((el) => el.getAnimations().length)).toBe(0);
    const caja = (await hoja.boundingBox())!;
    expect(Math.round(caja.y + caja.height)).toBe(760);
    expect(Math.round(caja.width)).toBe(360);
    // La manija: 40 x 5, centrada arriba.
    const manija = await hoja.evaluate((el) => {
      const m = el.firstElementChild!.firstElementChild as HTMLElement;
      const r = m.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)} centro ${Math.round(r.x + r.width / 2)}`;
    });
    expect(manija).toBe('40x5 centro 180');
  });

  test('tocar afuera la cierra en 200 ms, y mientras sale se sigue viendo el contenido', async ({ page }) => {
    const hoja = await abrirConfirmacion(page);
    await page.mouse.click(180, 60); // el fondo oscuro, arriba
    const salida = await hoja.evaluate((el) => {
      const s = getComputedStyle(el);
      return { duracion: s.transitionDuration, curva: s.transitionTimingFunction };
    });
    expect(salida).toEqual({ duracion: '0.2s', curva: CURVA });
    await expect(page.getByText(PREGUNTA)).toBeVisible(); // todavía saliendo
    await expect(page.getByText(PREGUNTA)).toHaveCount(0);
    await expect(hoja).toHaveCount(0);
  });

  test('arrastrada menos del 30 % vuelve a su lugar; más del 30 %, se cierra', async ({ page }) => {
    const hoja = await abrirConfirmacion(page);
    const caja = (await hoja.boundingBox())!;

    await arrastrar(page, 180, caja.y + 12, caja.height * 0.15, 10, 16);
    await expect.poll(() => transform(hoja)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await expect(page.getByText(PREGUNTA)).toBeVisible();

    await arrastrar(page, 180, caja.y + 12, caja.height * 0.45, 12, 16);
    await expect(page.getByText(PREGUNTA)).toHaveCount(0);
  });

  test('un "flick" rápido hacia abajo la cierra aunque no llegue al 30 %', async ({ page }) => {
    const hoja = await abrirConfirmacion(page);
    const caja = (await hoja.boundingBox())!;
    await arrastrar(page, 180, caja.y + 12, caja.height * 0.2, 3, 0);
    await expect(page.getByText(PREGUNTA)).toHaveCount(0);
  });

  test('con el dedo (touch) también se cierra arrastrándola', async ({ page }) => {
    const hoja = await abrirConfirmacion(page);
    const caja = (await hoja.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const y0 = caja.y + 40;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: y0 }] });
    for (let i = 1; i <= 15; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: y0 + i * 20 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByText(PREGUNTA)).toHaveCount(0);
  });

  test('empezar el arrastre sobre un botón no lo activa ("Cancelar" no cierra la hoja)', async ({ page }) => {
    const hoja = await abrirConfirmacion(page);
    const cancelar = (await page.getByText('Cancelar', { exact: true }).boundingBox())!;
    const caja = (await hoja.boundingBox())!;
    await arrastrar(page, cancelar.x + cancelar.width / 2, cancelar.y + cancelar.height / 2, caja.height * 0.15, 8, 16);
    await expect.poll(() => transform(hoja)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await page.waitForTimeout(300);
    await expect(page.getByText(PREGUNTA)).toBeVisible();

    // Un toque normal en "Cancelar" sí la cierra.
    await page.getByText('Cancelar', { exact: true }).click();
    await expect(page.getByText(PREGUNTA)).toHaveCount(0);
  });

  // Con la parte 4 (reserva optimista) la hoja de CONFIRMAR se cierra apenas
  // se toca "Confirmar" (la tarjeta ya se ve "Reservada" mientras responde el
  // servidor), así que la acción en curso se prueba con la hoja de CANCELAR,
  // que sí espera abierta al servidor.
  test('con la cancelación en curso no se cierra: ni tocando afuera ni arrastrando', async ({ page }) => {
    let soltar!: () => void;
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY],
        user_credits: [
          { id: 'uc-1', user_id: SOCIO_DEMO.id, remaining_credits: 5, expires_at: EN_30_DIAS, created_at: '2026-08-01T00:00:00.000Z', discipline: DISCIPLINA_CROSSFIT, pack: null },
        ],
        bookings: [{ id: 'bk-1', user_id: SOCIO_DEMO.id, class_id: CLASE_HOY.id, booking_date: HOY_STR }],
      },
      rpc: { cancel_booking_detalle: () => ({ reintegrado: true, motivo: 'reintegrado', vence: null, mensaje: 'Te devolvimos el crédito.' }) },
      antesDeEntrar: async () => {
        const abierta = new Promise<void>((r) => (soltar = r));
        await page.route(
          (url) => url.pathname === '/rest/v1/rpc/cancel_booking_detalle',
          async (route) => {
            await abierta;
            await route.fallback();
          }
        );
      },
    });
    await irATab(page, 'Agenda');
    await page.getByTestId(`agenda-card-${CLASE_HOY.id}`).click();
    const hoja = page.getByTestId('hoja-inferior');
    await expect(page.getByText('Confirmar cancelación', { exact: true })).toBeVisible();
    await expect.poll(() => hoja.evaluate((el) => el.getAnimations().length)).toBe(0);
    await page.getByText('Confirmar cancelación', { exact: true }).click();

    await page.mouse.click(180, 60);
    const caja = (await hoja.boundingBox())!;
    await arrastrar(page, 180, caja.y + 12, caja.height * 0.6, 10, 16);
    await page.waitForTimeout(300);
    // Sigue abierta (el botón muestra la ruedita mientras espera).
    await expect(page.getByText('Cancelar CrossFit', { exact: true })).toBeVisible();
    await expect(page.getByTestId('cancel-booking-confirm')).toBeVisible();
    expect(await transform(hoja)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

    soltar();
    await expect(page.getByText('Reserva cancelada', { exact: true })).toBeVisible();
  });

  test('con "reducir movimiento" abre con fundido (sin desplazarse)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY],
        user_credits: [
          { id: 'uc-1', user_id: SOCIO_DEMO.id, remaining_credits: 5, expires_at: EN_30_DIAS, created_at: '2026-08-01T00:00:00.000Z', discipline: DISCIPLINA_CROSSFIT, pack: null },
        ],
      },
    });
    await irATab(page, 'Agenda');
    await page.getByTestId(`agenda-card-${CLASE_HOY.id}`).click();
    const hoja = page.getByTestId('hoja-inferior');
    await expect(hoja).toBeVisible();
    const fotogramas = await hoja.evaluate((el) =>
      el.getAnimations().map((a) => (a.effect as KeyframeEffect).getKeyframes().map((k) => ({ opacity: String(k.opacity), transform: k.transform ?? null })))
    );
    expect(fotogramas).toEqual([
      [
        { opacity: '0', transform: null },
        { opacity: '1', transform: null },
      ],
    ]);
  });
});
