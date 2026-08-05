import { test, expect } from '@playwright/test';
import type { Request } from '@playwright/test';
import { loginComoSocio, SOCIO_DEMO } from './support/auth';
import { tablasBase } from './support/fixtures';
import { irATab } from './support/nav';

const MARTINA_ID = 'e2e-martina-2222-2222-2222-222222222222';
const MARTINA_AVATAR = 'https://e2e-mock.supabase.co/storage/v1/object/public/avatars/martina/avatar.jpg';

const PERSONAS: Record<string, { full_name: string; avatar_url: string | null }> = {
  [SOCIO_DEMO.id]: { full_name: SOCIO_DEMO.fullName, avatar_url: null },
  [MARTINA_ID]: { full_name: 'Martina Ríos', avatar_url: MARTINA_AVATAR },
};

function fixtureAuthorNames(request: Request) {
  const body = request.postDataJSON() as { p_ids?: string[] };
  return (body?.p_ids ?? []).map((id) => ({
    id,
    full_name: PERSONAS[id]?.full_name ?? 'Socio GreenFit',
    avatar_url: PERSONAS[id]?.avatar_url ?? null,
  }));
}

// Cubre el checklist de Comunidad: la pestaña "Mensajes" reemplaza a "Mi
// Box", avatares reales en el Feed/Ranking (resueltos vía RPC, no vía el
// embed bloqueado por RLS), y el chat 1 a 1 que se abre tocando un avatar.
test.describe('PWA -- Comunidad', () => {
  function tablasConComunidad() {
    return {
      ...tablasBase(),
      community_posts: [
        {
          id: 'post-1',
          author_id: MARTINA_ID,
          body: '¡Rompí mi PR de Back Squat! 💪',
          media_url: null,
          author_nivel: 4,
          author_discipline: 'CrossFit',
          created_at: new Date().toISOString(),
        },
      ],
      community_dm_messages: [],
    };
  }

  function rpcBase() {
    return {
      community_author_names: fixtureAuthorNames,
      community_ranking_xp: [{ user_id: MARTINA_ID, full_name: 'Martina Ríos', avatar_url: MARTINA_AVATAR, total_xp: 1850 }],
      community_dm_inbox: [] as any[],
      community_dm_get_or_create: 'thread-martina-1',
    };
  }

  test('"Mensajes" reemplaza a "Mi Box" y el Feed muestra el nombre/avatar real del autor', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasConComunidad(), rpc: rpcBase() });
    await irATab(page, 'Comunidad');

    await expect(page.getByText('Mensajes', { exact: true })).toBeVisible();
    await expect(page.getByText('Mi Box')).toHaveCount(0);

    // Nombre real del autor (no "Socio GreenFit") y su foto.
    await expect(page.getByText('Martina Ríos')).toBeVisible();
    await expect(page.locator(`img[src*="martina/avatar.jpg"], [style*="martina/avatar.jpg"]`).first()).toBeVisible();
  });

  test('el Ranking muestra avatares reales y tocar una fila abre un chat privado', async ({ page }) => {
    await loginComoSocio(page, { tables: tablasConComunidad(), rpc: rpcBase() });
    await irATab(page, 'Comunidad');
    await page.getByText('Ranking', { exact: true }).click();

    await expect(page.getByText('Martina Ríos')).toBeVisible();
    await expect(page.locator(`img[src*="martina/avatar.jpg"], [style*="martina/avatar.jpg"]`).first()).toBeVisible();

    await page.getByText('Martina Ríos').click();

    // El chat que se abrió es CON MARTINA (no un chat genérico) -- confirma
    // que el tap del avatar/nombre pasó el destinatario correcto. El envío
    // en sí ya está cubierto a fondo por la suite Jest
    // (ComunidadMobileView.render.test.tsx).
    await expect(page.getByPlaceholder('Escribí un mensaje...')).toBeVisible();
    await expect(page.getByText('Martina Ríos').last()).toBeVisible();
  });
});
