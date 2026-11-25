import { test, expect, devices, Page, CDPSession } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, DISCIPLINA_CROSSFIT, DISCIPLINA_APARATOS, EN_30_DIAS } from './support/fixtures';
import { irATab } from './support/nav';

// Prueba de RENDIMIENTO de la tanda visual (no corre en la suite normal):
//   RENDIMIENTO=1 npx playwright test e2e/rendimiento.spec.ts
// Chrome emulando un iPhone y un Android de gama baja (Moto G4) con la CPU 4x
// más lenta. Para cada interacción mide, en la página:
//   * cuadros (requestAnimationFrame): cantidad, p95, máximo y % por encima de 33 ms;
//   * tareas largas (PerformanceObserver "longtask", > 50 ms);
//   * recálculos de layout del navegador (CDP Performance: LayoutCount).
// Criterio acordado: ninguna tarea larga y como mucho 5 % de cuadros > 33 ms.
// Si algo no lo cumple, se saca. Los números se imprimen para el informe.

test.skip(!process.env.RENDIMIENTO, 'Solo con RENDIMIENTO=1');

// Siempre en Chrome (el descriptor de iPhone pide WebKit: se le saca eso).
function enChrome(d: (typeof devices)[string]) {
  const { defaultBrowserType: _webkit, ...resto } = d;
  return resto;
}

const PERFILES = [
  { nombre: 'iPhone 13', dispositivo: enChrome(devices['iPhone 13']), cpu: 1 },
  { nombre: 'Android gama baja (Moto G4, CPU 4x)', dispositivo: enChrome(devices['Moto G4']), cpu: 4 },
];

// Clase de hoy a la noche: siempre se ve en la Agenda (sin reloj falso, que
// alteraría requestAnimationFrame y la medición).
function clasesDeHoy(cantidad: number) {
  const hoy = new Date().getDay();
  return Array.from({ length: cantidad }, (_, i) => ({
    id: `perf-clase-${i}`,
    title: i % 2 ? 'Boxeo' : 'CrossFit',
    discipline_id: DISCIPLINA_CROSSFIT.id,
    instructor: 'Seba',
    location: 'Box 1',
    capacity: 12,
    days_of_week: [hoy],
    start_time: `23:${String(10 + i * 4).padStart(2, '0')}:00`,
    end_time: '23:59:00',
    disciplines: { is_active: true },
  }));
}

function rutinaLarga() {
  const ejercicios = Array.from({ length: 8 }, (_, i) => ({
    id: `perf-re-${i}`, sets: 4, reps: '10', rest_seconds: 60, weight_suggestion: '20kg', notes: 'Controlar la bajada', order_index: i,
    exercise: { id: `perf-ex-${i}`, name: `Ejercicio ${i + 1}`, muscle_group: i % 2 ? 'Espalda' : 'Pecho', description: null, video_url: null },
  }));
  return {
    routines: [{ id: 'perf-r', user_id: SOCIO_DEMO.id, title: 'Rutina', coach_name: 'Seba', notes: null, created_at: '2026-08-01T00:00:00.000Z' }],
    routine_days: [{ id: 'perf-d', routine_id: 'perf-r', title: 'Día 1', order_index: 0, routine_exercises: ejercicios }],
    routine_completions: [],
    user_exercise_weights: [],
  };
}

type Medicion = { cuadros: number; p95: number; maximo: number; lentos: number; tareasLargas: number; layouts: number };

async function medir(page: Page, cdp: CDPSession, accion: () => Promise<void>): Promise<Medicion> {
  const layoutsAntes = await contarLayouts(cdp);
  await page.evaluate(() => {
    const w = window as any;
    w.__med = { cuadros: [] as number[], largas: [] as number[], activo: true };
    const m = w.__med;
    let ultimo = 0;
    const tick = (t: number) => {
      if (ultimo) m.cuadros.push(t - ultimo);
      ultimo = t;
      if (m.activo) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    m.obs = new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) m.largas.push(e.duration);
    });
    m.obs.observe({ type: 'longtask' });
  });
  await accion();
  const { cuadros, largas } = await page.evaluate(() => {
    const m = (window as any).__med;
    m.activo = false;
    m.obs.disconnect();
    return { cuadros: m.cuadros as number[], largas: m.largas as number[] };
  });
  const layouts = (await contarLayouts(cdp)) - layoutsAntes;
  const ordenados = [...cuadros].sort((a, b) => a - b);
  const p95 = ordenados[Math.floor(ordenados.length * 0.95)] ?? 0;
  return {
    cuadros: cuadros.length,
    p95: Math.round(p95 * 10) / 10,
    maximo: Math.round((ordenados[ordenados.length - 1] ?? 0) * 10) / 10,
    lentos: cuadros.length ? Math.round((cuadros.filter((c) => c > 33).length / cuadros.length) * 1000) / 10 : 0,
    tareasLargas: largas.length,
    layouts,
  };
}

