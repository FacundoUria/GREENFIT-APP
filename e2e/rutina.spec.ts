import { test, expect, Page } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Rutina de 1 día, 2 ejercicios en 2 grupos musculares distintos -- alcanza
// para cubrir agrupación por grupo + checklist + cierre, sin necesitar el
// selector de días (ese ya tiene su propio criterio, no es parte de este
// checklist de rediseño).
const ROUTINE = {
  id: 'e2e-routine-1',
  user_id: SOCIO_DEMO.id,
  title: 'Rutina Full Body',
  coach_name: 'Seba',
  notes: null,
  created_at: '2026-08-01T00:00:00.000Z',
};

const DAY_1 = {
  id: 'e2e-day-1',
  routine_id: ROUTINE.id,
  title: 'Día 1',
  order_index: 0,
  routine_exercises: [
    {
      id: 'e2e-re-1',
      sets: 4,
      reps: '10-12',
      rest_seconds: 60,
      weight_suggestion: '20kg',
      notes: null,
      order_index: 0,
      exercise: { id: 'ex-1', name: 'Press de banca', muscle_group: 'Pecho', description: null, video_url: null },
    },
    {
      id: 'e2e-re-2',
      sets: 3,
      reps: '12',
      rest_seconds: 45,
      weight_suggestion: null,
      notes: 'Codos pegados al cuerpo',
      order_index: 1,
      exercise: { id: 'ex-2', name: 'Fondos en banco', muscle_group: 'Tríceps', description: null, video_url: null },
    },
  ],
};

// Respuesta real de finalizar_entrenamiento() cuando registra. Antes estos
// tests no la configuraban y dependían de que, sin la función, la pantalla
// festejara igual SIN guardar nada -- ese "fallo silencioso" ya no existe
// (ahora es un error visible), así que se configura explícitamente.
const FINALIZAR_OK = () => ({
  registrado: true,
  sesion_id: 'e2e-sesion',
  motivo: null,
  disponible_desde: new Date(Date.now() + 10_000).toISOString(),
});

