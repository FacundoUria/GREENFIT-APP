import { test, expect, Page, CDPSession, Locator } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { mockSupabase } from './support/supabaseMock';
import { tablasBase, CLASE_HOY, DISCIPLINA_CROSSFIT, EN_30_DIAS, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Tanda visual, parte 4, en un navegador real (Chrome con pantalla táctil):
// * reserva optimista: al confirmar, la tarjeta pasa a "Reservada" al
//   instante con un tilde que crece (200 ms, solo transform y opacity); la
//   hoja "¡Reserva confirmada!" sube recién cuando el servidor confirma; si
//   rechaza, la tarjeta vuelve con un fundido y el mismo error de siempre;
// * vibración (navigator.vibrate): 12 ms al reservar;
// * tirar para refrescar propio en Agenda, Inicio y Mi Rutina: el indicador
//   sigue al dedo solo con transform, refresca pasados 64 px y no antes;
//   overscroll-behavior-y: contain en la lista (Chrome de Android no recarga
//   la página). Igual en modo navegador y en modo app instalada.
// * con "reducir movimiento": el tilde aparece con fundido, sin crecer.

test.use({ viewport: { width: 360, height: 760 }, hasTouch: true });

const CURVA = 'cubic-bezier(0.22, 1, 0.36, 1)';
const PREGUNTA = '¿Confirmás tu lugar en esta clase?';
const REAFIRMACION_SALUD =
  'Declaro que mi estado de salud no ha cambiado desde mi última declaración y que me encuentro en condiciones de realizar la actividad.';
const CREDITO = {
  id: 'uc-1', user_id: SOCIO_DEMO.id, remaining_credits: 5, expires_at: EN_30_DIAS,
  created_at: '2026-08-01T00:00:00.000Z', discipline: DISCIPLINA_CROSSFIT, pack: null,
};
const TARJETA = `agenda-card-${CLASE_HOY.id}`;
const TILDE = `agenda-card-tilde-${CLASE_HOY.id}`;
const PILL = `agenda-card-pill-${CLASE_HOY.id}`;

test.beforeEach(async ({ page }) => {
  // A las 8 de hoy: la clase de las 19 se puede reservar (igual que agenda.spec.ts).
  const hoyALasOcho = new Date();
  hoyALasOcho.setHours(8, 0, 0, 0);
  await page.clock.install({ time: hoyALasOcho });
  // navigator.vibrate de mentira: anota cada vibración pedida.
  await page.addInitScript(() => {
    const w = window as any;
    w.__vibraciones = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value(patron: number) {
        w.__vibraciones.push(patron);
        return true;
      },
    });
  });
});

const vibraciones = (page: Page) => page.evaluate(() => (window as any).__vibraciones as number[]);

// Los fotogramas (keyframes) de la animación CSS que tiene puesta el elemento,
// leídos de la hoja de estilos (también sirve si la animación ya terminó).
async function animacion(el: Locator) {
  return el.evaluate((nodo) => {
    const s = getComputedStyle(nodo);
    let fotogramas: string[] = [];
    for (const hoja of Array.from(document.styleSheets)) {
      let reglas: CSSRule[] = [];
      try {
        reglas = Array.from(hoja.cssRules);
      } catch {
        continue;
      }
      for (const r of reglas) {
        if (r instanceof CSSKeyframesRule && r.name === s.animationName) {
          fotogramas = Array.from(r.cssRules).map((k) => (k as CSSKeyframeRule).style.cssText.replace(/\s+/g, ' ').trim());
        }
      }
    }
    return { duracion: s.animationDuration, curva: s.animationTimingFunction, fotogramas };
  });
}

async function hastaConfirmar(page: Page) {
  await irATab(page, 'Agenda');
  await page.getByTestId(TARJETA).click();
  await expect(page.getByText(PREGUNTA)).toBeVisible();
  await page.getByText(REAFIRMACION_SALUD).click();
  await page.getByText('Confirmar', { exact: true }).click();
}

