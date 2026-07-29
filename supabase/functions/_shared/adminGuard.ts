import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

// Cliente con Service Role: bypasea RLS. Solo debe vivir acá (server-side),
// nunca en el bundle de la app.
export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Verifica que quien llama a la función tenga un JWT válido y sea admin en
// `profiles`. Tira el Response como excepción para que el caller lo devuelva
// tal cual con un simple `catch (err) { if (err instanceof Response) return err; }`.
export async function requireAdmin(req: Request, admin: SupabaseClient) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw jsonError('Falta el header Authorization.', 401);
  }

  const jwt = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(jwt);

  if (userError || !user) {
    throw jsonError('Token inválido o vencido.', 401);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || profile?.role !== 'admin') {
    throw jsonError('Esta acción requiere permisos de administrador.', 403);
  }

  return user;
}
