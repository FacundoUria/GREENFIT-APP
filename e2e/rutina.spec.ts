import { test, expect } from '@playwright/test';
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

test.describe('PWA -- Mi Rutina (rediseño checklist accesible)', () => {
  test('agrupa por grupo muscular, marca ejercicios y actualiza el indicador de progreso', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), routines: [ROUTINE], routine_days: [DAY_1], routine_completions: [] },
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
      routine_exercise_weights: [],
    };
    await loginComoSocio(page, { tables: tablas });

    await irATab(page, 'Mi Rutina');

    // Press de banca (weight_suggestion: '20kg') todavía no tiene una carga
    // real guardada por el socio -- arranca mostrando la sugerencia.
    const cargaPressBanca = page.getByLabel('Carga (kg) usada en este ejercicio').first();
    await expect(cargaPressBanca).toHaveValue('20kg');

    await cargaPressBanca.fill('25kg');
    await cargaPressBanca.blur();

    // Quedó guardado en el mock (routine_exercise_weights), no solo en
    // memoria -- refleja lo que en producción persiste vía saveExerciseWeight.
    await expect
      .poll(() =>
        tablas.routine_exercise_weights.some((w: any) => w.routine_exercise_id === 'e2e-re-1' && w.weight_used === '25kg')
      )
      .toBe(true);
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
        routine_exercise_weights: [
          { id: 'w-1', user_id: SOCIO_DEMO.id, routine_exercise_id: 'e2e-re-1', weight_used: '25kg' },
        ],
      },
    });

    await irATab(page, 'Mi Rutina');
    await expect(page.getByLabel('Carga (kg) usada en este ejercicio').first()).toHaveValue('25kg');
  });
});

test.describe('PWA -- Mi Rutina: historial de entrenamientos', () => {
  test('Finalizar guarda lo marcado (con el peso actual) y aparece en la pestaña Historial', async ({ page }) => {
    const tablas = {
      ...tablasBase(),
      routines: [ROUTINE],
      routine_days: [DAY_1],
      routine_completions: [],
      routine_exercise_weights: [],
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
