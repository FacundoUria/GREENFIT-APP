// Único lugar de la PWA para "cómo se ve una fecha" -- antes cada pantalla
// le pedía a `Intl` su propio conjunto de campos (o, en HistoryScreen.tsx,
// ninguno -- toLocaleDateString('es-AR') a secas, cuyo formato exacto
// dependía del motor JS). formatShortDate() es el reemplazo de eso: dd/mm/
// yyyy, siempre con cero a la izquierda, siempre con año de 4 dígitos.
//
// Esto NO reemplaza los formatos de fecha CORTA por diseño (formatDayLabel
// de classTime.ts, formatCardTime de NotificacionesMobileView.tsx,
// formatFechaCorta de ProgresoMobileView.tsx, ni los textos "hero" con
// nombre de mes en letras de AgendaMobileView.tsx/ReservaConfirmadaModal.tsx)
// -- esos muestran una fecha corta o en letras a propósito, por espacio o
// por diseño, no por descuido. Alcance confirmado explícitamente: solo se
// unifican los sitios que YA mostraban una fecha completa.
export function formatShortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// "2026-08-16" -> "16 de Agosto, 2026" -- mudado de membershipStatus.ts (un
// archivo que no es "de fechas") a este módulo, sin cambiar su formato: es
// un texto largo con nombre de mes, deliberadamente distinto de
// formatShortDate(), para el badge de vencimiento de membresía.
export function formatLongDate(dateStr: string): string {
  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  const mes = MESES[date.getMonth()];
  return `${date.getDate()} de ${mes.charAt(0).toUpperCase()}${mes.slice(1)}, ${date.getFullYear()}`;
}

// Mudado acá desde AgendaMobileView.tsx y ReservaConfirmadaModal.tsx, donde
// vivía duplicado tal cual en los dos -- hace falta porque toLocaleDateString
// con weekday/month en letras devuelve el string en minúscula para 'es-AR'
// ("viernes 5 de septiembre"), y esas dos pantallas lo muestran como título.
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
