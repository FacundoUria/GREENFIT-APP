import { supabase } from './supabase';

// Versión vigente del texto legal (CONSENT_TEXT más abajo). Vive en código,
// no en la base -- el mecanismo para cuando el texto cambie es: alguien
// sube esta constante (ej. a 'v2') y, automáticamente, cualquier socio que
// solo tenga aceptada la versión anterior vuelve a ver la pantalla completa
// la próxima vez que reserve (fetchTieneConsentimientoVigente filtra por
// esta versión exacta). Ver supabase_migration_consentimiento_informado.sql.
export const CONSENT_VERSION = 'v1';

// Texto legal completo -- EXACTO, no parafrasear. Se muestra una sola vez
// por versión, en ConsentModal.tsx (pantalla completa, scrolleable).
export const CONSENT_TEXT = `Declaración de salud y consentimiento para realizar actividad física

Antes de reservar una clase, declaro que:
- La información que proporciono respecto de mi estado de salud es verdadera, completa y se encuentra actualizada.
- Informaré al establecimiento y/o al profesor sobre cualquier lesión, enfermedad, síntoma, limitación física, medicación o condición que pueda afectar mi participación en las actividades.
- Declaro encontrarme, según mi leal saber y entender, en condiciones de realizar actividad física.
- Comprendo que la práctica de actividad física y entrenamiento puede implicar riesgos inherentes, incluyendo, entre otros, caídas, golpes, lesiones, mareos, descompensaciones u otras situaciones imprevistas.
- Me comprometo a respetar las indicaciones de los profesores, utilizar correctamente los elementos y detener la actividad si presento algún síntoma o malestar.
- Se recomienda contar con una evaluación médica y el correspondiente apto para realizar actividad física, especialmente ante antecedentes o condiciones de salud que puedan requerirlo.
- Entiendo que la presentación de un certificado médico no reemplaza mi obligación de informar cambios o circunstancias relevantes respecto de mi estado de salud.

Declaro haber leído y comprendido esta información y acepto las condiciones de ingreso y participación del establecimiento.`;

// Texto corto de reafirmación -- se pide SIEMPRE en BookingConfirmModal
// (cada reserva, incluso el mismo día que se aceptó CONSENT_TEXT por primera
// vez). Es solo fricción de UI antes de confirmar, no un registro legal
// aparte -- no se guarda en la base (el registro legal fuerte es la
// aceptación completa en consentimientos_socio).
export const CONSENT_TEXT_SHORT =
  'Declaro que mi estado de salud no ha cambiado desde mi última declaración y que me encuentro en condiciones de realizar la actividad.';

// Ver el gate de contacto de emergencia en AgendaMobileView.tsx para el
// razonamiento general de este tipo de chequeo -- a diferencia de aquel,
// este es fail-closed a propósito (decisión explícita del cliente): es un
// registro legal, así que ante un error real de red/consulta no se deja
// avanzar a reservar sin poder confirmar que el consentimiento vigente
// existe. `error` viaja en el resultado (en vez de tirar acá) para que el
// caller decida el mensaje exacto a mostrar.
export async function fetchTieneConsentimientoVigente(
  userId: string
): Promise<{ tieneConsentimiento: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from('consentimientos_socio')
    .select('id')
    .eq('user_id', userId)
    .eq('version', CONSENT_VERSION)
    .limit(1);

  if (error) {
    return { tieneConsentimiento: false, error: error.message };
  }
  return { tieneConsentimiento: (data ?? []).length > 0, error: null };
}

// Inserta la aceptación de la versión vigente, con nombre/DNI actuales del
// socio como snapshot (si edita su perfil después, este registro puntual no
// cambia -- ver la migración). Nunca hay UPDATE: cada aceptación es una fila
// nueva, aunque ya exista una de una versión anterior.
export async function registrarConsentimiento(
  userId: string,
  nombreDeclarado: string,
  dniDeclarado: string
): Promise<void> {
  const { error } = await supabase.from('consentimientos_socio').insert({
    user_id: userId,
    version: CONSENT_VERSION,
    nombre_declarado: nombreDeclarado,
    dni_declarado: dniDeclarado,
  });
  if (error) throw new Error(error.message);
}