async function contarLayouts(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((m: { name: string }) => m.name === 'LayoutCount')?.value ?? 0;
}

// Apoyar el dedo, mantenerlo y levantarlo cancelando (no dispara el onPress).
// Devuelve el transform que tenía el elemento con el dedo apoyado: así se
// comprueba que la medición midió la animación de verdad.
async function apoyarYCancelar(page: Page, cdp: CDPSession, x: number, y: number, selector: string): Promise<string> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(450);
  const transform = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).transform);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(350);
  return transform;
}

// Cuántos cuadros, durante un scroll con el dedo, hubo algún elemento achicado
// por el toque (el efecto de "respirar" al desplazarse). Se mide aparte, porque
// leer estilos en cada cuadro carga la medición de rendimiento.
async function cuadrosAchicadosAlDeslizar(page: Page, cdp: CDPSession, zona: Zona, selector: string) {
  await page.evaluate((sel) => {
    const w = window as any;
    w.__achicados = { cuadros: 0, total: 0, activo: true };
    const tick = () => {
      const m = w.__achicados;
      m.total += 1;
      if (Array.from(document.querySelectorAll(sel)).some((el) => getComputedStyle(el).transform !== 'none' && getComputedStyle(el).transform !== 'matrix(1, 0, 0, 1, 0, 0)')) m.cuadros += 1;
      if (m.activo) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
  await deslizar(page, cdp, zona);
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const m = (window as any).__achicados;
    m.activo = false;
    return { cuadros: m.cuadros as number, total: m.total as number };
  });
}

// La lista desplazable que contiene al elemento: dónde apoyar el dedo para
// deslizarla (abajo de todo, para tener recorrido hacia arriba) y cuánto.
type Zona = { x: number; desde: number; hasta: number };
async function zonaDesplazable(selector: string, page: Page): Promise<Zona> {
  return page.locator(selector).first().evaluate((el) => {
    let n: HTMLElement | null = el.parentElement;
    while (n && !(/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight)) n = n.parentElement;
    if (!n) throw new Error('el elemento no está dentro de una lista desplazable');
    const r = n.getBoundingClientRect();
    const desde = r.bottom - 24;
    return { x: r.left + r.width / 2, desde, hasta: Math.max(r.top + 24, desde - 320) };
  });
}

async function scrollDeLaZona(page: Page, zona: Zona): Promise<number> {
  return page.evaluate(({ x, desde }) => {
    let n = document.elementFromPoint(x, desde) as HTMLElement | null;
    while (n && !(/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight)) n = n.parentElement;
    return n ? n.scrollTop : -1;
  }, zona);
}

async function volverArriba(page: Page, zona: Zona) {
  await page.evaluate(({ x, desde }) => {
    let n = document.elementFromPoint(x, desde) as HTMLElement | null;
    while (n && !(/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight)) n = n.parentElement;
    if (n) n.scrollTop = 0;
  }, zona);
  await page.waitForTimeout(400);
}

// Un dedo de verdad: apoyar, mover de a poco (un cuadro por paso) y soltar.
// OJO: Input.synthesizeScrollGesture con gestureSourceType 'touch' NO desplaza
// en este entorno (solo manda touchstart/touchend, sin touchmove): parecía un
// scroll y era un dedo quieto. Por eso el gesto se arma a mano, y la prueba
// comprueba que la lista se haya movido.
async function deslizar(page: Page, cdp: CDPSession, zona: Zona, pasos = 20) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: zona.x, y: zona.desde }] });
  for (let i = 1; i <= pasos; i++) {
    const y = zona.desde + ((zona.hasta - zona.desde) * i) / pasos;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: zona.x, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function informar(perfil: string, interaccion: string, m: Medicion) {
  // eslint-disable-next-line no-console
  console.log(
    `[rendimiento] ${perfil} | ${interaccion}: ${m.cuadros} cuadros, p95 ${m.p95} ms, máx ${m.maximo} ms, ` +
      `${m.lentos}% > 33 ms, ${m.tareasLargas} tareas largas, ${m.layouts} layouts`
  );
}

function cumple(m: Medicion) {
  expect(m.tareasLargas, 'tareas largas').toBe(0);
  expect(m.lentos, '% de cuadros > 33 ms').toBeLessThanOrEqual(5);
}

for (const perfil of PERFILES) {
  test.describe(`rendimiento -- ${perfil.nombre}`, () => {
    test.use({ ...perfil.dispositivo });

    test('parte 1 (base): toque y scroll en Agenda y Mi Rutina', async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: perfil.cpu });
      // Con agente de iPhone aparece el cartel "Instalá la app" (tapa el login):
      // se da por cerrado, como si el socio ya lo hubiera descartado.
      await page.addInitScript(() => {
        window.localStorage.setItem('greenfit:ios-install-banner-dismissed-at', String(Date.now()));
      });

      await loginComoSocio(page, {
        tables: {
          ...tablasBase(),
          classes: clasesDeHoy(9),
          user_credits: [{ id: 'uc', user_id: SOCIO_DEMO.id, discipline: DISCIPLINA_CROSSFIT, remaining_credits: 5, expires_at: EN_30_DIAS, created_at: '2026-01-01T00:00:00.000Z' }],
          ...rutinaLarga(),
        },
      });

      // Agenda: toque sobre una tarjeta, y scroll con el dedo sobre la lista.
      await irATab(page, 'Agenda');
      const tarjeta = page.getByTestId('agenda-card-perf-clase-0');
      await expect(tarjeta).toBeVisible();
      await page.waitForTimeout(800);
      const caja = (await tarjeta.boundingBox())!;
      const centro = { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
      let transformApoyado = '';
      const toqueAgenda = await medir(page, cdp, async () => {
        transformApoyado = await apoyarYCancelar(page, cdp, centro.x, centro.y, '[data-testid="agenda-card-perf-clase-0"]');
      });
      informar(perfil.nombre, 'Agenda, toque en tarjeta', toqueAgenda);
      expect(transformApoyado, 'la tarjeta se achica con el dedo apoyado').toBe('matrix(0.96, 0, 0, 0.96, 0, 0)');
      const zonaAgenda = await zonaDesplazable('[data-testid="agenda-card-perf-clase-0"]', page);
      const scrollAgenda = await medir(page, cdp, () => deslizar(page, cdp, zonaAgenda));
      informar(perfil.nombre, 'Agenda, scroll con el dedo', scrollAgenda);
      expect(await scrollDeLaZona(page, zonaAgenda), 'la Agenda se desplazó de verdad').toBeGreaterThan(100);
      await volverArriba(page, zonaAgenda);
      const achicados = await cuadrosAchicadosAlDeslizar(page, cdp, zonaAgenda, '[data-testid^="agenda-card-"]');
      // eslint-disable-next-line no-console
      console.log(`[rendimiento] ${perfil.nombre} | Agenda, tarjetas achicadas durante el scroll: ${achicados.cuadros} de ${achicados.total} cuadros`);
      expect(achicados.cuadros, 'deslizar no achica la tarjeta que queda bajo el dedo').toBe(0);

      // Mi Rutina: toque sobre el check, y scroll.
      await irATab(page, 'Mi Rutina');
      const check = page.getByLabel('Marcar Ejercicio 1 como completado');
      await expect(check).toBeVisible();
      await page.waitForTimeout(800);
      const cajaCheck = (await check.boundingBox())!;
      let transformCheck = '';
      const toqueRutina = await medir(page, cdp, async () => {
        transformCheck = await apoyarYCancelar(
          page, cdp, cajaCheck.x + cajaCheck.width / 2, cajaCheck.y + cajaCheck.height / 2,
          '[aria-label="Marcar Ejercicio 1 como completado"]'
        );
      });
      informar(perfil.nombre, 'Mi Rutina, toque en el check', toqueRutina);
      expect(transformCheck, 'el check se achica con el dedo apoyado').toBe('matrix(0.96, 0, 0, 0.96, 0, 0)');
      const zonaRutina = await zonaDesplazable('[aria-label="Marcar Ejercicio 1 como completado"]', page);
      const scrollRutina = await medir(page, cdp, () => deslizar(page, cdp, zonaRutina));
      informar(perfil.nombre, 'Mi Rutina, scroll con el dedo', scrollRutina);
      expect(await scrollDeLaZona(page, zonaRutina), 'Mi Rutina se desplazó de verdad').toBeGreaterThan(100);

      for (const m of [toqueAgenda, scrollAgenda, toqueRutina, scrollRutina]) cumple(m);
    });

    test('parte 2 (apariciones y esqueletos): Inicio, Agenda y Mi Rutina', async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: perfil.cpu });
      await page.addInitScript(() => {
        window.localStorage.setItem('greenfit:ios-install-banner-dismissed-at', String(Date.now()));
      });

      // Inicio: los créditos llegan tarde (esqueleto) y después entran las
      // tarjetas y las secciones en cascada.
      let soltarCreditos!: () => void;
      await loginComoSocio(page, {
        tables: {
          ...tablasBase(),
          classes: clasesDeHoy(9),
          user_credits: [
            { id: 'uc', user_id: SOCIO_DEMO.id, discipline: DISCIPLINA_CROSSFIT, remaining_credits: 5, expires_at: EN_30_DIAS, created_at: '2026-01-01T00:00:00.000Z' },
            { id: 'uc-2', user_id: SOCIO_DEMO.id, discipline: DISCIPLINA_APARATOS, remaining_credits: null, expires_at: EN_30_DIAS, created_at: '2026-01-01T00:00:00.000Z' },
          ],
          ...rutinaLarga(),
        },
        antesDeEntrar: async () => {
          soltarCreditos = await retener(page, '/rest/v1/user_credits');
        },
      });
      await expect(page.getByTestId('creditos-esqueleto')).toBeVisible();
      await page.waitForTimeout(600);
      const esqueletoInicio = await medir(page, cdp, () => page.waitForTimeout(1200));
      informar(perfil.nombre, 'Inicio, esqueleto de créditos pulsando', esqueletoInicio);
      // Dibujar los datos que llegan (React) y la cascada se miden por
      // separado: el dibujo ya podía dar una tarea larga en un Android lento
      // ANTES de esta parte (medido contra la versión anterior); lo que se
      // exige sin tareas largas es la animación.
      const dibujoInicio = await medir(page, cdp, async () => {
        soltarCreditos();
        await expect(page.getByTestId(`credito-card-${DISCIPLINA_CROSSFIT.id}`)).toBeVisible();
      });
      informar(perfil.nombre, 'Inicio, dibujar los créditos que llegan (informativo)', dibujoInicio);
      const aparicionInicio = await medir(page, cdp, () => page.waitForTimeout(1300));
      informar(perfil.nombre, 'Inicio, tarjetas y secciones en cascada', aparicionInicio);

      // Agenda: cambiar de día con la respuesta demorada (esqueleto) y
      // después las 9 tarjetas en cascada.
      await irATab(page, 'Agenda');
      await expect(page.getByTestId('agenda-card-perf-clase-0')).toBeVisible();
      await page.waitForTimeout(1200);
      const soltarClases = await retener(page, '/rest/v1/classes');
      const manana = new Date(Date.now() + 86_400_000);
      await page.getByText(String(manana.getDate()), { exact: true }).first().click();
      await expect(page.getByTestId('agenda-esqueleto')).toBeVisible();
      await page.waitForTimeout(300);
      const esqueletoAgenda = await medir(page, cdp, () => page.waitForTimeout(1200));
      informar(perfil.nombre, 'Agenda, esqueleto pulsando', esqueletoAgenda);
      const cascadaAgenda = await medir(page, cdp, async () => {
        soltarClases();
        await expect(page.getByTestId('agenda-card-perf-clase-0')).toBeVisible();
        await page.waitForTimeout(1300);
      });
      informar(perfil.nombre, 'Agenda, 9 tarjetas en cascada al cambiar de día', cascadaAgenda);

      // Mi Rutina: entrar (montar la pantalla: informativo, mismo criterio que
      // en Inicio) y los ejercicios en cascada; después deslizar: las tarjetas
      // de abajo aparecen al entrar en pantalla.
      const montajeRutina = await medir(page, cdp, async () => {
        await irATab(page, 'Mi Rutina');
        await expect(page.getByLabel('Marcar Ejercicio 1 como completado')).toBeVisible();
      });
      informar(perfil.nombre, 'Mi Rutina, montar la pantalla al entrar (informativo)', montajeRutina);
      const entradaRutina = await medir(page, cdp, () => page.waitForTimeout(1300));
      informar(perfil.nombre, 'Mi Rutina, ejercicios en cascada', entradaRutina);
      const zonaRutina = await zonaDesplazable('[aria-label="Marcar Ejercicio 1 como completado"]', page);
      const scrollConApariciones = await medir(page, cdp, async () => {
        await deslizar(page, cdp, zonaRutina);
        await page.waitForTimeout(900);
      });
      informar(perfil.nombre, 'Mi Rutina, deslizar (aparecen las de abajo)', scrollConApariciones);
      expect(await scrollDeLaZona(page, zonaRutina), 'Mi Rutina se desplazó de verdad').toBeGreaterThan(100);

      for (const m of [esqueletoInicio, aparicionInicio, esqueletoAgenda, cascadaAgenda, entradaRutina, scrollConApariciones]) cumple(m);
    });
  });
}

// Retiene las respuestas de una tabla del mock hasta soltar() (para ver y
// medir un esqueleto). Se registra después del mock: va por delante de él.
async function retener(page: Page, ruta: string): Promise<() => void> {
  let soltar!: () => void;
  const abierta = new Promise<void>((r) => (soltar = r));
  await page.route(
    (url) => url.pathname === ruta,
    async (route) => {
      await abierta;
      await route.fallback();
    }
  );
  return soltar;
}
