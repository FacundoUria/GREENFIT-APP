import { test, expect, Page } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { mockSupabase } from './support/supabaseMock';
import { tablasBase, CLASE_HOY, DISCIPLINA_CROSSFIT, EN_30_DIAS, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Tanda visual, parte 1 (base), en un navegador real:
// * index.html: viewport-fit=cover (zonas seguras), theme-color igual al fondo
//   y sin el resaltado que pinta el navegador al tocar;
// * nada tocable de menos de 44 px en Inicio, Agenda y Mi Rutina, a 360 px de
//   ancho (Android común). hitSlop no cuenta: react-native-web lo ignora;
// * al apoyar el dedo, la tarjeta se achica a 0.96 con una transición de 200 ms.

test.use({ viewport: { width: 360, height: 760 } });

const RUTINA = {
  id: 'r-1', user_id: SOCIO_DEMO.id, title: 'Full Body', coach_name: 'Seba', notes: null, created_at: '2026-08-01T00:00:00.000Z',
};
const DIA_1 = {
  id: 'd-1', routine_id: 'r-1', title: 'Día 1', order_index: 0,
  routine_exercises: [
    {
      id: 're-1', sets: 4, reps: '10', rest_seconds: 60, weight_suggestion: '20kg', notes: 'Codos pegados', order_index: 0,
      exercise: { id: 'ex-1', name: 'Press de banca', muscle_group: 'Pecho', description: null, video_url: 'https://example.com/v.mp4' },
    },
  ],
};
const DIA_2 = { ...DIA_1, id: 'd-2', title: 'Día 2', order_index: 1, routine_exercises: [] };

const CREDITO = {
  id: 'uc-1', user_id: SOCIO_DEMO.id, discipline: DISCIPLINA_CROSSFIT, remaining_credits: 5,
  expires_at: EN_30_DIAS, created_at: '2026-01-01T00:00:00.000Z',
};

// Todo lo tocable que se ve (o está apenas más abajo) y mide menos de 44x44.
// Se mide con las apariciones (parte 2) ya terminadas: en plena animación el
// rect sale con decimales (43.99) por el transform del envoltorio.
async function tocablesChicos(page: Page): Promise<string[]> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)
  );
  return page.evaluate(() => {
    const sel = '[role="button"],[role="tab"],[role="checkbox"],[role="link"],input,textarea,[tabindex="0"]';
    const out: string[] = [];
    for (const el of Array.from(new Set(document.querySelectorAll(sel)))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight * 3) continue;
      if (getComputedStyle(el as HTMLElement).visibility === 'hidden') continue;
      if (r.width >= 44 && r.height >= 44) continue;
      const nombre = ((el as HTMLElement).getAttribute('aria-label') || (el as HTMLElement).innerText || el.tagName)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50);
      out.push(`${Math.round(r.width)}x${Math.round(r.height)} ${nombre}`);
    }
    return out;
  });
}

