import { APARICION, CURVA, CURVA_CSS, DURACION, TOQUE, VIBRACION, retrasoCascada } from '../../theme/motion';

// Tokens de la tanda visual: los valores acordados con Facu (referencia
// EcommerceMar). Si alguien los cambia, que sea a propósito.
describe('tokens de movimiento', () => {
  it('curva [0.22, 1, 0.36, 1], la misma en JS y en CSS', () => {
    expect(CURVA).toEqual([0.22, 1, 0.36, 1]);
    expect(CURVA_CSS).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('200 ms en toques, 600 ms en apariciones', () => {
    expect(DURACION).toEqual({ toque: 200, aparicion: 600 });
  });

  it('aparición: 24 px y cascada de 0.06 s', () => {
    expect(APARICION.desplazamiento).toBe(24);
    expect(APARICION.cascada).toBe(60);
  });

  it('toque: escala 0.96 y área mínima de 44 px', () => {
    expect(TOQUE.escala).toBe(0.96);
    expect(TOQUE.areaMinima).toBe(44);
  });

  it('vibraciones cortas, entre 10 y 15 ms', () => {
    for (const ms of Object.values(VIBRACION)) {
      expect(ms).toBeGreaterThanOrEqual(10);
      expect(ms).toBeLessThanOrEqual(15);
    }
  });

  it('retrasoCascada: 60 ms por ítem, con tope (una lista larga no espera de más)', () => {
    expect(retrasoCascada(0)).toBe(0);
    expect(retrasoCascada(1)).toBe(60);
    expect(retrasoCascada(3)).toBe(180);
    expect(retrasoCascada(APARICION.topeCascada)).toBe(APARICION.topeCascada * 60);
    expect(retrasoCascada(50)).toBe(APARICION.topeCascada * 60);
    expect(retrasoCascada(-2)).toBe(0);
  });
});
