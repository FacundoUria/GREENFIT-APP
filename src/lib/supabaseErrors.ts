// Errores de Supabase/Postgres que CONSERVAN el código.
//
// `throw new Error(error.message)` (el patrón de siempre en los *Api.ts)
// pierde el `code` de Postgres, y con eso la pantalla no puede distinguir un
// caso esperable y recuperable de un error real. errorConCodigo() arma el
// mismo Error (mismo mensaje) pero con `code` adentro.

export type ErrorConCodigo = Error & { code?: string };

export function errorConCodigo(error: { message: string; code?: string }): ErrorConCodigo {
  const e: ErrorConCodigo = new Error(error.message);
  e.code = error.code;
  return e;
}

// 23503 = foreign_key_violation. En Mi Rutina significa que el ejercicio que
// se quiso marcar ya no existe: el entrenador re-guardó la rutina (el panel
// Admin borra y recrea los routine_exercises con ids nuevos) mientras la
// pantalla seguía mostrando los viejos.
export const CODIGO_FK_VIOLADA = '23503';

export function esViolacionDeFk(err: unknown): boolean {
  return (err as ErrorConCodigo | null)?.code === CODIGO_FK_VIOLADA;
}
