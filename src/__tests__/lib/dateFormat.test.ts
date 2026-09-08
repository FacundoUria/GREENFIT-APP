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

  it('acepta un timestamp completo (no solo fecha), ignorando la hora para el resultado', () => {
    expect(formatShortDate('2026-09-05T23:59:00.000Z')).toMatch(/^0[45]\/09\/2026$/); // según huso horario del entorno de test
  });
});

// formatLongDate() se mudó acá desde membershipStatus.ts -- mismo formato,
// mismo comportamiento, solo cambió de archivo (ese no es "de fechas").
describe('formatLongDate (mudado desde membershipStatus.ts, sin cambios de formato)', () => {
  it('arma "D de Mes, AAAA" con el mes capitalizado', () => {
    expect(formatLongDate('2026-08-16')).toBe('16 de Agosto, 2026');
  });

  it('funciona con un ISO completo (solo usa los primeros 10 caracteres)', () => {
    expect(formatLongDate('2026-08-16T14:30:00.000Z')).toBe('16 de Agosto, 2026');
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
