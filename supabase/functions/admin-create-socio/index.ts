import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient, requireAdmin } from '../_shared/adminGuard.ts';

interface CreateSocioBody {
  fullName: string;
  dni: string;
  phone: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Crea el usuario de Auth de un socio nuevo con DNI como identificador:
// email sintético `${dni}@greenfit.com`, password inicial = el propio DNI,
// email_confirm:true para saltar la verificación por correo (no tiene
// sentido para un email que el socio nunca ve). Necesita Service Role
// porque auth.admin.createUser() no está disponible con la anon key.
// Nombre, DNI y teléfono son obligatorios y quedan en profiles vía el
// trigger handle_new_user, que los toma de este mismo user_metadata.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = createAdminClient();

  try {
    await requireAdmin(req, admin);

    const body: CreateSocioBody = await req.json();
    const dni = body.dni?.trim();
    const fullName = body.fullName?.trim();
    const phone = body.phone?.trim();

    if (!dni || !/^\d{6,10}$/.test(dni)) {
      return jsonResponse({ error: 'DNI inválido (solo números, 6 a 10 dígitos).' }, 400);
    }
    if (!fullName) {
      return jsonResponse({ error: 'Falta el nombre completo.' }, 400);
    }
    if (!phone) {
      return jsonResponse({ error: 'Falta el teléfono.' }, 400);
    }

    const email = `${dni}@greenfit.com`;

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: dni,
      email_confirm: true,
      user_metadata: { full_name: fullName, dni, phone },
    });

    if (error) {
      const status = error.message.toLowerCase().includes('already') ? 409 : 400;
      return jsonResponse({ error: error.message }, status);
    }

    return jsonResponse({ userId: data.user!.id }, 200);
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: 'Error inesperado creando el socio.' }, 500);
  }
});
