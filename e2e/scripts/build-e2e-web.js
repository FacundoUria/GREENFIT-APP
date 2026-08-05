#!/usr/bin/env node
// Build del export web de Expo para la suite E2E, con credenciales de
// Supabase FALSAS embebidas -- NUNCA las reales.
//
// Por qué existe este script y no alcanza con `cross-env VAR=x expo
// export...`: se comprobó en la práctica que expo export lee `.env` y
// pisa cualquier EXPO_PUBLIC_* que ya estuviera seteado en el proceso (no
// respeta la convención "no sobreescribir env vars ya definidas" de
// dotenv) -- con cross-env solo, el build de e2e terminaba embebiendo la
// URL REAL de producción, y los tests de Playwright pegándole en serio al
// backend real con credenciales inventadas. La única forma confiable de
// garantizar que esto NUNCA pase es reemplazar el archivo `.env` en disco
// por uno con valores falsos mientras dura el build, y restaurar el
// original después -- pase lo que pase (por eso el try/finally, y el
// auto-heal al principio si quedó un backup de una corrida anterior que
// se cortó a la mitad).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env');
const BACKUP_PATH = path.join(ROOT, '.env.e2e-backup');

const ENV_FALSO = [
  'EXPO_PUBLIC_SUPABASE_URL=https://e2e-mock.supabase.co',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key',
  'EXPO_PUBLIC_VAPID_PUBLIC_KEY=e2e-vapid-key',
  // Desactiva el service worker (ver registerPwa.ts) -- su handler de
  // fetch re-emite requests desde su propio contexto, fuera del alcance
  // de page.route() de Playwright, y termina pegándole a la red real.
  'EXPO_PUBLIC_E2E_MODE=true',
  '',
].join('\n');

function restaurarEnvOriginal() {
  fs.rmSync(ENV_PATH, { force: true });
  if (fs.existsSync(BACKUP_PATH)) {
    fs.renameSync(BACKUP_PATH, ENV_PATH);
  }
}

// Auto-heal: si una corrida anterior se cortó antes del finally, el backup
// del .env real quedó ahí -- restaurarlo ANTES de arrancar, nunca pisarlo.
if (fs.existsSync(BACKUP_PATH)) {
  console.warn('[e2e] Encontré un .env.e2e-backup de una corrida anterior sin terminar -- restaurando antes de seguir.');
  restaurarEnvOriginal();
}

const habiaEnvReal = fs.existsSync(ENV_PATH);
if (habiaEnvReal) fs.renameSync(ENV_PATH, BACKUP_PATH);
fs.writeFileSync(ENV_PATH, ENV_FALSO);

try {
  // --clear es OBLIGATORIO acá: Metro cachea el bundle por contenido, y sin
  // esto reusa el bundle de un build anterior con las credenciales REALES
  // ya embebidas (se comprobó en la práctica -- mismo hash de archivo entre
  // corridas pese a cambiar el .env, la URL real seguía en el bundle).
  execSync('npx expo export --platform web --clear', { stdio: 'inherit', cwd: ROOT });
} finally {
  fs.rmSync(ENV_PATH, { force: true });
  if (habiaEnvReal) fs.renameSync(BACKUP_PATH, ENV_PATH);
}
