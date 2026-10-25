import { getExpiryStatus, getCreditsStatus } from '../../lib/membershipStatus';

// T2 (regla D) -- el corte de un vencimiento elegido por Seba se guarda como el
// FIN de ese día en Argentina: 23:59:59.999999 (UTC-3) = 02:59:59.999999 UTC
// del día SIGUIENTE. Así lo devuelve PostgREST. Estos tests fijan que el estado
// se calcula con el día en Argentina, no con el día UTC (`slice(0, 10)`) ni con
// el huso del teléfono.
const FIN_DEL_30_10_AR = '2026-10-31T02:59:59.999999+00:00';
const FIN_DEL_31_10_AR = '2026-11-01T02:59:59.999999+00:00';
// Los lotes viejos que vencen a las 00:00 de Argentina se siguen viendo igual.
const CERO_HORAS_DEL_31_10_AR = '2026-10-31T03:00:00+00:00';
// 25/10 a las 12:00 en Argentina.
const MEDIODIA_25_10_AR = new Date('2026-10-25T15:00:00Z');

describe('getExpiryStatus -- día de vencimiento y "hoy" en hora Argentina (T2)', () => {
  const TZ_ORIGINAL = process.env.TZ;

  afterEach(() => {
    if (TZ_ORIGINAL === undefined) delete process.env.TZ;
    else process.env.TZ = TZ_ORIGINAL;
  });

  it('corte a fin del día: cuenta el día elegido, no el día UTC siguiente (a 5 días = "por vencer")', () => {
    // Con slice(0, 10) daba 31/10 -> 6 días -> 'activo'.
    expect(getExpiryStatus(FIN_DEL_30_10_AR, MEDIODIA_25_10_AR)).toBe('por_vencer');
    expect(getExpiryStatus(FIN_DEL_31_10_AR, MEDIODIA_25_10_AR)).toBe('activo');
  });

  it('el último día se usa entero: hasta las 23:30 en Argentina sigue "por vencer", no "vencido"', () => {
    const ultimoDia2330 = new Date('2026-10-31T02:30:00Z'); // 30/10 23:30 en Argentina
    expect(getExpiryStatus(FIN_DEL_30_10_AR, ultimoDia2330)).toBe('por_vencer');
  });

  it('al día siguiente (00:00 en Argentina) ya es "vencido"', () => {
    const diaSiguiente = new Date('2026-10-31T03:00:00Z'); // 31/10 00:00 en Argentina
    expect(getExpiryStatus(FIN_DEL_30_10_AR, diaSiguiente)).toBe('vencido');
  });

  it('un lote viejo a las 00:00 de Argentina se ve con su fecha de siempre', () => {
    expect(getExpiryStatus(CERO_HORAS_DEL_31_10_AR, MEDIODIA_25_10_AR)).toBe('activo'); // 6 días
    expect(getExpiryStatus(CERO_HORAS_DEL_31_10_AR, new Date('2026-10-26T15:00:00Z'))).toBe('por_vencer'); // 5 días
  });

  it('un pago hecho a las 21:30 de Argentina (ya es el día siguiente en UTC) cuenta el día argentino', () => {
    // 21:30 del 30/10 en Argentina = 00:30 UTC del 31/10. Con slice(0, 10) daba 31/10.
    expect(getExpiryStatus('2026-10-31T00:30:00+00:00', MEDIODIA_25_10_AR)).toBe('por_vencer');
  });

  it('el resultado no depende del huso del teléfono (UTC ni Australia)', () => {
    process.env.TZ = 'UTC';
    expect(getExpiryStatus(FIN_DEL_30_10_AR, MEDIODIA_25_10_AR)).toBe('por_vencer');
    process.env.TZ = 'Australia/Sydney';
    expect(getExpiryStatus(FIN_DEL_30_10_AR, MEDIODIA_25_10_AR)).toBe('por_vencer');
    expect(getExpiryStatus(FIN_DEL_30_10_AR, new Date('2026-10-31T03:00:00Z'))).toBe('vencido');
  });

  it('una fecha "solo día" (YYYY-MM-DD) se toma tal cual', () => {
    expect(getExpiryStatus('2026-10-30', MEDIODIA_25_10_AR)).toBe('por_vencer');
    expect(getExpiryStatus('2026-10-24', MEDIODIA_25_10_AR)).toBe('vencido');
  });

  it('sin fecha es "vencido"', () => {
    expect(getExpiryStatus(null, MEDIODIA_25_10_AR)).toBe('vencido');
  });
});

describe('getCreditsStatus (sin cambios)', () => {
  it('con saldo es activo; en 0 o null, vencido', () => {
    expect(getCreditsStatus(3)).toBe('activo');
    expect(getCreditsStatus(0)).toBe('vencido');
    expect(getCreditsStatus(null)).toBe('vencido');
  });
});
