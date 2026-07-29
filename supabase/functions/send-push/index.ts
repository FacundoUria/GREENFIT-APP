import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import webpush from 'https://esm.sh/web-push@3.6.7';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient, requireAdmin } from '../_shared/adminGuard.ts';

interface SendPushBody {
  title: string;
  body: string;
  audience: 'all' | 'class' | 'user' | 'debtors';
  targetClassId?: string;
  targetUserId?: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Resuelve a qué profiles (socios) les toca este anuncio, mismo criterio que
// la policy notifications_select_recipient del schema (pero acá corren
// contra la tabla directo, con Service Role, porque el resultado no depende
// de quién esté logueado sino de la audiencia elegida por el admin).
async function resolveUserIds(admin: ReturnType<typeof createAdminClient>, body: SendPushBody): Promise<string[]> {
  if (body.audience === 'all') {
    const { data } = await admin.from('profiles').select('id').eq('role', 'socio');
    return (data ?? []).map((r) => r.id);
  }
  if (body.audience === 'user') {
    return body.targetUserId ? [body.targetUserId] : [];
  }
  if (body.audience === 'class') {
    if (!body.targetClassId) return [];
    const { data } = await admin.from('bookings').select('user_id').eq('class_id', body.targetClassId);
    return [...new Set((data ?? []).map((r) => r.user_id))];
  }
  if (body.audience === 'debtors') {
    const { data } = await admin.rpc('debtor_user_ids');
    return (data ?? []).map((row: unknown) => (typeof row === 'string' ? row : (row as { debtor_user_ids: string }).debtor_user_ids));
  }
  return [];
}

// Dispara el anuncio real: guarda la notificación (historial in-app, ya
// resuelto por audiencia vía RLS del lado del socio) y manda el Web Push a
// cada suscripción activa de esos socios -- llega aunque tengan la PWA
// cerrada, que es justo lo que un simple insert en `notifications` no hace.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = createAdminClient();

  try {
    const sender = await requireAdmin(req, admin);
    const body: SendPushBody = await req.json();

    if (!body.title?.trim() || !body.body?.trim()) {
      return jsonResponse({ error: 'Falta el título o el mensaje.' }, 400);
    }
    if (!['all', 'class', 'user', 'debtors'].includes(body.audience)) {
      return jsonResponse({ error: 'Audiencia inválida.' }, 400);
    }

    const userIds = await resolveUserIds(admin, body);
    if (userIds.length === 0) {
      return jsonResponse({ error: 'No hay destinatarios para esa audiencia.' }, 400);
    }

    const { error: insertError } = await admin.from('notifications').insert({
      sender_id: sender.id,
      audience_type: body.audience,
      target_class_id: body.targetClassId ?? null,
      target_user_id: body.targetUserId ?? null,
      title: body.title.trim(),
      body: body.body.trim(),
    });
    if (insertError) {
      return jsonResponse({ error: insertError.message }, 400);
    }

    // La suscripción viaja entera como jsonb en `subscription`
    // ({endpoint, keys:{p256dh,auth}}) -- no como columnas planas.
    const { data: subs, error: subsError } = await admin
      .from('push_subscriptions')
      .select('subscription')
      .in('user_id', userIds);
    if (subsError) {
      return jsonResponse({ error: subsError.message }, 400);
    }

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@greenfit.fit';
    if (!vapidPublic || !vapidPrivate) {
      return jsonResponse({ error: 'Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY configuradas en los secrets.' }, 500);
    }
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const payload = JSON.stringify({ title: body.title.trim(), body: body.body.trim() });

    let enviados = 0;
    let expirados = 0;
    const errores: string[] = [];

    for (const sub of subs ?? []) {
      const s = sub.subscription as { endpoint: string; keys: { p256dh: string; auth: string } };
      if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) continue;

      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, payload);
        enviados++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // El navegador ya revocó esta suscripción (desinstaló la PWA, borró
          // datos, etc.) -- limpiarla para no seguir intentando en vano.
          await admin.from('push_subscriptions').delete().eq('subscription->>endpoint', s.endpoint);
          expirados++;
        } else {
          errores.push(err instanceof Error ? err.message : String(err));
        }
      }
    }

    return jsonResponse(
      {
        destinatarios: userIds.length,
        suscripciones: (subs ?? []).length,
        enviados,
        expirados,
        errores,
      },
      200
    );
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: 'Error inesperado enviando el anuncio.' }, 500);
  }
});
