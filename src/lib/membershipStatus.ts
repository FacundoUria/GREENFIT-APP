// Mismo umbral que usa el panel admin para "Cuotas por Vencer", para que el
// socio y Seba vean la misma ventana de aviso.
const DIAS_POR_VENCER = 5;

export type MembershipStatus = 'activo' | 'por_vencer' | 'vencido';

// formatLongDate() se mudó a lib/dateFormat.ts (este archivo es de estado de
// membresía, no de formateo de fechas) -- importala de ahí.

// Para membresías con vencimiento (Aparatos, Pase Libre).
// `diasTolerancia` es el mismo valor que "Días de tolerancia de pago" en
// Configuración: mientras el socio esté dentro de esa ventana, el admin no
// lo trata como vencido (queda "en tolerancia"), así que la PWA tampoco debe
// asustarlo con el badge VENCIDO -- se muestra POR VENCER hasta que se cumpla
// la tolerancia real configurada por el gimnasio.
export function getExpiryStatus(expiresAt: string | null, diasTolerancia = 0): MembershipStatus {
  if (!expiresAt) return 'vencido';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vencimiento = new Date(`${expiresAt.slice(0, 10)}T00:00:00`);
  const diasRestantes = Math.round((vencimiento.getTime() - hoy.getTime()) / 86_400_000);
  if (diasRestantes < 0) {
    return -diasRestantes <= diasTolerancia ? 'por_vencer' : 'vencido';
  }
  if (diasRestantes <= DIAS_POR_VENCER) return 'por_vencer';
  return 'activo';
}

// Para packs de créditos (CrossFit/Boxeo/Kickstrike) -- acá no hay fecha de
// vencimiento por sí, el balance en 0 ES el "vencido" (sin clases para usar).
export function getCreditsStatus(remainingCredits: number | null): MembershipStatus {
  return (remainingCredits ?? 0) > 0 ? 'activo' : 'vencido'
}
