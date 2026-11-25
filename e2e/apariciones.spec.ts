import { test, expect, Page, Locator } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, DISCIPLINA_CROSSFIT, DISCIPLINA_APARATOS, EN_30_DIAS, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Tanda visual, parte 2 (apariciones y esqueletos), en un navegador real:
// * mientras carga, un esqueleto con la forma de las tarjetas (barra de
//   progreso "Cargando" que pulsa por opacidad), no una ruedita;
// * al entrar en pantalla, cada tarjeta sube 24 px y aparece en 600 ms con la
//   curva de la app, en cascada de 60 ms según su posición, UNA sola vez, y
//   termina sin dejar ningún transform puesto;
// * con "reducir movimiento": solo fundido, y el esqueleto quieto.

test.use({ viewport: { width: 360, height: 760 } });

const CURVA = 'cubic-bezier(0.22, 1, 0.36, 1)';

// Retiene las respuestas de una tabla (o RPC) del mock hasta soltar(): así se
// ve el esqueleto. Va por delante del mock (la última ruta registrada corre
// primero) y después le pasa el pedido con fallback(). Por eso se registra
// DESPUÉS del mock: con la app ya abierta, o en `antesDeEntrar` del login.
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

// La Agenda terminó de cargar el día (con tarjetas o sin ellas: el mock de e2e
// no filtra por día de la semana, así que hoy también puede mostrar clases).
async function agendaCargada(page: Page) {
  await expect(page.getByText(/turnos?$|No hay clases programadas/).first()).toBeVisible();
  await expect(page.getByTestId('agenda-esqueleto')).toHaveCount(0);
}

type Animacion = { nombre: string; duracion: string; curva: string; retraso: string; relleno: string };

// La animación del envoltorio de <Aparecer> (el padre del elemento).
function animacionDelPadre(el: Element): Animacion {
  const s = getComputedStyle(el.parentElement!);
  return {
    nombre: s.animationName,
    duracion: s.animationDuration,
    curva: s.animationTimingFunction,
    retraso: s.animationDelay,
    relleno: s.animationFillMode,
  };
}

async function esperarQueArranque(elemento: Locator) {
  await expect.poll(() => elemento.evaluate((el) => getComputedStyle(el.parentElement!).animationName)).not.toBe('none');
}

// Fotogramas de la animación en curso del envoltorio (Web Animations API).
async function fotogramas(elemento: Locator) {
  return elemento.evaluate((el) =>
    el.parentElement!.getAnimations().map((a) =>
      (a.effect as KeyframeEffect).getKeyframes().map((k) => ({ opacity: String(k.opacity), transform: k.transform ?? null }))
    )
  );
}

const MANANA = new Date(Date.now() + 86_400_000);
const clasesDeManana = Array.from({ length: 3 }, (_, i) => ({
  id: `m-${i}`,
  title: 'CrossFit',
  discipline_id: DISCIPLINA_CROSSFIT.id,
  instructor: 'Seba',
  location: 'Box 1',
  capacity: 12,
  days_of_week: [MANANA.getDay()],
  start_time: `${9 + i}:00:00`.padStart(8, '0'),
  end_time: `${10 + i}:00:00`.padStart(8, '0'),
  disciplines: { is_active: true },
}));

const CREDITOS = [
  { id: 'uc-1', user_id: SOCIO_DEMO.id, discipline: DISCIPLINA_CROSSFIT, remaining_credits: 5, expires_at: EN_30_DIAS, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'uc-2', user_id: SOCIO_DEMO.id, discipline: DISCIPLINA_APARATOS, remaining_credits: null, expires_at: EN_30_DIAS, created_at: '2026-01-01T00:00:00.000Z' },
];

function rutina(ejercicios: number) {
  return {
    routines: [{ id: 'r-1', user_id: SOCIO_DEMO.id, title: 'Full Body', coach_name: 'Seba', notes: null, created_at: '2026-08-01T00:00:00.000Z' }],
    routine_days: [
      {
        id: 'd-1', routine_id: 'r-1', title: 'Día 1', order_index: 0,
        routine_exercises: Array.from({ length: ejercicios }, (_, i) => ({
          id: `re-${i}`, sets: 4, reps: '10', rest_seconds: 60, weight_suggestion: '20kg', notes: null, order_index: i,
          exercise: { id: `ex-${i}`, name: `Ejercicio ${i + 1}`, muscle_group: 'Pecho', description: null, video_url: null },
        })),
      },
    ],
    routine_completions: [],
    user_exercise_weights: [],
    routine_history: [
      {
        id: 'h-1', user_id: SOCIO_DEMO.id, sesion_id: 's-1', fecha: HOY_STR, titulo_dia: 'Día 1', nombre_ejercicio: 'Ejercicio 1',
        grupo_muscular: 'Pecho', series: 4, repeticiones: '10', peso: '22kg', orden: 0, total_ejercicios: 1, completo: true,
        created_at: `${HOY_STR}T12:05:00.000Z`, oculta_en: null,
      },
    ],
  };
}