test.describe('PWA -- Mi Rutina (rediseño checklist accesible)', () => {
  test('agrupa por grupo muscular, marca ejercicios y actualiza el indicador de progreso', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), routines: [ROUTINE], routine_days: [DAY_1], routine_completions: [] },
      rpc: { finalizar_entrenamiento: FINALIZAR_OK },
    });

    await irATab(page, 'Mi Rutina');

    // Header HUD: avatar + primer nombre real del socio (sin "MODO ATLETA"); la barra de
    // sesión muestra el nombre del día.
    await expect(page.getByText('MODO ATLETA', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Facundo', { exact: true })).toBeVisible();
    await expect(page.getByText('Día 1', { exact: true })).toBeVisible();
    // Cada tarjeta lleva número + grupo muscular ("01 • PECHO").
    await expect(page.getByText('01 • PECHO', { exact: true })).toBeVisible();
    await expect(page.getByText('02 • TRÍCEPS', { exact: true })).toBeVisible();
    await expect(page.getByText('Press de banca')).toBeVisible();
    await expect(page.getByText('Fondos en banco')).toBeVisible();

    // Contador X/Y de la barra de sesión (junto a la barra de progreso).
    await expect(page.getByText('0/2', { exact: true })).toBeVisible();

    await page.getByLabel('Marcar Press de banca como completado').click();
    await expect(page.getByText('1/2', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Press de banca, completado')).toBeVisible();

    await page.getByLabel('Marcar Fondos en banco como completado').click();
    await expect(page.getByText('2/2', { exact: true })).toBeVisible();

    // Botón de cierre -- gatilla el modal gratificante en vez del
    // Alert.alert() anterior (no-op mudo en react-native-web).
    await page.getByText('Finalizar Entrenamiento', { exact: true }).click();
    await expect(page.getByText('¡Rutina completa! 🔥')).toBeVisible();
    await expect(page.getByText('Genial')).toBeVisible();
  });

  test('cerrar el entreno sin completar todo muestra el copy de progreso parcial', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), routines: [ROUTINE], routine_days: [DAY_1], routine_completions: [] },
      rpc: { finalizar_entrenamiento: FINALIZAR_OK },
    });

    await irATab(page, 'Mi Rutina');
    await page.getByLabel('Marcar Press de banca como completado').click();
    await expect(page.getByText('1/2', { exact: true })).toBeVisible();

    await page.getByText('Finalizar Entrenamiento', { exact: true }).click();
    await expect(page.getByText('¡Buen entrenamiento! 💪')).toBeVisible();
    await expect(page.getByText('Llevás 1 de 2 ejercicios de hoy -- lo que sumaste ya cuenta.')).toBeVisible();
  });

  test('la Carga arranca en la sugerencia del entrenador y editarla la guarda de verdad (no solo en memoria)', async ({
    page,
  }) => {
    const tablas = {
      ...tablasBase(),
      routines: [ROUTINE],
      routine_days: [DAY_1],
      routine_completions: [],
      user_exercise_weights: [] as any[],
    };
    await loginComoSocio(page, { tables: tablas });

    await irATab(page, 'Mi Rutina');

    // Press de banca (weight_suggestion: '20kg') todavía no tiene una carga
    // real guardada por el socio -- arranca mostrando la sugerencia.
    const cargaPressBanca = page.getByLabel('Carga (kg) usada en este ejercicio').first();
    await expect(cargaPressBanca).toHaveValue('20kg');

    await cargaPressBanca.fill('25kg');
    await cargaPressBanca.blur();

    // Quedó guardado en el mock (user_exercise_weights), no solo en memoria,
    // y atado al EJERCICIO (ex-1), no a la fila de la rutina (e2e-re-1) --
    // refleja lo que en producción persiste vía saveExerciseWeight.
    await expect
      .poll(() =>
        tablas.user_exercise_weights.some((w: any) => w.exercise_id === 'ex-1' && w.weight_used === '25kg')
      )
      .toBe(true);
    expect(tablas.user_exercise_weights.every((w: any) => !('routine_exercise_id' in w))).toBe(true);
  });

  test('si el socio ya había guardado una carga antes, la ve precargada en vez de la sugerencia del entrenador', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        routines: [ROUTINE],
        routine_days: [DAY_1],
        routine_completions: [],
        // Ya cargó 25kg en una sesión anterior -- distinto de los 20kg que
        // sugiere el entrenador (weight_suggestion de Press de banca).
        user_exercise_weights: [{ id: 'w-1', user_id: SOCIO_DEMO.id, exercise_id: 'ex-1', weight_used: '25kg' }],
      },
    });

    await irATab(page, 'Mi Rutina');
    await expect(page.getByLabel('Carga (kg) usada en este ejercicio').first()).toHaveValue('25kg');
  });

  test('si Seba re-guardó la rutina (filas con ids nuevos, mismo ejercicio), la carga guardada se sigue viendo', async ({
    page,
  }) => {
    // Lo que deja el panel Admin después de saveRoutineFull: día y filas
    // recreados con ids NUEVOS, pero el mismo exercise_id en cada fila.
    const DIA_REGUARDADO = {
      ...DAY_1,
      id: 'e2e-day-1-nuevo',
      routine_exercises: DAY_1.routine_exercises.map((re) => ({ ...re, id: `${re.id}-nuevo` })),
    };
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        routines: [ROUTINE],
        routine_days: [DIA_REGUARDADO],
        routine_completions: [],
        // La carga la guardó ANTES de que Seba re-guardara la rutina.
        user_exercise_weights: [{ id: 'w-1', user_id: SOCIO_DEMO.id, exercise_id: 'ex-1', weight_used: '27.5kg' }],
      },
    });

    await irATab(page, 'Mi Rutina');
    await expect(page.getByLabel('Carga (kg) usada en este ejercicio').first()).toHaveValue('27.5kg');
  });
});

