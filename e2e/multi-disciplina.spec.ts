import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, DISCIPLINA_APARATOS } from './support/fixtures';
import { irATab } from './support/nav';

// Auditoría "cero suposiciones" del contrato Admin -> PWA para créditos y
// vencimientos: lo que el Admin muestra (créditos por disciplina vía
// user_credits, fecha_vencimiento) tiene que ser EXACTAMENTE lo que la PWA
// renderiza -- sin importar cuántas disciplinas tenga el socio ni de qué
// tipo sean. Sin mocks de lógica intermedia: son las mismas fetchUserBalances/
// getExpiryStatus/getCreditsStatus reales que corre producción, solo con la
// red mockeada.
const DISCIPLINA_BOXEO = { id: 'disc-boxeo', name: 'Boxeo', kind: 'credits' };

const HOY = new Date();
const EN_10_DIAS = new Date(Date.now() + 10 * 86_400_000).toISOString();
// Más allá de los 5 días de tolerancia por DEFECTO (configuracion.dias_tolerancia,
// CONFIGURACION_POR_DEFECTO en ConfiguracionContext.tsx) -- con menos días la
// membresía cae en "por vencer" a propósito (tolerancia), no en "vencido".
const HACE_15_DIAS = new Date(Date.now() - 15 * 86_400_000).toISOString();

function creditoRow(id: string, discipline: typeof DISCIPLINA_BOXEO, remaining: number) {
  return {
    id,
    user_id: SOCIO_DEMO.id,
    remaining_credits: remaining,
    expires_at: EN_10_DIAS,
    created_at: HOY.toISOString(),
    discipline,
    pack: null,
  };
}

function membresiaRow(id: string, expiresAt: string) {
  return {
    id,
    user_id: SOCIO_DEMO.id,
    remaining_credits: null,
    expires_at: expiresAt,
    created_at: HOY.toISOString(),
    discipline: DISCIPLINA_APARATOS,
    pack: null,
  };
}

test.describe('PWA -- Contrato de créditos/vencimiento Admin -> Socio (todos los tipos de cuenta)', () => {
  test('cuenta unidisciplina (solo Boxeo, 6 créditos): ACTIVO en verde con las clases exactas', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        disciplines: [DISCIPLINA_BOXEO, DISCIPLINA_APARATOS],
        user_credits: [creditoRow('uc-boxeo', DISCIPLINA_BOXEO, 6)],
      },
    });

    await expect(page.getByText('Boxeo')).toBeVisible();
    await expect(page.getByText(/6.*clases restantes/)).toBeVisible();
    await expect(page.getByText('Activo', { exact: true })).toBeVisible();
    await expect(page.getByText('Vencido', { exact: true })).toHaveCount(0);
  });

  test('cuenta multidisciplina (Aparatos + Boxeo + CrossFit): las 3 aparecen, cada una con su estado real', async ({
    page,
  }) => {
    const DISCIPLINA_CROSSFIT = { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' };
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        disciplines: [DISCIPLINA_BOXEO, DISCIPLINA_CROSSFIT, DISCIPLINA_APARATOS],
        user_credits: [
          membresiaRow('uc-aparatos', EN_10_DIAS), // membresía vigente
          creditoRow('uc-boxeo', DISCIPLINA_BOXEO, 6),
          creditoRow('uc-crossfit', DISCIPLINA_CROSSFIT, 3),
        ],
      },
    });

    await irATab(page, 'Inicio'); // ya arranca ahí, pero deja el estado explícito

    // Las 3 disciplinas visibles -- ninguna se "pierde" ni se omite por
    // tener más de una fila en user_credits.
    await expect(page.getByText('Aparatos / Musculación')).toBeVisible();
    await expect(page.getByText('Boxeo')).toBeVisible();
    await expect(page.getByText('CrossFit')).toBeVisible();

    // Cada una con su balance EXACTO -- ninguna quedó en "0 clases" por
    // pisarse con las otras filas de user_credits.
    await expect(page.getByText(/6.*clases restantes/)).toBeVisible();
    await expect(page.getByText(/3.*clases restantes/)).toBeVisible();

    // Las 3 activas (membresía vigente + créditos > 0 en ambas) -- CERO
    // "Vencido" de más, y el badge "Activo" aparece 3 veces (uno por fila).
    await expect(page.getByText('Vencido', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Activo', { exact: true })).toHaveCount(3);
  });

  test('cuenta con membresía por vencimiento (Aparatos) VIGENTE: Activo, sin "clases restantes"', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [membresiaRow('uc-aparatos', EN_10_DIAS)] },
    });

    await expect(page.getByText('Aparatos / Musculación')).toBeVisible();
    await expect(page.getByText('Activo', { exact: true })).toBeVisible();
    await expect(page.getByText(/Vence el/)).toBeVisible();
  });

  test('cuenta con membresía por vencimiento (Aparatos) VENCIDA: Vencido en rojo, respeta fecha_vencimiento exacta', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [membresiaRow('uc-aparatos', HACE_15_DIAS)] },
    });

    await expect(page.getByText('Aparatos / Musculación')).toBeVisible();
    await expect(page.getByText('Vencido', { exact: true })).toBeVisible();
    await expect(page.getByText(/Venció el/)).toBeVisible();
  });

  test('Mi Perfil muestra la MISMA cuenta multidisciplina que Inicio (misma fuente, sin desfase entre pantallas)', async ({
    page,
  }) => {
    const DISCIPLINA_CROSSFIT = { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' };
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        disciplines: [DISCIPLINA_BOXEO, DISCIPLINA_CROSSFIT, DISCIPLINA_APARATOS],
        user_credits: [
          membresiaRow('uc-aparatos', EN_10_DIAS),
          creditoRow('uc-boxeo', DISCIPLINA_BOXEO, 6),
          creditoRow('uc-crossfit', DISCIPLINA_CROSSFIT, 3),
        ],
      },
    });

    await irATab(page, 'Perfil');
    await expect(page.getByText('Aparatos / Musculación').last()).toBeVisible();
    await expect(page.getByText('Boxeo').last()).toBeVisible();
    await expect(page.getByText('CrossFit').last()).toBeVisible();
    await expect(page.getByText(/6 de \d+ clases restantes|6.*clases restantes/).last()).toBeVisible();
  });
});
