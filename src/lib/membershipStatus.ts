// Mismo umbral que usa el panel admin para "Cuotas por Vencer", para que el
// socio y Seba vean la misma ventana de aviso.
const DIAS_POR_VENCER = 5;

export type MembershipStatus = 'activo' | 'por_vencer' | 'vencido';

// formatLongDate() se mudó a lib/dateFormat.ts (este archivo es de estado de
// membresía, no de formateo de fechas) -- importala de ahí.

// Día calendario en Argentina ("YYYY-MM-DD") de un timestamp -- mismo patrón
// que claveDiaArgentina() de creditsApi.ts. Un valor "solo fecha" ya es el día.
const formateadorDiaArgentina = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Mendoza',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function diaArgentina(valor: string | Date): string {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return formateadorDiaArgentina.format(valor instanceof Date ? valor : new Date(valor));
}

// Para membresías con vencimiento (Aparatos, Pase Libre).
//
// CAMBIO 1 (sacar "En Tolerancia"/ventana de gracia del todo, Admin y PWA,
// sin excepción) -- ANTES, pasado el vencimiento, esto seguía devolviendo
// 'por_vencer' mientras el socio estuviera dentro de `diasTolerancia`
// (mismo valor que "Días de tolerancia de pago" en Configuración, ya sacado
// de esa pantalla del Admin -- ver Configuracion.jsx). Se sacó por
// completo: pasada la fecha, es 'vencido' de inmediato, sin ningún margen.
//
// T2 (regla D) -- el día de vencimiento y el "hoy" se calculan en hora
// ARGENTINA, igual que el Admin y el SQL (`at time zone`). ANTES esto hacía
// `expiresAt.slice(0, 10)`, que es el día en UTC: un corte a fin del día
// (23:59:59.999999 en Argentina = 02:59:59 UTC del día SIGUIENTE) o un pago
// hecho entre las 21:00 y las 23:59 daba un día de más. Y `hoy` salía del
// huso del teléfono, no de Argentina.
//
// `ahora`: inyectable para tests; por defecto, el instante actual.
export function getExpiryStatus(expiresAt: string | null, ahora: Date = new Date()): MembershipStatus {
  if (!expiresAt) return 'vencido';
  const vencimiento = Date.parse(`${diaArgentina(expiresAt)}T00:00:00Z`);
  const hoy = Date.parse(`${diaArgentina(ahora)}T00:00:00Z`);
  const diasRestantes = Math.round((vencimiento - hoy) / 86_400_000);
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= DIAS_POR_VENCER) return 'por_vencer';
  return 'activo';
}

// Para packs de créditos (CrossFit/Boxeo/Kickstrike) -- acá no hay fecha de
// vencimiento por sí, el balance en 0 ES el "vencido" (sin clases para usar).
export function getCreditsStatus(remainingCredits: number | null): MembershipStatus {
  return (remainingCredits ?? 0) > 0 ? 'activo' : 'vencido'
}
