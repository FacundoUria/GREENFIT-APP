import { supabase } from './supabase';
import { withTimeout } from './withTimeout';

// T4 -- cancelar una reserva y decir la VERDAD sobre el crédito.
//
// Antes, Home y Agenda llamaban a cancel_booking(), que devolvía true siempre
// que cancelaba (se hubiera devuelto el crédito o no), y mostraban "Te
// devolvimos el crédito." aunque el lote ya estuviera vencido. Ahora llaman a
// cancel_booking_detalle(), que devuelve qué pasó y el texto para el socio
// (lo arma el servidor: ver supabase_migration_t4_cancel_booking_detalle.sql en
// el repo del Admin):
//   reintegrado  true solo si de verdad se sumó el crédito
//   motivo       reintegrado | reintegrado_plan | pago_anulado | lote_vencido |
//                lote_de_otro_plan | sin_plan_disciplina | aparatos_sin_creditos
//   vence        "YYYY-MM-DD" del lote al que volvió el crédito (o null)
//   mensaje      el texto que se le muestra al socio
//
// Los errores (fuera del límite de minutos, ya no tenía la reserva, sin
// conexión) se LANZAN con el mensaje del servidor, igual que antes (R5).
//
// D-T4c -- si cancel_booking_detalle todavía no existe (o se hizo rollback del
// SQL), se cae a cancel_booking con un texto NEUTRO ("Reserva cancelada."):
// nunca se le afirma al socio que se le devolvió algo que no sabemos.

export type MotivoCancelacion =
  | 'reintegrado'
  | 'reintegrado_plan'
  | 'pago_anulado'
  | 'lote_vencido'
  | 'lote_de_otro_plan'
  | 'sin_plan_disciplina'
  | 'aparatos_sin_creditos'
  | 'desconocido';

export type ResultadoCancelacion = {
  reintegrado: boolean;
  motivo: MotivoCancelacion;
  vence: string | null;
  mensaje: string;
};

export const MENSAJE_NEUTRO = 'Reserva cancelada.';

// D-T4d -- mismo timeout que ya tenía Agenda para reservar/cancelar (Home no
// tenía ninguno: con el wifi colgado, el spinner quedaba para siempre).
export const CANCELAR_TIMEOUT_MS = 20_000;
export const CANCELAR_TIMEOUT_MESSAGE = 'Esto está tardando demasiado. Revisá tu conexión e intentá de nuevo.';

// PostgREST: la función no existe en el schema (todavía no se corrió la
// migración, o se hizo rollback).
function esFuncionInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('could not find the function') || (m.includes('function') && m.includes('does not exist'));
}

export async function cancelarReserva(
  classId: string,
  bookingDate: string,
  reason: string | null
): Promise<ResultadoCancelacion> {
  const params = { p_class_id: classId, p_booking_date: bookingDate, p_reason: reason || null };

  const { data, error } = await withTimeout(
    supabase.rpc('cancel_booking_detalle', params),
    CANCELAR_TIMEOUT_MS,
    CANCELAR_TIMEOUT_MESSAGE
  );
  if (!error) {
    const r = (data ?? {}) as Partial<ResultadoCancelacion> & { motivo?: string };
    return {
      reintegrado: r.reintegrado === true,
      motivo: (r.motivo as MotivoCancelacion) ?? 'desconocido',
      vence: r.vence ?? null,
      mensaje: typeof r.mensaje === 'string' && r.mensaje.trim() !== '' ? r.mensaje : MENSAJE_NEUTRO,
    };
  }
  if (!esFuncionInexistente(error)) throw new Error(error.message);

  // Fallback: la función vieja. No dice si devolvió el crédito de verdad
  // (antes de T4 devolvía true siempre), así que el texto es neutro.
  const viejo = await withTimeout(supabase.rpc('cancel_booking', params), CANCELAR_TIMEOUT_MS, CANCELAR_TIMEOUT_MESSAGE);
  if (viejo.error) throw new Error(viejo.error.message);
  return { reintegrado: false, motivo: 'desconocido', vence: null, mensaje: MENSAJE_NEUTRO };
}
