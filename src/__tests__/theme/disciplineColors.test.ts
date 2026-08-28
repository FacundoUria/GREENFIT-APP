import { getDisciplineStyle } from '../../theme/disciplineColors';

describe('getDisciplineStyle', () => {
  it('mapea CrossFit a ciano', () => {
    expect(getDisciplineStyle('CrossFit').color).toBe('#22D3EE');
  });

  it('mapea Boxeo y Kickstrike al mismo rojo neón', () => {
    expect(getDisciplineStyle('Boxeo').color).toBe('#FF3B5C');
    expect(getDisciplineStyle('Kickstrike').color).toBe('#FF3B5C');
  });

  it('no distingue mayúsculas/tildes ("cross fit" no matchea pero "CROSSFIT" sí)', () => {
    expect(getDisciplineStyle('CROSSFIT').color).toBe('#22D3EE');
  });

  it('hace match parcial para nombres compuestos ("CrossFit Avanzado")', () => {
    expect(getDisciplineStyle('CrossFit Avanzado').color).toBe('#22D3EE');
  });

  it('devuelve un color de la paleta de respaldo -- determinístico -- para una disciplina no mapeada', () => {
    const primera = getDisciplineStyle('Yoga Restaurativo');
    const segunda = getDisciplineStyle('Yoga Restaurativo');
    expect(primera.color).toBe(segunda.color);
    expect(primera.icon).toBe('barbell-outline');
  });
});