test.describe('PWA -- Mi Rutina: historial de entrenamientos', () => {
  test('Finalizar guarda lo marcado (con el peso actual) y aparece en la pestaña Historial', async ({ page }) => {
    const tablas = {
      ...tablasBase(),
      routines: [ROUTINE],
      routine_days: [DAY_1],
      routine_completions: [],
      user_exercise_weights: [],
      routine_history: [] as any[],
    };
    const llamadas: any[] = [];
    // Emula finalizar_entrenamiento(): inserta una fila por ejercicio
    // marcado, todas con el mismo sesion_id -- así el GET posterior de la
    // pestaña Historial lee lo que se acaba de guardar.
    const rpc = {
      finalizar_entrenamiento: (request: any) => {
        const body = request.postDataJSON();
        llamadas.push(body);
        const ahora = new Date().toISOString();
        body.p_items.forEach((item: any, i: number) =>
          tablas.routine_history.push({
            id: `h-${i}`,
            user_id: SOCIO_DEMO.id,
            sesion_id: 'sesion-e2e-1',
            fecha: HOY_STR,
            titulo_dia: body.p_titulo_dia,
            nombre_ejercicio: item.nombre,
            grupo_muscular: item.grupo,
            series: item.series,
            repeticiones: item.repeticiones,
            peso: item.peso,
            orden: i,
            total_ejercicios: body.p_total_ejercicios,
            completo: body.p_items.length === body.p_total_ejercicios,
            created_at: ahora,
          })
        );
        return { registrado: true, sesion_id: 'sesion-e2e-1', disponible_desde: ahora };
      },
    };
    await loginComoSocio(page, { tables: tablas, rpc });
    await irATab(page, 'Mi Rutina');

    // 0 marcados -> bloquea sin llamar al servidor.
    await page.getByText('Finalizar Entrenamiento', { exact: true }).click();
    await expect(page.getByText('Marcá al menos un ejercicio para finalizar el entrenamiento.')).toBeVisible();
    expect(llamadas).toHaveLength(0);

    // Cambia la carga de Press de banca y marca solo ese (1 de 2).
    const carga = page.getByLabel('Carga (kg) usada en este ejercicio').first();
    await carga.fill('25kg');
    await carga.blur();
    await page.getByLabel('Marcar Press de banca como completado').click();
    await page.getByText('Finalizar Entrenamiento', { exact: true }).click();

    await expect(page.getByText('¡Buen entrenamiento! 💪')).toBeVisible();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toEqual({
      p_titulo_dia: 'Día 1',
      p_total_ejercicios: 2,
      p_items: [{ nombre: 'Press de banca', grupo: 'Pecho', series: 4, repeticiones: '10-12', peso: '25kg' }],
    });
    await page.getByText('Genial', { exact: true }).click();

    await page.getByText('Historial', { exact: true }).click();
    await expect(page.getByText('Press de banca')).toBeVisible();
    await expect(page.getByText('25kg')).toBeVisible();
    await expect(page.getByText('4 × 10-12')).toBeVisible();
    // Parcial: resumen del día + badge de la sesión.
    await expect(page.getByText('1 de 2 ejercicios').first()).toBeVisible();
    // No se ve el ejercicio que NO se marcó.
    await expect(page.getByText('Fondos en banco')).toHaveCount(0);
  });

  test('si el servidor responde "reciente" (ventana de 10 s), avisa y no muestra el festejo', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), routines: [ROUTINE], routine_days: [DAY_1], routine_completions: [] },
      rpc: {
        finalizar_entrenamiento: {
          registrado: false,
          sesion_id: null,
          motivo: 'reciente',
          disponible_desde: new Date(Date.now() + 10_000).toISOString(),
        },
      },
    });
    await irATab(page, 'Mi Rutina');

    await page.getByLabel('Marcar Press de banca como completado').click();
    await page.getByText('Finalizar Entrenamiento', { exact: true }).click();

    await expect(page.getByText('Ya registraste este entrenamiento recién.', { exact: true })).toBeVisible();
    await expect(page.getByText('¡Buen entrenamiento! 💪')).toHaveCount(0);
  });

  test('si el servidor responde "tope_diario", avisa del máximo de 20 por día', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), routines: [ROUTINE], routine_days: [DAY_1], routine_completions: [] },
      rpc: {
        finalizar_entrenamiento: { registrado: false, sesion_id: null, motivo: 'tope_diario', disponible_desde: null },
      },
    });
    await irATab(page, 'Mi Rutina');

    await page.getByLabel('Marcar Press de banca como completado').click();
    await page.getByText('Finalizar Entrenamiento', { exact: true }).click();

    await expect(
      page.getByText('Llegaste al máximo de 20 entrenamientos registrados por hoy.', { exact: true })
    ).toBeVisible();
  });

  test('Historial: "Eliminar" pide confirmación y borra la sesión completa por el RPC', async ({ page }) => {
    const fila = (overrides: Record<string, unknown>) => ({
      user_id: SOCIO_DEMO.id,
      fecha: HOY_STR,
      titulo_dia: 'Día 1',
      grupo_muscular: 'Pecho',
      series: 4,
      repeticiones: '10-12',
      orden: 0,
      total_ejercicios: 2,
      ...overrides,
    });
    const tablas = {
      ...tablasBase(),
      routines: [ROUTINE],
      routine_days: [DAY_1],
      routine_completions: [],
      routine_history: [
        fila({ id: 'h-1', sesion_id: 's-dup', nombre_ejercicio: 'Press de banca', peso: '22kg', completo: false, created_at: `${HOY_STR}T12:05:00.000Z` }),
        fila({ id: 'h-2', sesion_id: 's-ok', nombre_ejercicio: 'Press de banca', peso: '24kg', completo: true, created_at: `${HOY_STR}T21:40:00.000Z` }),
        fila({ id: 'h-3', sesion_id: 's-ok', nombre_ejercicio: 'Fondos en banco', peso: null, orden: 1, completo: true, created_at: `${HOY_STR}T21:40:00.000Z` }),
      ] as any[],
    };
    const llamadas: any[] = [];
    // Emula eliminar_sesion_historial(): borra TODAS las filas de esa sesión del socio.
    const rpc = {
      eliminar_sesion_historial: (request: any) => {
        const { p_sesion_id } = request.postDataJSON();
        llamadas.push(p_sesion_id);
        const antes = tablas.routine_history.length;
        tablas.routine_history = tablas.routine_history.filter((f) => f.sesion_id !== p_sesion_id);
        return antes - tablas.routine_history.length;
      },
    };
    await loginComoSocio(page, { tables: tablas, rpc });
    await irATab(page, 'Mi Rutina');
    await page.getByText('Historial', { exact: true }).click();
    await expect(page.getByText('2 registrados', { exact: true })).toBeVisible();

    // La de las 09:05 (12:05 UTC) quedó duplicada/errónea: se elimina.
    await page.getByLabel(/Eliminar entrenamiento del .* a las 09:05/).click();
    await expect(page.getByText('¿Eliminar este entrenamiento?', { exact: true })).toBeVisible();

    // Cancelar no borra nada.
    await page.getByText('Cancelar', { exact: true }).click();
    await expect(page.getByText('¿Eliminar este entrenamiento?', { exact: true })).toHaveCount(0);
    expect(llamadas).toHaveLength(0);

    await page.getByLabel(/Eliminar entrenamiento del .* a las 09:05/).click();
    await page.getByLabel('Confirmar eliminar entrenamiento').click();

    await expect(page.getByText('1 registrado', { exact: true })).toBeVisible();
    expect(llamadas).toEqual(['s-dup']);
    await expect(page.getByText('22kg', { exact: true })).toHaveCount(0);
    // La otra sesión sigue entera.
    await expect(page.getByText('24kg', { exact: true })).toBeVisible();
    await expect(page.getByText('Fondos en banco')).toBeVisible();
  });

  test('Historial: dos entrenamientos del mismo día son dos tarjetas separadas, con series, reps y peso', async ({
    page,
  }) => {
    const fila = (overrides: Record<string, unknown>) => ({
      user_id: SOCIO_DEMO.id,
      fecha: HOY_STR,
      grupo_muscular: 'Pecho',
      orden: 0,
      ...overrides,
    });
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        routines: [ROUTINE],
        routine_days: [DAY_1],
        routine_completions: [],
        routine_history: [
          // Mañana: incompleta (1 de 2).
          fila({
            id: 'h-1', sesion_id: 's-manana', titulo_dia: 'Día 1', nombre_ejercicio: 'Press de banca',
            series: 4, repeticiones: '10-12', peso: '22kg', total_ejercicios: 2, completo: false,
            created_at: `${HOY_STR}T12:05:00.000Z`,
          }),
          // Tarde: completa (2 de 2).
          fila({
            id: 'h-2', sesion_id: 's-tarde', titulo_dia: 'Día 1', nombre_ejercicio: 'Press de banca',
            series: 4, repeticiones: '10-12', peso: '24kg', total_ejercicios: 2, completo: true,
            created_at: `${HOY_STR}T21:40:00.000Z`,
          }),
          fila({
            id: 'h-3', sesion_id: 's-tarde', titulo_dia: 'Día 1', nombre_ejercicio: 'Fondos en banco',
            grupo_muscular: 'Tríceps', series: 3, repeticiones: '12', peso: null, orden: 1,
            total_ejercicios: 2, completo: true, created_at: `${HOY_STR}T21:40:00.000Z`,
          }),
        ],
      },
    });
    await irATab(page, 'Mi Rutina');
    await page.getByText('Historial', { exact: true }).click();

    await expect(page.getByText('2 registrados', { exact: true })).toBeVisible();
    // Una hora por tarjeta (09:05 y 18:40 en Argentina).
    await expect(page.getByText('09:05 hs', { exact: true })).toBeVisible();
    await expect(page.getByText('18:40 hs', { exact: true })).toBeVisible();
    // Cada ejercicio: nombre + series × reps + peso.
    await expect(page.getByText('22kg', { exact: true })).toBeVisible();
    await expect(page.getByText('24kg', { exact: true })).toBeVisible();
    await expect(page.getByText('4 × 10-12', { exact: true })).toHaveCount(2);
    await expect(page.getByText('3 × 12', { exact: true })).toBeVisible();
    await expect(page.getByText('Sin carga', { exact: true })).toBeVisible();
    // La de la mañana quedó incompleta; la de la tarde, completa.
    await expect(page.getByText('1 de 2 ejercicios', { exact: true })).toBeVisible();
    await expect(page.getByText('Completo', { exact: true })).toBeVisible();
    // Solo lectura: nada de "Repetir" ni favoritos.
    await expect(page.getByText(/Repetir|Favorita/)).toHaveCount(0);
  });
});