test.describe('PWA -- Agenda optimista y vibración (tanda visual, parte 4)', () => {
  test('al confirmar, "Reservada" con el tilde que crece al instante; "¡Reserva confirmada!" recién cuando el servidor confirma', async ({ page }) => {
    let soltar!: () => void;
    const tables = { ...tablasBase(), classes: [CLASE_HOY], user_credits: [CREDITO], bookings: [] as any[] };
    await loginComoSocio(page, {
      tables,
      rpc: {
        book_class: () => {
          tables.bookings.push({ id: 'bk-e2e', user_id: SOCIO_DEMO.id, class_id: CLASE_HOY.id, booking_date: HOY_STR });
          return 'e2e-booking-id';
        },
      },
      antesDeEntrar: async () => {
        const abierta = new Promise<void>((r) => (soltar = r));
        await page.route(
          (url) => url.pathname === '/rest/v1/rpc/book_class',
          async (route) => {
            await abierta;
            await route.fallback();
          }
        );
      },
    });
    await hastaConfirmar(page);

    // El servidor todavía no respondió.
    const tarjeta = page.getByTestId(TARJETA);
    await expect(tarjeta.getByText('Reservada', { exact: true })).toBeVisible();
    await expect(page.getByTestId(TILDE)).toBeVisible();
    expect(await animacion(page.getByTestId(TILDE))).toEqual({
      duracion: '0.2s',
      curva: CURVA,
      fotogramas: ['opacity: 0; transform: scale(0.4);', 'opacity: 1; transform: scale(1);'],
    });
    await expect(page.getByText(PREGUNTA)).toHaveCount(0);
    await expect(page.getByText('¡Reserva confirmada!')).toHaveCount(0);
    expect(await vibraciones(page)).toEqual([12]);

    soltar();
    await expect(page.getByText('¡Reserva confirmada!')).toBeVisible();
    await page.getByText('Listo').click();
    await expect(tarjeta.getByText('Reservada', { exact: true })).toBeVisible();
    await expect(page.getByTestId(TILDE)).toBeVisible();
    expect(await vibraciones(page)).toEqual([12]);
  });

  test('si el servidor rechaza, la tarjeta vuelve a "Reservar" con un fundido y aparece el mismo error de siempre', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), classes: [CLASE_HOY], user_credits: [CREDITO], bookings: [] },
      antesDeEntrar: async () => {
        await page.route(
          (url) => url.pathname === '/rest/v1/rpc/book_class',
          (route) =>
            route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({ code: 'P0001', message: 'No quedan cupos para esta clase.', details: null, hint: null }),
            })
        );
      },
    });
    await hastaConfirmar(page);

    await expect(page.getByText('No se pudo reservar', { exact: true })).toBeVisible();
    await expect(page.getByText('No quedan cupos para esta clase.', { exact: true })).toBeVisible();
    await expect(page.getByTestId(TARJETA).getByText('Reservar', { exact: true })).toBeAttached();
    await expect(page.getByTestId(TILDE)).toHaveCount(0);
    expect(await animacion(page.getByTestId(PILL))).toEqual({
      duracion: '0.2s',
      curva: CURVA,
      fotogramas: ['opacity: 0;', 'opacity: 1;'],
    });
    await expect(page.getByText('¡Reserva confirmada!')).toHaveCount(0);
    expect(await vibraciones(page)).toEqual([12]);
  });

  test('con "reducir movimiento", el tilde aparece con fundido (sin crecer)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let soltar!: () => void;
    await loginComoSocio(page, {
      tables: { ...tablasBase(), classes: [CLASE_HOY], user_credits: [CREDITO], bookings: [] },
      rpc: { book_class: () => 'e2e-booking-id' },
      antesDeEntrar: async () => {
        const abierta = new Promise<void>((r) => (soltar = r));
        await page.route(
          (url) => url.pathname === '/rest/v1/rpc/book_class',
          async (route) => {
            await abierta;
            await route.fallback();
          }
        );
      },
    });
    await hastaConfirmar(page);
    await expect(page.getByTestId(TILDE)).toBeVisible();
    expect((await animacion(page.getByTestId(TILDE))).fotogramas).toEqual(['opacity: 0;', 'opacity: 1;']);
    soltar();
    await expect(page.getByText('¡Reserva confirmada!')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Tirar para refrescar
// ---------------------------------------------------------------------------

const RUTINA = {
  routines: [{ id: 'r-1', user_id: SOCIO_DEMO.id, title: 'Full Body', coach_name: 'Seba', notes: null, created_at: '2026-08-01T00:00:00.000Z' }],
  routine_days: [
    {
      id: 'd-1', routine_id: 'r-1', title: 'Día 1', order_index: 0,
      routine_exercises: [
        {
          id: 're-1', sets: 4, reps: '10', rest_seconds: 60, weight_suggestion: '20kg', notes: null, order_index: 0,
          exercise: { id: 'ex-1', name: 'Press de banca', muscle_group: 'Pecho', description: null, video_url: null },
        },
      ],
    },
  ],
  routine_completions: [],
  user_exercise_weights: [],
};

// Modo app instalada: la PWA se entera por display-mode: standalone (Android)
// o navigator.standalone (iPhone). Se simulan los dos antes de abrir la app.
async function comoAppInstalada(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (consulta: string) =>
      consulta.includes('display-mode: standalone')
        ? ({
            matches: true, media: consulta, onchange: null,
            addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
            dispatchEvent: () => false,
          } as unknown as MediaQueryList)
        : original(consulta);
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
}

// El indicador de la pantalla visible y el nodo que scrollea (su hermano anterior).
const indicador = (page: Page) => page.getByTestId('refresco-indicador').filter({ visible: true });

async function estadoIndicador(page: Page) {
  return indicador(page).evaluate((el) => {
    const s = getComputedStyle(el);
    const m = new DOMMatrixReadOnly(s.transform === 'none' ? undefined : s.transform);
    return { y: Math.round(m.m42), opacidad: Number(s.opacity) };
  });
}

async function cajaDeLaLista(page: Page) {
  return indicador(page).evaluate((el) => {
    const lista = el.previousElementSibling as HTMLElement;
    const r = lista.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + 90,
      overscroll: getComputedStyle(lista).overscrollBehaviorY,
      scrollTop: lista.scrollTop,
    };
  });
}

// Un dedo de verdad (CDP): apoyar, bajar `dy` px de a poco y (si `soltar`) levantar.
async function tirar(page: Page, cdp: CDPSession, x: number, y: number, dy: number, soltar = true) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  const pasos = 12;
  for (let i = 1; i <= pasos; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / pasos }] });
    await page.waitForTimeout(16);
  }
  if (soltar) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