test.describe('PWA -- base de la tanda visual (toque, zonas seguras, theme-color)', () => {
  test.beforeEach(async ({ page }) => {
    // A las 8 de hoy: la clase de las 19 se puede reservar (misma base que agenda.spec.ts).
    const hoyALasOcho = new Date();
    hoyALasOcho.setHours(8, 0, 0, 0);
    await page.clock.install({ time: hoyALasOcho });
  });

  test('index.html: viewport-fit=cover, theme-color igual al fondo y sin resaltado del navegador al tocar', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#0D0D0E');
    const resaltado = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color').replace(/\s/g, '')
    );
    expect(resaltado).toBe('rgba(0,0,0,0)');
  });

  test('Inicio con una reserva próxima: nada tocable de menos de 44 px', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        user_credits: [CREDITO],
        bookings: [
          {
            id: 'booking-1', user_id: SOCIO_DEMO.id, class_id: CLASE_HOY.id, booking_date: HOY_STR, attended: false,
            classes: { title: 'CrossFit', start_time: '23:59:00' },
          },
        ],
      },
    });
    await expect(page.getByText('Cancelar', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page)).toEqual([]);
  });

  // "Renovar" y "Hablar con Seba": aparecen cuando el socio no tiene nada
  // vigente pero tuvo algo (acá, CrossFit vencido).
  test('Inicio con el plan vencido ("Renovar" / "Hablar con Seba"): nada tocable de menos de 44 px', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        user_credits: [{ ...CREDITO, id: 'uc-vencido', remaining_credits: 0, expires_at: '2026-01-31T23:59:59.999-03:00' }],
      },
    });
    await expect(page.getByText('Renovar', { exact: true })).toBeVisible();
    await expect(page.getByText('Hablar con Seba', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page)).toEqual([]);
  });

  test('Inicio sin ningún pack ("Elegir mi pack"): nada tocable de menos de 44 px', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });
    await expect(page.getByText('Elegir mi pack', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page)).toEqual([]);
  });

  test('Agenda y las tres pestañas de Mi Rutina: nada tocable de menos de 44 px', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        classes: [CLASE_HOY],
        user_credits: [CREDITO],
        routines: [RUTINA],
        routine_days: [DIA_1, DIA_2],
        routine_completions: [],
        user_exercise_weights: [],
        routine_history: [
          {
            id: 'h-1', user_id: SOCIO_DEMO.id, sesion_id: 's-1', fecha: HOY_STR, titulo_dia: 'Día 1', nombre_ejercicio: 'Press de banca',
            grupo_muscular: 'Pecho', series: 4, repeticiones: '10', peso: '22kg', orden: 0, total_ejercicios: 1, completo: true,
            created_at: `${HOY_STR}T12:05:00.000Z`, oculta_en: null,
          },
        ],
      },
    });

    await irATab(page, 'Agenda');
    await expect(page.getByTestId(`agenda-card-${CLASE_HOY.id}`)).toBeVisible();
    expect(await tocablesChicos(page), 'Agenda').toEqual([]);

    await irATab(page, 'Mi Rutina');
    await expect(page.getByText('Press de banca').first()).toBeVisible();
    expect(await tocablesChicos(page), 'Rutina de hoy').toEqual([]);

    await page.getByText('Entrenamientos', { exact: true }).click();
    await expect(page.getByText('Quitar de mis entrenamientos', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page), 'Entrenamientos').toEqual([]);

    await page.getByText('Mis rutinas', { exact: true }).click();
    await expect(page.getByText('HISTORIAL DE RUTINAS', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page), 'Mis rutinas').toEqual([]);
  });

  test('al apoyar el dedo, la tarjeta de Agenda se achica a 0.96 (200 ms) y al soltar vuelve', async ({ page }) => {
    await loginComoSocio(page, { tables: { ...tablasBase(), classes: [CLASE_HOY], user_credits: [CREDITO] } });
    await irATab(page, 'Agenda');
    const tarjeta = page.getByTestId(`agenda-card-${CLASE_HOY.id}`);
    await expect(tarjeta).toBeVisible();
    const caja = (await tarjeta.boundingBox())!;

    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
    await expect
      .poll(() => tarjeta.evaluate((el) => getComputedStyle(el).transform))
      .toBe('matrix(0.96, 0, 0, 0.96, 0, 0)');
    const transicion = await tarjeta.evaluate((el) => {
      const s = getComputedStyle(el);
      return { propiedad: s.transitionProperty, duracion: s.transitionDuration, curva: s.transitionTimingFunction };
    });
    expect(transicion).toEqual({ propiedad: 'transform, opacity', duracion: '0.2s', curva: 'cubic-bezier(0.22, 1, 0.36, 1)' });

    // Soltar afuera de la tarjeta: no reserva, y vuelve a su tamaño.
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await expect.poll(() => tarjeta.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await expect(page.getByText('Confirmar', { exact: true })).toHaveCount(0);
  });

  // Parte 2: Comunidad y Perfil también pasaron al achique (toda la app igual).
  test('Comunidad y Perfil: los botones también se achican a 0.96 al apoyar el dedo', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    // El botón tocable que contiene al elemento (el que tiene la transición).
    const apoyarYMedir = async (elemento: ReturnType<Page['getByText']>) => {
      await expect(elemento).toBeVisible();
      const caja = (await elemento.boundingBox())!;
      await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
      await page.mouse.down();
      const medir = () =>
        elemento.evaluate((el) => {
          let n: HTMLElement | null = el as HTMLElement;
          while (n && !getComputedStyle(n).transitionProperty.includes('transform')) n = n.parentElement;
          return n ? getComputedStyle(n).transform : 'sin tocable';
        });
      await expect.poll(medir).toBe('matrix(0.96, 0, 0, 0.96, 0, 0)');
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await expect.poll(medir).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    };

    await irATab(page, 'Comunidad');
    await apoyarYMedir(page.getByText('Ranking', { exact: true }));

    await irATab(page, 'Perfil');
    await apoyarYMedir(page.getByLabel('Cerrar sesión'));
  });
});

