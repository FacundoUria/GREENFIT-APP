// Formato manual (no Intl.NumberFormat) — mismo motivo que en classTime.ts:
// el motor JS embebido (Hermes) no siempre trae los datos de locale es-AR
// completos, así que no hay que confiar en que el sistema formatee bien.
export function formatCurrency(amount: number | null | undefined): string {
  const value = Math.round(amount ?? 0);
  const withThousands = Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$ ${value < 0 ? '-' : ''}${withThousands}`;
}
