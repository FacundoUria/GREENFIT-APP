import { formatShortDate, formatLongDate, capitalize } from '../../lib/dateFormat';

// formatShortDate() es el reemplazo de los `toLocaleDateString('es-AR')`
// dispersos por toda la app -- en particular el de HistoryScreen.tsx, que
// no pasaba ninguna opción y por lo tanto no garantizaba el cero a la
// izquierda (dependía del motor JS). Estos tests fijan el contrato: dd/mm/
// yyyy siempre.
describe('formatShortDate (dd/mm/yyyy explícito -- no depende del motor JS)', () => {
  it('día y mes de un solo dígito quedan con cero a la izquierda', () => {
    expect(formatShortDate('2026-01-05T00:00:00')).toBe('05/01/2026');
  });

  it('día y mes de dos dígitos', () => {
    expect(formatShortDate('2026-09-15T00:00:00')).toBe('15/09/2026');
  });

  it('acepta un objeto Date directo', () => {
    expect(formatShortDate(new Date(2026, 8, 5))).toBe('05/09/2026'); // mes 8 = septiembre (0-indexed)
  });

  // Antes sin `timeZone` explícito -- este resultado dependía del huso del
  // entorno de test (de ahí el matcher laxo de antes, "0[45]"). Con el fix
  // (ver describe de más abajo) es determinístico: 23:59 UTC del 5/9 son
  // las 20:59 en Argentina (UTC-3) del MISMO día.
  it('acepta un timestamp completo (no solo fecha), ignorando la hora para el resultado', () => {
    expect(formatShortDate('2026-09-05T23:59:00.000Z')).toBe('05/09/2026');
  });
});

// formatLongDate() se mudó acá desde membershipStatus.ts -- mismo formato,
// mismo comportamiento, solo cambió de archivo (ese no es "de fechas").
describe('formatLongDate (mudado desde membershipStatus.ts, sin cambios de formato)', () => {
  it('arma "D de Mes, AAAA" con el mes capitalizado', () => {
    expect(formatLongDate('2026-08-16')).toBe('16 de Agosto, 2026');
  });

  it('funciona con un ISO completo, ya convertido a huso Argentina (no solo "los primeros 10 caracteres")', () => {
    expect(formatLongDate('2026-08-16T14:30:00.000Z')).toBe('16 de Agosto, 2026');
  });
});

// BUG ESTRUCTURAL (caso real: Facundo Uria, DNI 44537978 -- la Hero Card de
// Inicio mostraba "11 de Septiembre" para el MISMO dato que el Admin
// mostraba como "10/09"). Causa: formatShortDate/formatLongDate le pedían
// el día calendario a `Intl`/`Date` SIN especificar `timeZone` -- usaban el
// huso del dispositivo, no necesariamente Argentina. Estos tests simulan
// un dispositivo en un huso DISTINTO (vía `process.env.TZ`, que Node lee
// en cada `Intl.DateTimeFormat`/`toLocaleDateString` nuevo) y confirman que
// el resultado no cambia -- ancladas a 'America/Argentina/Mendoza' de
// forma explícita, mismo criterio que ya usa el lado SQL
// (`at time zone 'America/Argentina/Mendoza'`).
describe('formatShortDate/formatLongDate -- ancladas a hora Argentina, sin importar el huso del dispositivo (fix Facundo Uria)', () => {
  const TZ_ORIGINAL = process.env.TZ;

  afterEach(() => {
    if (TZ_ORIGINAL === undefined) delete process.env.TZ;
    else process.env.TZ = TZ_ORIGINAL;
  });

  // 23:30 UTC del 10/9 son las 20:30 en Argentina (UTC-3) del MISMO día --
  // en un dispositivo en UTC, sin el fix esto mostraría "11/09" (el día
  // calendario en UTC), no "10/09" (el día real en Argentina, el mismo que
  // muestra el Admin para este dato).
  it('con el dispositivo en UTC, da el MISMO día calendario que el lado SQL', () => {
    process.env.TZ = 'UTC';
    expect(formatShortDate('2026-09-10T23:30:00.000Z')).toBe('10/09/2026');
    expect(formatLongDate('2026-09-10T23:30:00.000Z')).toBe('10 de Septiembre, 2026');
  });

  it('con el dispositivo en un huso más ADELANTADO que Argentina (ej. Australia, UTC+10/+11), sigue dando el día Argentina', () => {
    process.env.TZ = 'Australia/Sydney';
    expect(formatShortDate('2026-09-10T23:30:00.000Z')).toBe('10/09/2026');
    expect(formatLongDate('2026-09-10T23:30:00.000Z')).toBe('10 de Septiembre, 2026');
  });

  it('formatLongDate con fecha "pelada" (sin hora) -- se ancla al mediodía Argentina, no a medianoche UTC', () => {
    process.env.TZ = 'UTC';
    // Sin el ancla explícita a Argentina, medianoche UTC del 16/8 cae en
    // la noche del 15/8 en Argentina -- este test confirma que NO pasa eso.
    expect(formatLongDate('2026-08-16')).toBe('16 de Agosto, 2026');
  });
});

// capitalize() se mudó acá desde AgendaMobileView.tsx y
// ReservaConfirmadaModal.tsx, donde vivía duplicada tal cual en los dos.
describe('capitalize (mudado desde AgendaMobileView.tsx/ReservaConfirmadaModal.tsx)', () => {
  it('pone en mayúscula solo la primera letra', () => {
    expect(capitalize('viernes 5 de septiembre')).toBe('Viernes 5 de septiembre');
  });

  it('string vacío no rompe', () => {
    expect(capitalize('')).toBe('');
  });
});
