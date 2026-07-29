// One-off: crea la cuenta de Auth + profiles para cada socio de la tabla
// `socios` (panel admin) que todavía no tiene login en la app (`profiles`).
// Mismo criterio que la Edge Function admin-create-socio: email sintético
// `${dni}@greenfit.com`, password inicial = el propio DNI.
//
// No toca la tabla `socios` en ningún momento — es puramente aditivo sobre
// auth.users/profiles. Se puede correr más de una vez sin duplicar: si el
// email ya existe, Supabase devuelve "already registered" y la fila se
// cuenta como "ya existía", no como error.
//
// Uso:
//   SUPABASE_SERVICE_ROLE_KEY=xxxx node scripts/backfill_socios_auth.mjs
//   SUPABASE_SERVICE_ROLE_KEY=xxxx node scripts/backfill_socios_auth.mjs --dry-run
//   SUPABASE_SERVICE_ROLE_KEY=xxxx node scripts/backfill_socios_auth.mjs --dni 40123456
//
// La Service Role key se pasa solo por variable de entorno (nunca a un
// archivo del repo): Settings > API > service_role en el proyecto de Supabase.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const dniArgIndex = process.argv.indexOf('--dni');
const SOLO_DNI = dniArgIndex !== -1 ? process.argv[dniArgIndex + 1] : null;
const LOTE = 25; // tamaño de tanda entre pausas, para no pegarle de una a la Auth admin API
const PAUSA_MS = 300;

function leerSupabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  try {
    const contenido = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
    const match = contenido.match(/EXPO_PUBLIC_SUPABASE_URL=(.+)/);
    if (match) return match[1].trim();
  } catch {
    // sin .env local, seguimos y que falle la validación de abajo
  }
  return null;
}

function isValidDni(dni) {
  return /^\d{6,10}$/.test((dni ?? '').trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const supabaseUrl = leerSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('Falta SUPABASE_URL (o EXPO_PUBLIC_SUPABASE_URL en .env).');
  }
  if (!serviceRoleKey) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY. Pasala como variable de entorno, no la guardes en un archivo.');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(DRY_RUN ? '=== DRY RUN (no se crea nada) ===' : '=== Ejecutando backfill ===');

  let query = admin.from('socios').select('id, nombre, apellido, dni, telefono');
  if (SOLO_DNI) query = query.eq('dni', SOLO_DNI);
  const { data: socios, error: fetchError } = await query;

  if (fetchError) throw new Error(`No se pudo leer 'socios': ${fetchError.message}`);

  console.log(`Filas en 'socios' a procesar: ${socios.length}`);

  const sinDniValido = socios.filter((s) => !isValidDni(s.dni));
  const conDniValido = socios.filter((s) => isValidDni(s.dni));

  console.log(`  Sin DNI válido (se omiten, no pueden loguearse por DNI): ${sinDniValido.length}`);
  console.log(`  Con DNI válido a provisionar: ${conDniValido.length}`);

  let creados = 0;
  let yaExistian = 0;
  const errores = [];

  for (let i = 0; i < conDniValido.length; i += LOTE) {
    const lote = conDniValido.slice(i, i + LOTE);

    for (const socio of lote) {
      const dni = socio.dni.trim();
      const email = `${dni}@greenfit.com`;
      const fullName = `${socio.nombre ?? ''} ${socio.apellido ?? ''}`.trim() || 'Socio sin nombre';
      const phone = (socio.telefono ?? '').trim() || null;

      if (DRY_RUN) {
        console.log(`  [dry-run] crearía ${email} (${fullName})`);
        continue;
      }

      const { error } = await admin.auth.admin.createUser({
        email,
        password: dni,
        email_confirm: true,
        user_metadata: { full_name: fullName, dni, phone },
      });

      if (error) {
        if (error.message.toLowerCase().includes('already')) {
          yaExistian++;
        } else {
          errores.push(`DNI ${dni} (socio #${socio.id}): ${error.message}`);
        }
        continue;
      }

      creados++;
    }

    if (!DRY_RUN && i + LOTE < conDniValido.length) await sleep(PAUSA_MS);
    console.log(`  Progreso: ${Math.min(i + LOTE, conDniValido.length)}/${conDniValido.length}`);
  }

  console.log('\n=== Resumen ===');
  console.log(`Cuentas nuevas creadas:      ${creados}`);
  console.log(`Ya existían (sin cambios):   ${yaExistian}`);
  console.log(`Omitidas por DNI inválido:   ${sinDniValido.length}`);
  console.log(`Errores:                     ${errores.length}`);
  if (errores.length > 0) {
    console.log('\nDetalle de errores:');
    errores.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Error fatal en el backfill:', error.message);
  process.exitCode = 1;
});