type Pantalla = {
  nombre: 'Agenda' | 'Inicio' | 'Mi Rutina';
  // Pedido que hace la pantalla al cargar: contarlo dice si refrescó.
  ruta: string;
  listo: (page: Page) => Promise<void>;
};

const PANTALLAS: Pantalla[] = [
  {
    nombre: 'Agenda',
    ruta: '/rest/v1/classes',
    listo: async (page) => {
      await irATab(page, 'Agenda');
      await expect(page.getByTestId(TARJETA)).toBeVisible();
    },
  },
  {
    nombre: 'Inicio',
    ruta: '/rest/v1/user_credits',
    listo: async (page) => {
      await expect(page.getByTestId(`credito-card-${DISCIPLINA_CROSSFIT.id}`)).toBeVisible();
    },
  },
  {
    nombre: 'Mi Rutina',
    ruta: '/rest/v1/routines',
    listo: async (page) => {
      await irATab(page, 'Mi Rutina');
      await expect(page.getByText('Press de banca').first()).toBeVisible();
    },
  },
];

for (const modo of ['navegador', 'app instalada'] as const) {
  test.describe(`PWA -- tirar para refrescar, modo ${modo} (tanda visual, parte 4)`, () => {
    for (const pantalla of PANTALLAS) {
      test(`${pantalla.nombre}: el indicador sigue al dedo (transform), refresca pasados 64 px y no antes; overscroll contenido`, async ({ page }) => {
        if (modo === 'app instalada') await comoAppInstalada(page);
        // Modo app instalada de verdad: el botón de instalar no aparece en el Login.
        await mockSupabase(page, { user: SOCIO_DEMO, tables: tablasBase(), rpc: {} });
        await page.goto('/');
        await expect(page.getByPlaceholder('DNI')).toBeVisible();
        await expect(page.getByLabel('Instalar Greenfit como app')).toHaveCount(modo === 'app instalada' ? 0 : 1);

        await loginComoSocio(page, {
          tables: { ...tablasBase(), classes: [CLASE_HOY], user_credits: [CREDITO], bookings: [], ...RUTINA },
        });
        await pantalla.listo(page);
        await page.waitForTimeout(800); // apariciones terminadas
        // La recarga queda retenida hasta soltarla: así se ve la ruedita.
        let soltarRecarga!: () => void;
        const retenida = new Promise<void>((r) => (soltarRecarga = r));
        await page.route(
          (url) => url.pathname === pantalla.ruta,
          async (route) => {
            await retenida;
            await route.fallback();
          }
        );
        let pedidos = 0;
        page.on('request', (r) => {
          if (new URL(r.url()).pathname === pantalla.ruta && r.method() === 'GET') pedidos += 1;
        });

        const lista = await cajaDeLaLista(page);
        expect(lista.overscroll, 'overscroll-behavior-y').toBe('contain');
        expect(lista.scrollTop).toBe(0);
        expect(await estadoIndicador(page)).toEqual({ y: 0, opacidad: 0 });
        const cdp = await page.context().newCDPSession(page);

        // Menos que el umbral: el indicador acompaña y vuelve, sin refrescar.
        // (Retener no frena nada si no hay pedidos: de eso se trata.)
        await tirar(page, cdp, lista.x, lista.y, 40);
        await expect.poll(() => estadoIndicador(page)).toEqual({ y: 0, opacidad: 0 });
        await page.waitForTimeout(300);
        expect(pedidos, 'no refresca con 40 px').toBe(0);

        // Más que el umbral: con el dedo abajo, el indicador está bajado (tope 88 px) y opaco.
        await tirar(page, cdp, lista.x, lista.y, 120, false);
        expect(await estadoIndicador(page)).toEqual({ y: 88, opacidad: 1 });
        const transicion = await indicador(page).evaluate((el) => getComputedStyle(el).transitionProperty);
        expect(transicion, 'mientras sigue al dedo, sin transición').toBe('none');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

        // Al soltar: refresca y, mientras carga, queda en 64 px con la ruedita.
        await expect.poll(() => pedidos).toBeGreaterThanOrEqual(1);
        await expect.poll(() => estadoIndicador(page)).toEqual({ y: 64, opacidad: 1 });
        // El indicador es aria-hidden (decorativo): la ruedita se busca igual.
        await expect(indicador(page).getByRole('progressbar', { includeHidden: true })).toBeAttached();
        await page.waitForTimeout(800);
        expect(await estadoIndicador(page), 'sigue mientras la recarga no termina').toEqual({ y: 64, opacidad: 1 });
        // Termina la recarga: el indicador vuelve a su lugar.
        soltarRecarga();
        await expect.poll(() => estadoIndicador(page), { timeout: 5000 }).toEqual({ y: 0, opacidad: 0 });
        // Solo transform y opacity.
        expect(await indicador(page).evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('transform, opacity');

        // El gesto no tocó nada de lo que quedó bajo el dedo.
        await expect(page.getByText(PREGUNTA)).toHaveCount(0);
        await pantalla.listo(page);
      });
    }
  });
}

test('con "reducir movimiento", el indicador no baja: aparece y se va con fundido', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginComoSocio(page, { tables: { ...tablasBase(), classes: [CLASE_HOY], user_credits: [CREDITO], bookings: [] } });
  await PANTALLAS[0].listo(page);
  await page.waitForTimeout(800);
  const lista = await cajaDeLaLista(page);
  const cdp = await page.context().newCDPSession(page);
  await tirar(page, cdp, lista.x, lista.y, 32, false);
  // A mitad del umbral: quieto en su lugar de refresco, a media opacidad.
  expect(await estadoIndicador(page)).toEqual({ y: 64, opacidad: 0.5 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => estadoIndicador(page)).toEqual({ y: 64, opacidad: 0 });
});
