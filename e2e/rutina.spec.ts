import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase } from './support/fixtures';
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

    // Header tipo "ficha de entrenamiento": título personalizado + badge
    // con SOLO el nombre del día (sin repetir "Rutina de..." adentro).
    await expect(page.getByText('Rutina de Facundo')).toBeVisible();
    await expect(page.getByText('Día 1', { exact: true })).toBeVisible();
    // Encabezados por grupo muscular -- de un vistazo se ve qué se entrena.
    await expect(page.getByText('PECHO')).toBeVisible();
    await expect(page.getByText('TRÍCEPS')).toBeVisible();
    await expect(page.getByText('Press de banca')).toBeVisible();
    await expect(page.getByText('Fondos en banco')).toBeVisible();

    // Sin barra de porcentaje -- el indicador pill arranca en 0/2.
    await expect(page.getByText('0/2 completados')).toBeVisible();

    await page.getByLabel('Marcar Press de banca como completado').click();
    await expect(page.getByText('1/2 completados')).toBeVisible();
    await expect(page.getByLabel('Press de banca, completado')).toBeVisible();

    await page.getByLabel('Marcar Fondos en banco como completado').click();
    await expect(page.getByText('2/2 completados')).toBeVisible();

    // Botón de cierre -- gatilla el modal gratificante en vez del
    // Alert.alert() anterior (no-op mudo en react-native-web).
    await page.getByText('🔥 Finalizar Entrenamiento', { exact: true }).click();
    await expect(page.getByText('¡Rutina completa! 🔥')).toBeVisible();
    await expect(page.getByText('Genial')).toBeVisible();
  });

  test('cerrar el entreno sin completar todo muestra el copy de progreso parcial', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), routines: [ROUTINE], routine_days: [DAY_1], routine_completions: [] },
    });

    await irATab(page, 'Mi Rutina');
    await page.getByLabel('Marcar Press de banca como completado').click();
    await expect(page.getByText('1/2 completados')).toBeVisible();

    await page.getByText('🔥 Finalizar Entrenamiento', { exact: true }).click();
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
