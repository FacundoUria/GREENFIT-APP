import type { Page } from '@playwright/test';

// React Native Web no renderiza los botones de la bottom tab bar con
// role="button" en esta versión (son <div> genéricos con handler de click)
// -- se clickea por texto exacto, mismo criterio que ya usa toda la suite
// Jest/RNTL (fireEvent.press(getByText(...))). `.first()` porque algunas
// pantallas repiten el mismo texto en su propio título (ej. "Comunidad").
export async function irATab(page: Page, nombre: 'Inicio' | 'Agenda' | 'Mi Rutina' | 'Comunidad' | 'Perfil') {
  await page.getByText(nombre, { exact: true }).first().click();
}
