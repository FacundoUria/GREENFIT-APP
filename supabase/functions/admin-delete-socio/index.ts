import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient, requireAdmin } from '../_shared/adminGuard.ts';

interface DeleteSocioBody {
  userId: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Borra la cuenta de un socio: auth.admin.deleteUser() elimina el auth.users,
// que cascadea a profiles (on delete cascade) y de ahí a user_credits,
// credit_transactions, bookings y booking_cancellations (todas on delete
// cascade). Requiere Service Role, no está disponible con la anon key.
// Bloqueado a propósito para role !== 'socio': no se puede borrar un admin
// desde acá (ni por error ni auto-eliminarse).
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = createAdminClient();

  try {
    await requireAdmin(req, admin);

    const { userId }: DeleteSocioBody = await req.json();
    if (!userId) {
      return jsonResponse({ error: 'Falta userId.' }, 400);
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return jsonResponse({ error: 'No se encontró ese socio.' }, 404);
    }
    if (profile.role !== 'socio') {
      return jsonResponse({ error: 'Esta acción solo puede borrar cuentas de socio.' }, 400);
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: 'Error inesperado eliminando el socio.' }, 500);
  }
});