// ── Recarga de Mi Rutina (foco / primer plano / cambio de día) ──────────────
// Bug real: Seba re-guardaba la rutina desde el panel (el Admin borra y
// recrea los routine_exercises con ids NUEVOS) con la app del socio abierta;
// la pantalla seguía con los ids viejos y marcar fallaba con el error crudo
// de Postgres (23503, FK). El mock de Supabase de los e2e no valida FKs, así
// que cada test que lo necesita registra su propia ruta para
// routine_completions (la última ruta registrada gana en Playwright).

const DIA_REGUARDADO = {
  ...DAY_1,
  id: 'e2e-day-1-nuevo',
  routine_exercises: DAY_1.routine_exercises.map((re) => ({ ...re, id: `${re.id}-nuevo` })),
};

function tablasRecarga() {
  return {
    ...tablasBase(),
    routines: [ROUTINE],
    routine_days: [DAY_1] as any[],
    routine_completions: [] as any[],
    user_exercise_weights: [] as any[],
  };
}

// Responde 23503 (como Postgres) si se marca un routine_exercise que ya no
// está en la rutina actual del fixture; si existe, deja pasar al mock común.
async function validarFkDeCompletions(page: Page, tablas: ReturnType<typeof tablasRecarga>) {
  await page.route(
    (url) => url.pathname === '/rest/v1/routine_completions',
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const fila = route.request().postDataJSON();
      const existe = tablas.routine_days.some((d: any) =>
        d.routine_exercises.some((re: any) => re.id === fila.routine_exercise_id)
      );
      if (existe) return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: '23503',
          message:
            'insert or update on table "routine_completions" violates foreign key constraint "routine_completions_routine_exercise_id_fkey"',
          details: null,
          hint: null,
        }),
      });
    }
  );
}

