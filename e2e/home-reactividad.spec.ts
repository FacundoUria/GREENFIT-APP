import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, AYER_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Reactividad de Inicio en un navegador REAL (build web de Expo): los datos
// cambian del lado del backend (lo que haría el Admin: -1 crédito, mover la
// fecha del plan, agregar/quitar disciplina, dejar al socio sin nada) y Inicio
// tiene que reflejarlo al volver a la pestaña -- el mock lee `tables` en cada
// request, así que mutar el objeto equivale a un cambio real en la base.
// (El evento de Realtime no se puede simular acá -- el mock no habla
// WebSocket --; ese camino lo cubre HomeScreen.render.test.tsx. Esto cubre el
// camino de "volver a entrar a la pantalla" con la app real.)
const yoga = { id: 'disc-yoga', name: 'Yoga', kind: 'credits' };
const pilates = { id: 'disc-pilates', name: 'Pilates', kind: 'credits' };
const natacion = { id: 'disc-natacion', name: 'Natación', kind: 'credits' };
const aparatos = { id: 'disc-aparatos', name: 'Aparatos', kind: 'membership' };

const enDias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const fila = (id: string, disc: typeof yoga, remaining: number | null, expiresAt: string) => ({
  id,
  user_id: SOCIO_DEMO.id,
  remaining_credits: remaining,
  expires_at: expiresAt,
  created_at: '2026-09-01T00:00:00.000Z',
  discipline: disc,
  pack: null,
});

// Misma conversión que formatLongDate() (día calendario Argentina).
function fechaLarga(iso: string): string {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [anio, mes, dia] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Mendoza', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))
    .split('-');
  const nombre = meses[Number(mes) - 1];
  return `${Number(dia)} de ${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}, ${anio}`;
}

async function volverAInicio(page: import('@playwright/test').Page) {
  await irATab(page, 'Agenda');
  await expect(page.getByText('Mi Agenda')).toBeVisible();
  await irATab(page, 'Inicio');
}

test.describe('PWA -- Inicio reacciona a cambios reales de datos (navegador real)', () => {
  test('1 a 5: número, fecha, disciplina nueva, disciplina quitada y "sin nada activo" al volver a Inicio', async ({ page }) => {
    const tables: any = {
      ...tablasBase(),
      disciplines: [yoga, pilates, natacion, aparatos],
      xp_events: [],
      user_credits: [fila('uc-yoga', yoga, 12, enDias(25)), fila('uc-pilates', pilates, 6, enDias(25))],
    };
    await loginComoSocio(page, { tables });

    const carrusel = page.getByTestId(/^credito-card-/);
    await expect(carrusel).toHaveCount(2);
    await expect(page.getByTestId('credito-card-disc-yoga').getByText('12', { exact: true })).toBeVisible();
    await expect(page.getByTestId('vencimiento-fecha')).toHaveText(fechaLarga(enDias(25)));

    // 1) -1 crédito de Yoga (Admin: Editar Socio -1, o reservar una clase).
    tables.user_credits = [fila('uc-yoga', yoga, 11, enDias(25)), fila('uc-pilates', pilates, 6, enDias(25))];
    await volverAInicio(page);
    await expect(page.getByTestId('credito-card-disc-yoga').getByText('11', { exact: true })).toBeVisible();
    await expect(page.getByTestId('credito-card-disc-yoga').getByText('12', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('credito-card-disc-pilates').getByText('6', { exact: true })).toBeVisible();

    // 2) El Admin mueve la fecha de todo el plan a +40 días ("Vencimiento del plan").
    const nuevaFecha = enDias(40);
    tables.user_credits = [fila('uc-yoga', yoga, 11, nuevaFecha), fila('uc-pilates', pilates, 6, nuevaFecha)];
    await volverAInicio(page);
    await expect(page.getByTestId('vencimiento-fecha')).toHaveText(fechaLarga(nuevaFecha));
    await expect(page.getByText(fechaLarga(enDias(25)))).toHaveCount(0);
    await expect(page.getByTestId('vencimiento-card')).toHaveCount(1);

    // 3) Se agrega una disciplina (Natación 4) y Aparatos: 2 tarjetas nuevas.
    tables.user_credits = [
      fila('uc-yoga', yoga, 11, nuevaFecha),
      fila('uc-pilates', pilates, 6, nuevaFecha),
      fila('uc-natacion', natacion, 4, nuevaFecha),
      fila('uc-aparatos', aparatos, null, nuevaFecha),
    ];
    await volverAInicio(page);
    await expect(carrusel).toHaveCount(4);
    await expect(page.getByTestId('credito-card-disc-natacion').getByText('4', { exact: true })).toBeVisible();
    await expect(page.getByTestId('credito-card-disc-aparatos').getByText('∞')).toBeVisible();

    // 4) Se quita Pilates: su tarjeta desaparece, las demás no.
    tables.user_credits = [
      fila('uc-yoga', yoga, 11, nuevaFecha),
      fila('uc-natacion', natacion, 4, nuevaFecha),
      fila('uc-aparatos', aparatos, null, nuevaFecha),
    ];
    await volverAInicio(page);
    await expect(carrusel).toHaveCount(3);
    await expect(page.getByTestId('credito-card-disc-pilates')).toHaveCount(0);
    await expect(page.getByTestId('credito-card-disc-yoga')).toBeVisible();

    // 5) Sin nada activo: estado vacío con "Elegir mi pack", sin tarjetas rotas.
    tables.user_credits = [];
    await volverAInicio(page);
    await expect(page.getByText('Todavía no tenés ningún pack activo.')).toBeVisible();
    await expect(page.getByText('Elegir mi pack', { exact: true })).toBeVisible();
    await expect(page.getByText('Agregar otro pack')).toHaveCount(0);
    await expect(carrusel).toHaveCount(0);
    await expect(page.getByTestId('creditos-carrusel')).toHaveCount(0);
    await expect(page.getByTestId('vencimiento-card')).toHaveCount(0);
    await expect(page.getByText('💪 Hoy Entrené')).toHaveCount(0);
  });

  test('6: "Hoy Entrené" mueve el arco del anillo según el nuevo % del nivel', async ({ page }) => {
    await loginComoSocio(page, {
      tables: {
        ...tablasBase(),
        disciplines: [yoga],
        user_credits: [fila('uc-yoga', yoga, 5, enDias(25))],
        // 350 XP -> nivel 1, 350/500
        xp_events: [{ id: 'xp-1', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 350, event_date: AYER_STR, reference_id: null }],
      },
      rpc: { registrar_hoy_entrene: () => ({ otorgado: true, xp_otorgado: 100, entrenamientos_hoy: 1, entrenamientos_maximos: 1 }) },
    });

    const arco = page.getByTestId('nivel-ring-arco');
    await expect(page.getByTestId('nivel-numero')).toHaveText('1');
    const circ = 2 * Math.PI * ((208 - 7 * 4) / 2);
    const antes = Number(await arco.getAttribute('stroke-dashoffset'));
    expect(antes).toBeCloseTo(circ * (1 - 350 / 500), 1);

    await page.getByText('💪 Hoy Entrené', { exact: true }).click();

    // 350 + 100 = 450 -> sigue en nivel 1, arco al 90%.
    await expect.poll(async () => Number(await arco.getAttribute('stroke-dashoffset'))).toBeCloseTo(circ * (1 - 450 / 500), 1);
    await expect(page.getByTestId('nivel-numero')).toHaveText('1');
  });
});
