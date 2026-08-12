import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, AYER_STR, HOY_STR } from './support/fixtures';

// Cubre el checklist de Home: widget "Progreso Diario" (anillo de XP +
// "¡Hoy entrené!" + reglas), y la ausencia de la vieja tarjeta "Mi Pase".
test.describe('PWA -- Home / Dashboard', () => {
  test('muestra el widget Progreso Diario y NO la tarjeta "Mi Pase / Comprar"', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    await expect(page.getByText('Progreso Diario')).toBeVisible();
    await expect(page.getByText('N3')).toBeVisible(); // 1150 XP -> NIVEL 3

    await expect(page.getByText('Mi Pase')).toHaveCount(0);
    await expect(page.getByText('Comprar')).toHaveCount(0);
  });

  // Rediseño UX de Inicio: el widget "Progreso Diario" se redujo al anillo
  // solo (Nivel + XP centrados, ver XpProgressRing) -- el estado de
  // check-in de hoy ("Esperando..."/"¡Seba registró tu asistencia!") ya NO
  // vive acá (menos carga cognitiva). Ese widget sigue existiendo como
  // componente propio y con su propia cobertura dedicada
  // (AsistenciaHoyStatus.test.tsx), simplemente dejó de montarse en Home.
  test('el widget "Progreso Diario" ya no muestra el estado de check-in de hoy (se sacó en el rediseño)', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        // Sin fila de HOY -- si el widget de check-in siguiera montado acá,
        // este sería justamente el escenario que dispara "Esperando...".
        xp_events: [
          { id: 'xp-ayer', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 450, event_date: AYER_STR, reference_id: null },
        ],
      },
    });

    await expect(page.getByText('Progreso Diario')).toBeVisible();
    await expect(page.getByText('Esperando check-in en el gimnasio...')).toHaveCount(0);
    await expect(page.getByText('¡Hoy entrené!', { exact: false })).toHaveCount(0);
  });

  test('tampoco con asistencia de HOY ya acreditada -- ese aviso en verde se sacó de Inicio igual', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        xp_events: [
          { id: 'xp-hoy', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 100, event_date: HOY_STR, reference_id: null },
        ],
      },
    });

    await expect(page.getByText('Progreso Diario')).toBeVisible();
    await expect(page.getByText('¡Seba registró tu asistencia! Sumaste +100 XP hoy')).toHaveCount(0);
  });

  test('el ícono de reglas de XP abre el modal con la única regla vigente', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    await page.getByLabel('¿Cómo ganar XP?').first().click();

    await expect(page.getByText('¿Cómo ganar XP?')).toBeVisible();
    await expect(page.getByText('Asistencia diaria', { exact: true })).toBeVisible();
    await expect(page.getByText(/Acreditados presencialmente al realizar tu check-in en el gimnasio/)).toBeVisible();
    await expect(page.getByText('Publicar en la Comunidad')).toHaveCount(0);
    await expect(page.getByText('Superar un Récord Personal (PR)')).toHaveCount(0);
    await expect(page.getByText('Completar una Meta Personal')).toHaveCount(0);
  });

  // Tarjeta de perfil gamificada -- vivía SOLO en Mi Perfil, ahora también
  // arriba de todo en Inicio (debajo del saludo), con los mismos datos
  // reales (racha=2, clases del mes=2, 1150 XP -> NIVEL 3).
  test('muestra la tarjeta de perfil gamificada debajo del saludo, con nivel/racha/clases reales', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    const saludo = page.getByText(/^Hola, /);
    await expect(saludo).toBeVisible();

    await expect(page.getByText('NIVEL 3')).toBeVisible();
    await expect(page.getByTestId('stat-racha')).toHaveText('2');
    await expect(page.getByTestId('stat-clases')).toHaveText('2');

    // Está debajo del saludo (no en cualquier lugar de la pantalla) --
    // confirma la jerarquía pedida, no solo que el dato exista en algún lado.
    const saludoBox = await saludo.boundingBox();
    const nivelBox = await page.getByText('NIVEL 3').boundingBox();
    expect(saludoBox!.y).toBeLessThan(nivelBox!.y);
  });

  // Rediseño UX: con una reserva próxima, el CTA es un "ticket" limpio --
  // disciplina + día/hora nada más, sin la etiqueta "Tu próxima clase" ni
  // el countdown como texto aparte (eso se sacó para bajar carga
  // cognitiva). `start_time` bien entrada la noche (23:59) para que la fila
  // quede determinística sin importar a qué hora corra la suite.
  test('con una reserva activa, muestra un ticket limpio (disciplina + día/hora) con botón de Cancelar', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        bookings: [
          {
            id: 'booking-1',
            user_id: SOCIO_DEMO.id,
            class_id: 'class-crossfit-hoy',
            booking_date: HOY_STR,
            attended: false,
            classes: { title: 'CrossFit', start_time: '23:59:00' },
          },
        ],
      },
    });

    await expect(page.getByText('CrossFit · Hoy 23:59 hs')).toBeVisible();
    // React Native Web no renderiza este TouchableOpacity con role="button"
    // en esta versión (mismo criterio que e2e/support/nav.ts) -- se busca
    // por texto, no por rol.
    await expect(page.getByText('Cancelar', { exact: true })).toBeVisible();
    // Ni la vieja etiqueta/countdown ni el botón grande de "sin reservas"
    // (son mutuamente excluyentes con tener una reserva activa).
    await expect(page.getByText('Tu próxima clase', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Empieza en/)).toHaveCount(0);
    await expect(page.getByText('📅 Reservar próxima clase')).toHaveCount(0);
  });

  test('sin ninguna reserva, muestra el botón grande "📅 Reservar próxima clase" que lleva a Mi Agenda', async ({
    page,
  }) => {
    await loginComoSocio(page, { tables: tablasBase() }); // tablasBase() ya arranca con bookings: []

    const botonReservar = page.getByText('📅 Reservar próxima clase', { exact: true });
    await expect(botonReservar).toBeVisible();
    // El viejo bloque de texto gris ya no existe.
    await expect(page.getByText('Todavía no tenés reservas')).toHaveCount(0);

    await botonReservar.click();
    await expect(page.getByText('Mi Agenda', { exact: true })).toBeVisible();
  });

  // La tarjeta de reseña de Google se mudó a Mi Perfil en el rediseño --
  // Inicio queda reservado a lo operativo del día a día (ver perfil.spec.ts
  // para la cobertura real del click -> Maps).
  test('ya NO muestra la tarjeta de reseña de Google -- se mudó a Mi Perfil', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasBase() });

    await expect(page.getByLabel('Dejanos tu reseña en Google')).toHaveCount(0);
    await expect(page.getByText('¿Te gusta entrenar en GreenFit?')).toHaveCount(0);
  });
});
