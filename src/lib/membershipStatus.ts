// Mismo umbral que usa el panel admin para "Cuotas por Vencer", para que el
// socio y Seba vean la misma ventana de aviso.
const DIAS_POR_VENCER = 5;

export type MembershipStatus = 'activo' | 'por_vencer' | 'vencido';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// "2026-08-16" -> "16 de Agosto, 2026"
export function formatLongDate(dateStr: string): string {
  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  const mes = MESES[date.getMonth()];
  return `${date.getDate()} de ${mes.charAt(0).toUpperCase()}${mes.slice(1)}, ${date.getFullYear()}`;
}

// Para membresías con vencimiento (Aparatos/Musculación, Pase Libre).
export function getExpiryStatus(expiresAt: string | null): MembershipStatus {
  if (!expiresAt) return 'vencido';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vencimiento = new Date(`${expiresAt.slice(0, 10)}T00:00:00`);
  const diasRestantes = Math.round((vencimiento.getTime() - hoy.getTime()) / 86_400_000);
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= DIAS_POR_VENCER) return 'por_vencer';
  return 'activo';
}

// Para packs de créditos (CrossFit/Boxeo/Kickboxing) -- acá no hay fecha de
// vencimiento por sí, el balance en 0 ES el "vencido" (sin clases para usar).
export function getCreditsStatus(remainingCredits: number | null): MembershipStatus {
  return (remainingCredits ?? 0) > 0 ? 'activo' : 'vencido'
}
