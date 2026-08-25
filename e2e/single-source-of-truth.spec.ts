import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase } from './support/fixtures';
import { irATab } from './support/nav';

// Bug crítico reportado (socia "Isa Giurato"): el panel Admin decía que el
// socio tenía SOLO Boxeo (6 créditos), pero la PWA mostraba Boxeo +
// Kickboxing + CrossFit como activos -- porque user_credits es un ledger
// append-only (nunca se borra una fila) y nada invalidaba las disciplinas
// que el admin ya había destildado del plan. Fix: el plan ACTUAL de
// `socios` (RPC disciplinas_del_plan_actual, security definer) es la única
// fuente de verdad -- fetchUserBalances() descarta cualquier balance que no
// esté en ese set, sin importar qué filas viejas tenga el ledger.
const DISCIPLINA_BOXEO = { id: 'disc-boxeo', name: 'Boxeo', kind: 'credits' };
const DISCIPLINA_KICKBOXING = { id: 'disc-kickboxing', name: 'Kickboxing', kind: 'credits' };
const DISCIPLINA_CROSSFIT = { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' };

function creditoRow(id: string, discipline: typeof DISCIPLINA_BOXEO, remaining: number) {
  return {
    id,
    user_id: SOCIO_DEMO.id,
    remaining_credits: remaining,
    expires_at: null,
    created_at: new Date().toISOString(),
    discipline,
    pack: null,
  };
}

// El ledger tiene las 3 disciplinas -- exactamente el estado real reportado
// (Boxeo 6, Kickboxing 9, CrossFit 7), simulando que en algún momento el
// socio tuvo las tres y el admin después las destildó salvo Boxeo.
const LEDGER_ISA = [
  creditoRow('uc-boxeo', DISCIPLINA_BOXEO, 6),
  creditoRow('uc-kickboxing', DISCIPLINA_KICKBOXING, 9),
  creditoRow('uc-crossfit', DISCIPLINA_CROSSFIT, 7),
];

test.describe('PWA -- Single Source of Truth (el plan actual del Admin filtra el ledger de créditos)', () => {
  test('caso real: el Admin solo tiene tildado Boxeo -> Inicio y Mi Perfil muestran SOLO Boxeo, no Kickboxing ni CrossFit', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: LEDGER_ISA },
      rpc: {
        disciplinas_del_plan_actual: () => ({ vinculado: true, discipline_ids: [DISCIPLINA_BOXEO.id] }),
      },
    });

    await expect(page.getByText('Boxeo', { exact: true })).toBeVisible();
    await expect(page.getByText('Kickboxing', { exact: true })).toHaveCount(0);
    await expect(page.getByText('CrossFit', { exact: true })).toHaveCount(0);

    await irATab(page, 'Perfil');
    await expect(page.getByText('Mi Perfil')).toBeVisible();
    // .last() -- Inicio queda montado de fondo (React Navigation) y también
    // muestra "Boxeo" en su propia Hero Card; Perfil se montó DESPUÉS, así
    // que es el último en el árbol (mismo criterio que perfil.spec.ts).
    await expect(page.getByText('Boxeo', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Kickboxing', { exact: true })).toHaveCount(0);
    await expect(page.getByText('CrossFit', { exact: true })).toHaveCount(0);
  });

  test('el admin destildó TODO el plan (sin ninguna disciplina activa) -> la PWA no muestra ningún balance', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: LEDGER_ISA },
      rpc: {
        disciplinas_del_plan_actual: () => ({ vinculado: true, discipline_ids: [] }),
      },
    });

    await expect(page.getByText('Todavía no tenés ningún pack activo.')).toBeVisible();
    await expect(page.getByText('Boxeo', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Kickboxing', { exact: true })).toHaveCount(0);
    await expect(page.getByText('CrossFit', { exact: true })).toHaveCount(0);
  });

  test('socio sin ficha vinculada en socios todavía (vinculado=false) -> no filtra, muestra el ledger completo (fail open)', async ({
    page,
  }) => {
    await loginComoSocio(page, {
      tables: { ...tablasBase(), user_credits: LEDGER_ISA },
      rpc: {
        disciplinas_del_plan_actual: () => ({ vinculado: false, discipline_ids: null }),
      },
    });

    await expect(page.getByText('Boxeo', { exact: true })).toBeVisible();
    await expect(page.getByText('Kickboxing', { exact: true })).toBeVisible();
    await expect(page.getByText('CrossFit', { exact: true })).toBeVisible();
  });

  test('si el RPC todavía no está desplegado en este ambiente, la PWA sigue funcionando (sin filtrar, no rompe)', async ({
    page,
  }) => {
    // Sin fixture de `rpc` -- el mock responde 404/PGRST202, que es
    // exactamente el escenario "migración no corrida todavía".
    await loginComoSocio(page, { tables: { ...tablasBase(), user_credits: LEDGER_ISA } });

    await expect(page.getByText('Boxeo', { exact: true })).toBeVisible();
    await expect(page.getByText('Kickboxing', { exact: true })).toBeVisible();
    await expect(page.getByText('CrossFit', { exact: true })).toBeVisible();
  });
});