// Tanda visual, parte 4: las áreas de toque chicas que quedaban fuera de
// Inicio, Agenda y Mi Rutina, llevadas a 44 px.
test.describe('PWA -- áreas de toque de 44 px fuera de las pestañas principales (tanda visual, parte 4)', () => {
  test('Login: el botón de instalar, y la X y "Entendido" de su tarjeta', async ({ page }) => {
    await mockSupabase(page, { user: SOCIO_DEMO, tables: tablasBase(), rpc: {} });
    await page.goto('/');
    await expect(page.getByPlaceholder('DNI')).toBeVisible();
    expect(await tocablesChicos(page), 'Login').toEqual([]);

    await page.getByLabel('Instalar Greenfit como app').click();
    await expect(page.getByText('Instalá Greenfit', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page), 'tarjeta "Instalá Greenfit"').toEqual([]);
  });

  test('Notificaciones: los 3 filtros y "Marcar todas como leídas"', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        notifications: [{ id: 'n-1', title: 'Aviso', body: 'Mañana abrimos 8 hs.', created_at: new Date().toISOString(), audience_type: 'all' }],
      },
    });
    await page.getByLabel('Ver notificaciones').click();
    await expect(page.getByText('Marcar todas como leídas', { exact: true })).toBeVisible();
    // La flecha "Go back" del encabezado (React Navigation, 30x30) no estaba
    // en esta parte: queda anotada como pendiente en PLAN_TANDA_VISUAL.md.
    const chicos = (await tocablesChicos(page)).filter((t) => !/ Go back$/.test(t));
    expect(chicos).toEqual([]);
  });

  test('Comunidad (Feed, Mensajes, Ranking) y Perfil ("Cerrar sesión", "¿Cómo ganar XP?")', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });
    await irATab(page, 'Comunidad');
    await expect(page.getByText('Ranking', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page), 'Comunidad').toEqual([]);

    await irATab(page, 'Perfil');
    await expect(page.getByLabel('Cerrar sesión')).toBeVisible();
    expect(await tocablesChicos(page), 'Perfil').toEqual([]);
    // 44x44 justos: el área crece alrededor del ícono (márgenes negativos), no la fila.
    const tamano = async (etiqueta: string) => {
      // .filter visible: el de Inicio también está montado (pestaña oculta).
      const caja = (await page.getByLabel(etiqueta).filter({ visible: true }).boundingBox())!;
      return { ancho: Math.round(caja.width), alto: Math.round(caja.height) };
    };
    expect(await tamano('Cerrar sesión')).toEqual({ ancho: 44, alto: 44 });
    expect(await tamano('¿Cómo ganar XP?')).toEqual({ ancho: 44, alto: 44 });
  });

  test('Comprobante de transferencia: "Volver"', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        packs: [
          { id: 'pack-1', name: 'Pack 12 clases CrossFit', price: 30000, is_active: true, incluye_aparatos: false, dias_vigencia: null, creditos: [{ discipline_id: DISCIPLINA_CROSSFIT.id, credits: 12 }] },
        ],
      },
    });
    await page.getByText('Elegir mi pack', { exact: true }).click();
    await page.getByText('Pack 12 clases CrossFit', { exact: true }).click();
    await expect(page.getByText('Pagar por transferencia', { exact: true })).toBeVisible();
    expect(await tocablesChicos(page), 'Comprobante').toEqual([]);
  });
});
