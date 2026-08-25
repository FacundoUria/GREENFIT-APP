import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockSupabase } from './support/supabaseMock';
import { SOCIO_DEMO } from './support/auth';
import { tablasBase } from './support/fixtures';
import { irATab } from './support/nav';

// Perfil obligatorio (pedido del cliente): Nombre, Apellido, DNI, Correo,
// Teléfono, Teléfono de emergencia y Domicilio. Si al socio le faltan,
// ProfileStack.tsx lo redirige a "Mis datos" UNA SOLA VEZ al entrar a la
// pestaña Perfil Y bloquea el resto de las pantallas DE ESA PESTAÑA
// (listado, Historial, Progreso) -- el resto de la app (Inicio, Agenda, Mi
// Rutina, Comunidad) sigue 100% accesible en todo momento (ver
// MainTabs.tsx). Por eso este spec NO reusa loginComoSocio() tal cual (esa
// espera "Hola, <nombre>" de Inicio, que acá no es la pantalla inicial del
// tab Perfil): hace el mismo login por UI a mano y espera el contenido de
// "Mis datos" en su lugar.
async function loginConPerfilIncompleto(page: Page) {
  const user = { ...SOCIO_DEMO, phone: null, domicilio: null, emergencyContactPhone: null };
  await mockSupabase(page, { user, tables: tablasBase() });
  await page.goto('/');
  await page.getByPlaceholder('DNI').fill(user.dni);
  await page.getByPlaceholder('Contraseña').fill(user.dni);
  await page.getByText('Ingresar', { exact: true }).click();
  return user;
}

test.describe('PWA -- Perfil obligatorio (Mis datos)', () => {
  test('socio con el perfil incompleto: al entrar a Perfil cae directo en "Mis datos" con el banner de aviso', async ({
    page,
  }) => {
    await loginConPerfilIncompleto(page);

    await expect(page.getByLabel('Perfil incompleto')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/el gimnasio exige tener completos tus datos/)).toBeVisible();
    // Nombre/Apellido separados a partir de full_name, DNI y Correo de solo
    // lectura -- todos visibles aunque el perfil esté incompleto (React
    // Native Web renderiza <TextInput value> como un <input value>).
    await expect(page.locator(`input[value="${SOCIO_DEMO.dni}"]`)).toBeVisible();
  });

  test('el resto de la app queda 100% accesible: puede irse a Inicio/Agenda libremente sin completar nada', async ({
    page,
  }) => {
    await loginConPerfilIncompleto(page);
    await expect(page.getByLabel('Perfil incompleto')).toBeVisible({ timeout: 15_000 });

    // Sin bloqueo de las pestañas principales: se va a Inicio sin guardar.
    await irATab(page, 'Inicio');
    await expect(page.getByText(`Hola, ${SOCIO_DEMO.fullName}`, { exact: false })).toBeVisible();

    await irATab(page, 'Agenda');
    await expect(page.getByText('Mi Agenda')).toBeVisible();

    // Y puede volver a Perfil normalmente -- sigue en "Mis datos" (la pila
    // de esa pestaña sigue reducida mientras el perfil no se complete).
    await irATab(page, 'Perfil');
    await expect(page.getByLabel('Perfil incompleto')).toBeVisible();
  });

  test('"Más opciones" (historial de clases) no existe mientras el perfil está incompleto -- esa ruta no está registrada en la pila reducida', async ({
    page,
  }) => {
    await loginConPerfilIncompleto(page);
    await expect(page.getByLabel('Perfil incompleto')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Ver historial de clases')).toHaveCount(0);
  });

  test('completar Teléfono, Domicilio y Teléfono de emergencia y guardar saca el banner de aviso', async ({ page }) => {
    await loginConPerfilIncompleto(page);
    await expect(page.getByLabel('Perfil incompleto')).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder('Teléfono / WhatsApp').fill('1122334455');
    await page.getByPlaceholder('Calle, número, localidad').fill('Av. Siempre Viva 742');
    await page.getByPlaceholder('Teléfono del contacto').fill('1155667788');

    // Alert.alert() es un no-op literal en react-native-web -- no hay
    // feedback de UI que capturar ahí, así que la señal real de "guardó
    // bien" es que el banner de aviso desaparece (marcarPerfilCompleto()
    // puso el flag en memoria).
    await page.getByText('Guardar cambios', { exact: true }).click();

    await expect(page.getByText(/el gimnasio exige tener completos tus datos/)).toHaveCount(0);
    await expect(page.getByLabel('Perfil incompleto')).toHaveCount(0);
  });

  test('al guardar, dispara la sincronización estricta de Teléfono con el panel Admin (RPC sincronizar_telefono_a_socio)', async ({
    page,
  }) => {
    const user = { ...SOCIO_DEMO, phone: null, domicilio: null, emergencyContactPhone: null };
    let rpcLlamado = false;
    await mockSupabase(page, {
      user,
      tables: tablasBase(),
      rpc: { sincronizar_telefono_a_socio: () => ((rpcLlamado = true), null) },
    });
    await page.goto('/');
    await page.getByPlaceholder('DNI').fill(user.dni);
    await page.getByPlaceholder('Contraseña').fill(user.dni);
    await page.getByText('Ingresar', { exact: true }).click();
    await expect(page.getByLabel('Perfil incompleto')).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder('Teléfono / WhatsApp').fill('1122334455');
    await page.getByPlaceholder('Calle, número, localidad').fill('Av. Siempre Viva 742');
    await page.getByPlaceholder('Teléfono del contacto').fill('1155667788');
    await page.getByText('Guardar cambios', { exact: true }).click();

    await expect(page.getByLabel('Perfil incompleto')).toHaveCount(0);
    expect(rpcLlamado).toBe(true);
  });

  test('socio con el perfil YA completo: el login cae en Inicio, sin redirección a Perfil (comportamiento de siempre)', async ({
    page,
  }) => {
    // Sin overrides -- el fixture por defecto (ver support/supabaseMock.ts)
    // ya viene con Teléfono/Domicilio/Teléfono de emergencia completos.
    await mockSupabase(page, { user: SOCIO_DEMO, tables: tablasBase() });
    await page.goto('/');
    await page.getByPlaceholder('DNI').fill(SOCIO_DEMO.dni);
    await page.getByPlaceholder('Contraseña').fill(SOCIO_DEMO.dni);
    await page.getByText('Ingresar', { exact: true }).click();

    await expect(page.getByText(`Hola, ${SOCIO_DEMO.fullName}`, { exact: false })).toBeVisible({ timeout: 15_000 });

    // Y en Perfil ve el listado normal, no "Mis datos" a la fuerza.
    await irATab(page, 'Perfil');
    await expect(page.getByText('Mi Perfil')).toBeVisible();
  });
});
