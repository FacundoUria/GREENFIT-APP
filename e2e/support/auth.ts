import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mockSupabase, MockSocio, TablaFixtures, RpcFixtures } from './supabaseMock';

export const SOCIO_DEMO: MockSocio = {
  id: 'e2e-user-1111-1111-1111-111111111111',
  email: 'e2e-socio@greenfit.test',
  dni: '30111222',
  fullName: 'Facundo E2E',
  role: 'socio',
};

// Login real por UI (tipear DNI + contraseña + tocar "Ingresar") contra el
// backend mockeado -- ejercita el flujo de punta a punta tal cual lo usa un
// socio real, sin inyectar sesión "por atrás".
export async function loginComoSocio(
  page: Page,
  { user = SOCIO_DEMO, tables = {}, rpc = {} }: { user?: MockSocio; tables?: TablaFixtures; rpc?: RpcFixtures } = {}
) {
  await mockSupabase(page, { user, tables, rpc });
  await page.goto('/');
  await page.getByPlaceholder('DNI').fill(user.dni);
  await page.getByPlaceholder('Contraseña').fill(user.dni);
  // React Native Web no renderiza TouchableOpacity con role="button" en esta
  // versión -- son <div> genéricos con handler de click, mismo criterio que
  // ya usa toda la suite Jest/RNTL (fireEvent.press(getByText(...))). Por
  // eso acá también se clickea por texto, no por rol.
  await page.getByText('Ingresar', { exact: true }).click();
  await expect(page.getByText(`Hola, ${user.fullName}`, { exact: false })).toBeVisible({ timeout: 15_000 });
  return user;
}
