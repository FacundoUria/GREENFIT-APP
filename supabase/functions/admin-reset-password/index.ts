import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient, requireAdmin } from '../_shared/adminGuard.ts';

interface ResetPasswordBody {
  userId: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Resetea la contraseña de un socio de vuelta a su DNI (el default). Requiere
// Service Role porque auth.admin.updateUserById() no está disponible con la
// anon key.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = createAdminClient();

  try {
    await requireAdmin(req, admin);

    const { userId }: ResetPasswordBody = await req.json();
    if (!userId) {
      return jsonResponse({ error: 'Falta userId.' }, 400);
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('dni')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.dni) {
      return jsonResponse({ error: 'Ese socio no tiene DNI cargado, no se puede resetear.' }, 400);
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password: profile.dni });
    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: 'Error inesperado reseteando la contraseña.' }, 500);
  }
});
