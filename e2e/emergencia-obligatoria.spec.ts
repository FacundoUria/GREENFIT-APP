import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockSupabase } from './support/supabaseMock';
import { SOCIO_DEMO } from './support/auth';
import { tablasBase } from './support/fixtures';
import { irATab } from './support/nav';

// Exigencia de seguridad médica del gimnasio (ver types/index.ts,
// MainTabs.tsx, ProfileStack.tsx): si al socio le faltan Contacto de
// emergencia y/o Ficha médica, se lo redirige a "Mis datos" UNA SOLA VEZ al
// iniciar sesión -- SIN bloquear ni ocultar el menú inferior ni el botón de
// volver. Por eso este spec NO reusa loginComoSocio() tal cual (esa espera
// "Hola, <nombre>" de Inicio, que acá no es la pantalla inicial): hace el
// mismo login por UI a mano y espera el contenido de "Mis datos" en su lugar.
async function loginConDatosIncompletos(page: Page) {
  const user = { ...SOCIO_DEMO, emergencyContactName: null, emergencyContactPhone: null, medicalNotes: null };
  await mockSupabase(page, { user, tables: tablasBase() });
  await page.goto('/');
  await page.getByPlaceholder('DNI').fill(user.dni);
  await page.getByPlaceholder('Contraseña').fill(user.dni);
  await page.getByText('Ingresar', { exact: true }).click();
  return user;
}

test.describe('PWA -- Formulario obligatorio de emergencia (redirección no bloqueante)', () => {
  test('socio con datos de emergencia incompletos: al loguearse cae directo en "Mis datos"', async ({ page }) => {
    await loginConDatosIncompletos(page);

    await expect(page.getByLabel('Datos de emergencia obligatorios')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Contacto de emergencia', { exact: true })).toBeVisible();
    await expect(page.getByText(/el gimnasio exige tener cargados tus datos de emergencia/)).toBeVisible();
  });

  test('el menú inferior queda intacto: el socio puede navegar a Inicio libremente sin completar nada', async ({ page }) => {
    await loginConDatosIncompletos(page);
    await expect(page.getByText('Contacto de emergencia', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Sin bloqueo: puede irse a otro tab sin haber guardado nada.
    await irATab(page, 'Inicio');
    await expect(page.getByText(`Hola, ${SOCIO_DEMO.fullName}`, { exact: false })).toBeVisible();

    // Y puede volver al tab Perfil normalmente -- sigue en "Mis datos" (la
    // pila de ese tab no se reseteó, solo se lo dejó de ocultar), lo que
    // importa es que NADA le impidió salir e ir y volver libremente.
    await irATab(page, 'Perfil');
    await expect(page.getByText('Contacto de emergencia', { exact: true })).toBeVisible();
  });

  test('completar y guardar los 3 campos obligatorios saca el banner de aviso', async ({ page }) => {
    await loginConDatosIncompletos(page);
    await expect(page.getByText('Contacto de emergencia', { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder('Nombre del contacto').fill('Juan Pérez');
    await page.getByPlaceholder('Teléfono del contacto').fill('1155667788');
    await page
      .getByPlaceholder('Lesiones, condiciones físicas u otras observaciones...')
      .fill('Sin condiciones preexistentes.');

    // Alert.alert() es un no-op literal en react-native-web (ver
    // node_modules/react-native-web/.../Alert/index.js) -- no hay feedback
    // de UI que capturar ahí, así que la señal real de "guardó bien" es que
    // el banner de aviso desaparece (marcarDatosEmergenciaCompletos() puso
    // el flag en memoria) y los valores cargados no se pierden en el
    // refetch que dispara ese mismo cambio de `user`.
    await page.getByText('Guardar cambios', { exact: true }).click();

    await expect(page.getByText(/el gimnasio exige tener cargados tus datos de emergencia/)).toHaveCount(0);
    await expect(page.getByPlaceholder('Nombre del contacto')).toHaveValue('Juan Pérez');
    await expect(page.getByPlaceholder('Teléfono del contacto')).toHaveValue('1155667788');
  });

  test('socio con datos de emergencia YA completos: el login cae en Inicio, sin redirección (comportamiento de siempre)', async ({
    page,
  }) => {
    await mockSupabase(page, {
      user: {
        ...SOCIO_DEMO,
        emergencyContactName: 'Juan Pérez',
        emergencyContactPhone: '1155667788',
        medicalNotes: 'Sin condiciones preexistentes.',
      },
      tables: tablasBase(),
    });
    await page.goto('/');
    await page.getByPlaceholder('DNI').fill(SOCIO_DEMO.dni);
    await page.getByPlaceholder('Contraseña').fill(SOCIO_DEMO.dni);
    await page.getByText('Ingresar', { exact: true }).click();

    await expect(page.getByText(`Hola, ${SOCIO_DEMO.fullName}`, { exact: false })).toBeVisible({ timeout: 15_000 });
  });
});
