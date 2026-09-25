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

    // Rediseño de Inicio: una tarjeta por disciplina (nombre + número + "créditos")
    // y UNA sola tarjeta de vencimiento con el badge de estado del plan.
    const tarjeta = page.getByTestId('credito-card-disc-boxeo');
    await expect(tarjeta.getByText('Boxeo')).toBeVisible();
    await expect(tarjeta.getByText('6', { exact: true })).toBeVisible();
    await expect(tarjeta.getByText('créditos')).toBeVisible();
    await expect(page.getByText('Activo al día')).toBeVisible();
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
    // tener más de una fila en user_credits: 3 tarjetas en el carrusel.
    await expect(page.getByTestId(/^credito-card-/)).toHaveCount(3);
    const aparatos = page.getByTestId('credito-card-disc-aparatos');
    const boxeo = page.getByTestId('credito-card-disc-boxeo');
    const crossfit = page.getByTestId('credito-card-disc-crossfit');
    await expect(aparatos.getByText('Aparatos')).toBeVisible();
    await expect(boxeo.getByText('Boxeo')).toBeVisible();
    await expect(crossfit.getByText('CrossFit')).toBeVisible();

    // Cada una con su balance EXACTO -- ninguna quedó en "0" por pisarse con
    // las otras filas de user_credits. Aparatos es pase libre: "∞", sin número.
    await expect(boxeo.getByText('6', { exact: true })).toBeVisible();
    await expect(crossfit.getByText('3', { exact: true })).toBeVisible();
    await expect(aparatos.getByText('∞')).toBeVisible();
    await expect(aparatos.getByText('pase libre')).toBeVisible();

    // UNA sola tarjeta de vencimiento (el plan tiene una sola fecha), activa.
    await expect(page.getByTestId('vencimiento-card')).toHaveCount(1);
    await expect(page.getByText('Vencido', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Activo al día')).toHaveCount(1);
  });

  // Reproduce EXACTO el bug crítico de sincronización reportado (2026-08-07):
  // un socio con dos disciplinas de créditos donde UNA está cargada (6, del
  // Admin) y la OTRA vino en 0 -- antes, un bug del lado del Admin
  // (CreditosCell con un pozo global + un <select> ambiguo, ver
  // GreenfitAdminDashboard) podía sincronizar el ajuste a la disciplina
  // equivocada, dejando a la disciplina "correcta" en 0/VENCIDO en la PWA
  // aunque el panel mostrara un número > 0. Esto prueba el lado de LECTURA
  // del contrato: con la fila de user_credits de CrossFit correctamente en
  // 6 (forma exacta que produce sincronizarCreditosPwa ya arreglado), la
  // PWA tiene que mostrar CrossFit ACTIVO con 6 clases -- sin importar que
  // Boxeo, la otra disciplina de créditos del mismo socio, esté en 0/VENCIDO
  // al mismo tiempo (una no debe "contaminar" el estado de la otra).
  test('dos disciplinas de créditos del mismo socio, una ACTIVA y la otra en 0: solo aparece la activa (la de 0 no es una disciplina activa)', async ({
    page,
  }) => {
    const DISCIPLINA_CROSSFIT = { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' };
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        disciplines: [DISCIPLINA_BOXEO, DISCIPLINA_CROSSFIT, DISCIPLINA_APARATOS],
        user_credits: [creditoRow('uc-crossfit', DISCIPLINA_CROSSFIT, 6), creditoRow('uc-boxeo', DISCIPLINA_BOXEO, 0)],
      },
    });

    // fetchUserBalances solo devuelve disciplinas con algo REALMENTE activo:
    // Boxeo (0 créditos) no tiene tarjeta -- y no "contamina" a CrossFit.
    const crossfit = page.getByTestId('credito-card-disc-crossfit');
    await expect(crossfit.getByText('CrossFit')).toBeVisible();
    await expect(crossfit.getByText('6', { exact: true })).toBeVisible();
    await expect(page.getByTestId('credito-card-disc-boxeo')).toHaveCount(0);
    await expect(page.getByTestId(/^credito-card-/)).toHaveCount(1);
    await expect(page.getByText('Activo al día')).toHaveCount(1);
  });

  test('cuenta con membresía por vencimiento (Aparatos) VIGENTE: Activo, sin "clases restantes"', async ({ page }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [membresiaRow('uc-aparatos', EN_10_DIAS)] },
    });

    const aparatos = page.getByTestId('credito-card-disc-aparatos');
    await expect(aparatos.getByText('Aparatos')).toBeVisible();
    await expect(aparatos.getByText('∞')).toBeVisible();
    await expect(page.getByText('Activo al día')).toBeVisible();
    // La fecha del plan sale de user_credits: tarjeta de vencimiento con fecha real.
    await expect(page.getByTestId('vencimiento-fecha')).toBeVisible();
  });

  test('cuenta con membresía por vencimiento (Aparatos) VENCIDA: no hay nada activo -- sin tarjeta ni carrusel, con acceso a elegir un pack', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: [membresiaRow('uc-aparatos', HACE_15_DIAS)] },
    });

    // fetchUserBalances no devuelve lo vencido: Inicio muestra el estado vacío.
    await expect(page.getByText('Todavía no tenés ningún pack activo.')).toBeVisible();
    await expect(page.getByTestId('credito-card-disc-aparatos')).toHaveCount(0);
    await expect(page.getByTestId('vencimiento-card')).toHaveCount(0);
    await expect(page.getByText('Elegir mi pack', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Aparatos').last()).toBeVisible();
    await expect(page.getByText('Boxeo').last()).toBeVisible();
    await expect(page.getByText('CrossFit').last()).toBeVisible();
    await expect(page.getByText(/6 créditos disponibles/).last()).toBeVisible();
  });
});
