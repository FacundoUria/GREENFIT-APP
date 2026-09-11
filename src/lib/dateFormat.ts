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
// BUG ESTRUCTURAL (encontrado investigando por qué la Hero Card de Inicio
// mostraba una fecha de vencimiento distinta a la del Admin para el MISMO
// dato -- caso real Facundo Uria, DNI 44537978): esto le pedía a
// `toLocaleDateString` el día calendario SIN especificar `timeZone` --
// usaba el huso del dispositivo/motor JS que corre la PWA, no
// necesariamente Argentina. El lado SQL/Admin siempre ancla a
// 'America/Argentina/Mendoza' explícito (ver claveDiaArgentina en
// creditsApi.ts, o `at time zone 'America/Argentina/Mendoza'` en las
// funciones de Supabase) -- acá faltaba ese mismo anclaje, así que el
// mismo instante podía mostrar un día distinto según en qué huso horario
// esté configurado el teléfono del socio.
export function formatShortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Argentina/Mendoza',
  });
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// "2026-08-16" -> "16 de Agosto, 2026" -- mudado de membershipStatus.ts (un
// archivo que no es "de fechas") a este módulo, sin cambiar su formato: es
// un texto largo con nombre de mes, deliberadamente distinto de
// formatShortDate(), para el badge de vencimiento de membresía.
//
// Mismo bug estructural que formatShortDate() (ver nota de arriba), fix
// distinto porque el mecanismo era otro: en vez de un `toLocaleDateString`
// sin `timeZone`, esto armaba el string a mano leyendo
// date.getMonth()/getDate()/getFullYear() -- accesores en huso LOCAL --
// de un Date reconstruido a partir de los primeros 10 caracteres del
// input. Ahora se lee el día/mes/año YA convertidos a huso Argentina
// (mismo patrón `Intl.DateTimeFormat('en-CA', { timeZone:
// 'America/Argentina/Mendoza', ... })` que ya usa claveDiaArgentina() en
// creditsApi.ts) -- funciona igual sin importar el huso del dispositivo.
//
// Un valor "solo fecha" (YYYY-MM-DD, sin hora -- ej. una columna `date` de
// Postgres) se ancla explícitamente al mediodía Argentina (UTC-3 fijo,
// Argentina no tiene horario de verano) ANTES de convertir -- si no,
// `new Date('2026-08-16')` se interpreta como medianoche UTC, que en
// Argentina cae en la noche del día ANTERIOR (mismo bug que ya resolvió
// formatFecha() del lado del Admin).
export function formatLongDate(dateStr: string): string {
  const esSoloFecha = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const date = esSoloFecha ? new Date(`${dateStr}T12:00:00-03:00`) : new Date(dateStr);
  const [anio, mesNum, dia] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Mendoza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-');
  const mes = MESES[Number(mesNum) - 1];
  return `${Number(dia)} de ${mes.charAt(0).toUpperCase()}${mes.slice(1)}, ${anio}`;
}

// Mudado acá desde AgendaMobileView.tsx y ReservaConfirmadaModal.tsx, donde
// vivía duplicado tal cual en los dos -- hace falta porque toLocaleDateString
// con weekday/month en letras devuelve el string en minúscula para 'es-AR'
// ("viernes 5 de septiembre"), y esas dos pantallas lo muestran como título.
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
