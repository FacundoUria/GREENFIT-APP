import { getInitials } from '../../screens/user/PerfilMobileView';

// El cálculo de nivel se movió a xpApi.ts (calcularResumenXp/fetchTotalXp)
// -- ver src/__tests__/lib/xpApi.test.ts. PerfilMobileView ya no tiene su
// propia fórmula de nivel.

describe('getInitials', () => {
  it('devuelve las iniciales de nombre y apellido', () => {
    expect(getInitials('Facundo Uria')).toBe('FU');
  });

  it('devuelve 2 letras si solo hay un nombre', () => {
    expect(getInitials('Martina')).toBe('MA');
  });

  it('usa primer y último nombre si hay varios', () => {
    expect(getInitials('Juan Carlos Pérez')).toBe('JP');
  });

  it('devuelve "?" ante un nombre vacío', () => {
    expect(getInitials('   ')).toBe('?');
  });
});