// Lo que hace el navegador al ir a segundo plano y volver (react-native-web
// implementa AppState sobre visibilitychange).
async function segundoPlanoYVuelta(page: Page) {
  await page.evaluate(() => {
    const poner = (estado: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => estado === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    poner('hidden');
    poner('visible');
  });
}

function contarPedidosDeRutina(page: Page) {
  const contador = { n: 0 };
  page.on('request', (req) => {
    if (req.method() === 'GET' && new URL(req.url()).pathname === '/rest/v1/routines') contador.n += 1;
  });
  return contador;
}

function fechaLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('PWA -- Mi Rutina: recarga con la app abierta', () => {
  test('Seba re-guarda la rutina con la pantalla abierta: al volver a la pestaña marcar usa los ids nuevos', async ({
    page,
  }) => {
    const tablas = tablasRecarga();
    await loginComoSocio(page, { tables: tablas });
    await validarFkDeCompletions(page, tablas);
    await irATab(page, 'Mi Rutina');
    await expect(page.getByText('Press de banca')).toBeVisible();

    // Seba re-guarda desde el panel mientras tanto.
    tablas.routine_days[0] = DIA_REGUARDADO;

    await irATab(page, 'Inicio');
    await irATab(page, 'Mi Rutina');
    await page.getByLabel('Marcar Press de banca como completado').click();

    await expect(page.getByLabel('Press de banca, completado')).toBeVisible();
    await expect
      .poll(() => tablas.routine_completions.some((c: any) => c.routine_exercise_id === 'e2e-re-1-nuevo'))
      .toBe(true);
  });

  test('23503 sin salir de la pantalla: aviso con título y mensaje entendibles, recarga sola y se puede volver a marcar', async ({
    page,
  }) => {
    const tablas = tablasRecarga();
    await loginComoSocio(page, { tables: tablas });
    await validarFkDeCompletions(page, tablas);
    await irATab(page, 'Mi Rutina');
    await expect(page.getByText('Press de banca')).toBeVisible();

    tablas.routine_days[0] = DIA_REGUARDADO;

    const dialogo = page.waitForEvent('dialog');
    await page.getByLabel('Marcar Press de banca como completado').click();
    const d = await dialogo;
    // window.alert en web: título Y mensaje (antes el título se perdía), sin el texto de Postgres.
    expect(d.message()).toBe(
      'Tu rutina se actualizó\n\nTu entrenador hizo cambios. Volvé a marcar los ejercicios que ya hiciste.'
    );
    expect(d.message()).not.toContain('foreign key');
    await d.accept();

    // El tilde volvió atrás; marcar de nuevo ya va con el id nuevo y queda guardado.
    await page.getByLabel('Marcar Press de banca como completado').click();
    await expect(page.getByLabel('Press de banca, completado')).toBeVisible();
    await expect
      .poll(() => tablas.routine_completions.some((c: any) => c.routine_exercise_id === 'e2e-re-1-nuevo'))
      .toBe(true);
  });

  test('volver a primer plano con la pestaña abierta recarga la rutina', async ({ page }) => {
    const tablas = tablasRecarga();
    const pedidos = contarPedidosDeRutina(page);
    await loginComoSocio(page, { tables: tablas });
    await irATab(page, 'Mi Rutina');
    await expect(page.getByText('Press de banca')).toBeVisible();
    const antes = pedidos.n;

    const primero = DIA_REGUARDADO.routine_exercises[0];
    tablas.routine_days[0] = {
      ...DIA_REGUARDADO,
      routine_exercises: [{ ...primero, exercise: { ...primero.exercise, name: 'Press inclinado' } }],
    };
    await segundoPlanoYVuelta(page);

    await expect(page.getByText('Press inclinado')).toBeVisible();
    expect(pedidos.n).toBe(antes + 1);
  });

  test('una Carga escrita y NO guardada sigue ahí después de volver a primer plano (y no se guardó sola)', async ({
    page,
  }) => {
    const tablas = tablasRecarga();
    const pedidos = contarPedidosDeRutina(page);
    await loginComoSocio(page, { tables: tablas });
    await irATab(page, 'Mi Rutina');
    const carga = page.getByLabel('Carga (kg) usada en este ejercicio').first();
    await expect(carga).toHaveValue('20kg');
    const antes = pedidos.n;

    await carga.fill('55kg'); // sin salir del campo: todavía no se guardó

    // Además la rutina se re-guardó con ids nuevos (la fila se vuelve a montar).
    tablas.routine_days[0] = DIA_REGUARDADO;
    await segundoPlanoYVuelta(page);
    await expect.poll(() => pedidos.n).toBe(antes + 1);

    await expect(page.getByLabel('Carga (kg) usada en este ejercicio').first()).toHaveValue('55kg');
    expect(tablas.user_exercise_weights).toHaveLength(0);
  });
});

test.describe('PWA -- Mi Rutina: cambio de día con la app abierta', () => {
  test('pasada la medianoche no marca con la fecha de ayer: avisa, recarga y los tildes de ayer no aparecen', async ({
    page,
  }) => {
    const casiMedianoche = new Date();
    casiMedianoche.setHours(23, 58, 0, 0);
    const ayer = fechaLocal(casiMedianoche);
    const manana = new Date(casiMedianoche);
    manana.setDate(manana.getDate() + 1);
    manana.setHours(0, 1, 0, 0);
    const hoy = fechaLocal(manana);
    await page.clock.install({ time: casiMedianoche });

    const tablas = tablasRecarga();
    // "Ayer" (23:58) ya había marcado Press de banca.
    tablas.routine_completions.push({
      id: 'c-ayer',
      user_id: SOCIO_DEMO.id,
      routine_exercise_id: 'e2e-re-1',
      completed_date: ayer,
    });
    await loginComoSocio(page, { tables: tablas });
    await irATab(page, 'Mi Rutina');
    await expect(page.getByLabel('Press de banca, completado')).toBeVisible();

    // Pasa la medianoche con la app abierta.
    await page.clock.setSystemTime(manana);

    // Este aviso sale en el MISMO click (sin esperar al servidor): el
    // diálogo se acepta desde el listener, si no el click queda bloqueado.
    const mensajes: string[] = [];
    page.once('dialog', async (dialogo) => {
      mensajes.push(dialogo.message());
      await dialogo.accept();
    });
    await page.getByLabel('Marcar Fondos en banco como completado').click();
    await expect.poll(() => mensajes).toEqual(['Empezó un nuevo día\n\nTu rutina se actualizó.']);

    // Recargó con la fecha nueva: el tilde de ayer ya no aparece.
    await expect(page.getByLabel('Marcar Press de banca como completado')).toBeVisible();
    expect(tablas.routine_completions).toHaveLength(1); // no se escribió nada con la fecha vieja

    // Marcar ahora va con la fecha de hoy.
    await page.getByLabel('Marcar Fondos en banco como completado').click();
    await expect
      .poll(() => tablas.routine_completions.find((c: any) => c.routine_exercise_id === 'e2e-re-2')?.completed_date)
      .toBe(hoy);
  });
});