test.describe('PWA -- apariciones y esqueletos (tanda visual, parte 2)', () => {
  test('Agenda, al cambiar de día: esqueleto que pulsa, y las tarjetas entran en cascada (fade + 24 px, 600 ms, una vez)', async ({ page }) => {
    await loginComoSocio(page, { tables: { ...tablasBase(), classes: clasesDeManana } });
    await irATab(page, 'Agenda');
    await agendaCargada(page);

    const soltar = await retener(page, '/rest/v1/classes');
    await page.getByText(String(MANANA.getDate()), { exact: true }).first().click();

    const esqueleto = page.getByTestId('agenda-esqueleto');
    await expect(esqueleto).toBeVisible();
    await expect(esqueleto).toHaveAttribute('role', 'progressbar');
    await expect(esqueleto).toHaveAttribute('aria-label', 'Cargando');
    const pulso = await esqueleto.evaluate((el) => {
      const s = getComputedStyle(el);
      return { hay: s.animationName !== 'none', duracion: s.animationDuration, vueltas: s.animationIterationCount };
    });
    expect(pulso).toEqual({ hay: true, duracion: '1.2s', vueltas: 'infinite' });

    soltar();
    const tercera = page.getByTestId('agenda-card-m-2');
    await expect(tercera).toBeVisible();
    await expect(esqueleto).toHaveCount(0);
    await esperarQueArranque(tercera);

    // Sube 24 px desde invisible (lo que hay mientras corre, en la 3.ª: es la que más espera).
    expect(await fotogramas(tercera)).toEqual([
      [
        { opacity: '0', transform: 'translateY(24px)' },
        { opacity: '1', transform: 'translateY(0px)' },
      ],
    ]);

    const animaciones = await page.evaluate(
      (ids) => ids.map((id) => {
        const s = getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!.parentElement!);
        return { duracion: s.animationDuration, curva: s.animationTimingFunction, retraso: s.animationDelay, relleno: s.animationFillMode };
      }),
      ['agenda-card-m-0', 'agenda-card-m-1', 'agenda-card-m-2']
    );
    expect(animaciones).toEqual([
      { duracion: '0.6s', curva: CURVA, retraso: '0s', relleno: 'backwards' },
      { duracion: '0.6s', curva: CURVA, retraso: '0.06s', relleno: 'backwards' },
      { duracion: '0.6s', curva: CURVA, retraso: '0.12s', relleno: 'backwards' },
    ]);

    // Al terminar no queda ningún transform puesto (ni capa de más) y se ve entera.
    await expect
      .poll(() => tercera.evaluate((el) => {
        const s = getComputedStyle(el.parentElement!);
        return `${s.transform} ${s.opacity} ${el.parentElement!.getAnimations().length}`;
      }))
      .toBe('none 1 0');
  });

  test('Inicio: esqueleto de créditos mientras carga; después las tarjetas entran de izquierda a derecha', async ({ page }) => {
    let soltar!: () => void;
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: CREDITOS },
      antesDeEntrar: async () => {
        soltar = await retener(page, '/rest/v1/user_credits');
      },
    });

    const esqueleto = page.getByTestId('creditos-esqueleto');
    await expect(esqueleto).toBeVisible();
    await expect(esqueleto).toHaveAttribute('aria-label', 'Cargando');

    soltar();
    const primera = page.getByTestId(`credito-card-${DISCIPLINA_CROSSFIT.id}`);
    const segunda = page.getByTestId(`credito-card-${DISCIPLINA_APARATOS.id}`);
    await expect(segunda).toBeVisible();
    await expect(esqueleto).toHaveCount(0);
    await esperarQueArranque(segunda);
    const [a, b] = [await primera.evaluate(animacionDelPadre), await segunda.evaluate(animacionDelPadre)];
    expect(a.retraso).toBe('0s');
    expect(b.retraso).toBe('0.06s');
  });

  test('Mi Rutina: esqueleto en Rutina de hoy, Entrenamientos y Mis rutinas', async ({ page }) => {
    await loginComoSocio(page, { tables: { ...tablasBase(), ...rutina(3) } });
    const soltarRutina = await retener(page, '/rest/v1/routines');
    const soltarHistorial = await retener(page, '/rest/v1/routine_history');

    await irATab(page, 'Mi Rutina');
    await expect(page.getByTestId('rutina-esqueleto')).toBeVisible();
    soltarRutina();
    await expect(page.getByText('Ejercicio 1', { exact: true })).toBeVisible();
    await expect(page.getByTestId('rutina-esqueleto')).toHaveCount(0);

    await page.getByText('Entrenamientos', { exact: true }).click();
    await expect(page.getByTestId('entrenamientos-esqueleto')).toBeVisible();
    soltarHistorial();
    await expect(page.getByText('Quitar de mis entrenamientos', { exact: true })).toBeVisible();
    await expect(page.getByTestId('entrenamientos-esqueleto')).toHaveCount(0);

    const soltarMisRutinas = await retener(page, '/rest/v1/routines');
    await page.getByText('Mis rutinas', { exact: true }).click();
    await expect(page.getByTestId('mis-rutinas-esqueleto')).toBeVisible();
    soltarMisRutinas();
    await expect(page.getByTestId('mis-rutinas-esqueleto')).toHaveCount(0);
  });

  test('Mi Rutina: lo de más abajo espera a entrar en pantalla, y cada tarjeta aparece una sola vez', async ({ page }) => {
    await loginComoSocio(page, { tables: { ...tablasBase(), ...rutina(8) } });
    await page.evaluate(() => {
      const w = window as any;
      w.__arranques = new Map<Element, number>();
      document.addEventListener('animationstart', (e) => {
        w.__arranques.set(e.target, (w.__arranques.get(e.target) ?? 0) + 1);
      });
    });
    await irATab(page, 'Mi Rutina');
    const primera = page.getByText('Ejercicio 1', { exact: true });
    const ultima = page.getByText('Ejercicio 8', { exact: true });
    await expect(primera).toBeVisible();
    await page.waitForTimeout(900);

    // La última está fuera de pantalla: todavía no apareció (su envoltorio
    // sigue invisible y sin animación).
    const antes = await ultima.evaluate((el) => {
      let n: HTMLElement | null = el as HTMLElement;
      while (n && getComputedStyle(n).opacity !== '0') n = n.parentElement;
      return n ? { opacidad: getComputedStyle(n).opacity, animacion: getComputedStyle(n).animationName } : null;
    });
    expect(antes).toEqual({ opacidad: '0', animacion: 'none' });

    // Bajar de a poco hasta el final y volver arriba.
    const desplazar = (delta: number) =>
      page.evaluate((d) => {
        const sc = Array.from(document.querySelectorAll('div')).find(
          (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4
        )!;
        sc.scrollTop += d;
      }, delta);
    for (let i = 0; i < 12; i++) {
      await desplazar(250);
      await page.waitForTimeout(120);
    }
    await expect(ultima).toBeInViewport();
    await page.waitForTimeout(900);
    for (let i = 0; i < 12; i++) {
      await desplazar(-250);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(700);

    const arranques = await page.evaluate(() => Array.from((window as any).__arranques.values()) as number[]);
    // Las 8 tarjetas (más barra, días y "Finalizar") aparecieron, y ninguna dos veces.
    expect(arranques.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...arranques)).toBe(1);
  });

  test('con "reducir movimiento": solo fundido (sin desplazamiento) y el esqueleto quieto', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginComoSocio(page, { tables: { ...tablasBase(), classes: clasesDeManana } });
    await irATab(page, 'Agenda');
    await agendaCargada(page);

    const soltar = await retener(page, '/rest/v1/classes');
    await page.getByText(String(MANANA.getDate()), { exact: true }).first().click();
    const esqueleto = page.getByTestId('agenda-esqueleto');
    await expect(esqueleto).toBeVisible();
    expect(await esqueleto.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

    soltar();
    const tercera = page.getByTestId('agenda-card-m-2');
    await expect(tercera).toBeVisible();
    await esperarQueArranque(tercera);
    expect(await fotogramas(tercera)).toEqual([
      [
        { opacity: '0', transform: null },
        { opacity: '1', transform: null },
      ],
    ]);
  });
});
