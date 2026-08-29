import { test, expect } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase, DISCIPLINA_APARATOS, HOY_STR } from './support/fixtures';
import { irATab } from './support/nav';

// Contrato de sincronización de XP Admin -> PWA (checklist punto 2).
//
// greenfit-app (esta PWA) y "PAGINA SUPABASE" (el panel admin) son DOS
// aplicaciones separadas, cada una con su propia suite E2E contra un
// backend 100% mockeado a nivel de red (nunca Supabase real -- ver el
// comentario de supabaseMock.ts). No hay una sesión de navegador ni una
// base compartida entre ambas suites, así que un solo test no puede
// literalmente "abrir el Admin, tocar Check-in Rápido, y ver la PWA
// actualizarse" -- eso sería un test de integración contra Supabase real,
// que decidimos NO hacer para no arriesgar tocar producción en CI.
//
// En su lugar, el contrato se prueba de los dos lados por separado:
//   1) admin/e2e/checkin-rapido.spec.js prueba que el Admin manda el
//      user_id EXACTO del socio buscado al RPC admin_otorgar_checkin_musculacion.
//   2) ESTE spec prueba que, si xp_events tiene una fila con la MISMA forma
//      exacta que ese RPC inserta (ver supabase_migration_xp_disciplina.sql:
//      event_type='asistencia', xp_amount=100, discipline_id=<membership>,
//      SIN reference_id), la PWA la suma en el total de XP -- sin importar
//      qué disciplina/origen tenga el evento. Esto es lo que garantiza que
//      un Check-in Rápido hecho desde el Admin le suma XP real al socio en
//      la PWA la próxima vez que abre/vuelve a Mi Perfil.
//
// fetchTotalXp() (src/lib/xpApi.ts) ya suma TODO xp_events por user_id sin
// filtrar por event_type ni discipline_id -- ese no era el bug. El bug real
// (ya arreglado) era que PerfilMobileView/ComunidadMobileView usaban
// useEffect en vez de useFocusEffect, así que nunca volvían a pedir el XP
// al volver a la pantalla. Este test ejercita justamente ESE camino: carga
// Perfil con 0 XP, un evento "llega" (se simula la acción del Admin
// mutando la fixture en memoria, como haría un INSERT real), y se vuelve a
// Perfil sin recargar la página -- igual que un socio que ya tiene la app
// abierta cuando Seba le hace el Check-in Rápido en el mostrador.
test('un check-in de Aparatos otorgado desde el Admin se refleja en el XP de la PWA al volver a Perfil', async ({
  page,
}) => {
  const tablas = tablasBase();
  tablas.xp_events = []; // arranca en 0 XP, como un socio sin actividad todavía.

  await loginComoSocio(page, { tables: tablas });

  await irATab(page, 'Perfil');
  await expect(page.getByText('Mi Perfil')).toBeVisible();
  // `.last()`: Inicio (montado de fondo, con su propia tarjeta de perfil
  // gamificada) ya mostró su propio "NIVEL 1"/"0 / 500 XP" al montar --
  // Perfil se montó DESPUÉS, es la última copia en el árbol.
  await expect(page.getByText('NIVEL 1').last()).toBeVisible();
  await expect(page.getByText('0 / 500 XP').last()).toBeVisible();

  // Simula el INSERT que hace admin_otorgar_checkin_musculacion en el
  // Admin -- misma forma exacta (ver supabase_migration_xp_disciplina.sql):
  // 'asistencia', +100, discipline_id de la disciplina 'membership'
  // (Aparatos), sin reference_id. `tablas` es la MISMA
  // referencia que mockSupabase sigue leyendo en cada request -- mutarla acá
  // emula un INSERT real llegando por afuera de esta sesión de la PWA.
  tablas.xp_events.push({
    id: 'xp-checkin-rapido',
    user_id: SOCIO_DEMO.id,
    event_type: 'asistencia',
    xp_amount: 100,
    discipline_id: DISCIPLINA_APARATOS.id,
    event_date: HOY_STR,
    reference_id: null,
  });

  // Vuelve a Perfil (Inicio -> Perfil) sin recargar la página -- dispara
  // useFocusEffect, que es lo que de verdad vuelve a pedir el XP real.
  await irATab(page, 'Inicio');
  await irATab(page, 'Perfil');

  await expect(page.getByText('NIVEL 1').last()).toBeVisible();
  await expect(page.getByText('100 / 500 XP').last()).toBeVisible();
});
