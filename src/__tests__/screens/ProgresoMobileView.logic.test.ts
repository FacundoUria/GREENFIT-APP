import {
  duracionHoras,
  formatSegundosATexto,
  parseTextoATiempo,
  mensajeMotivador,
} from '../../screens/user/ProgresoMobileView';

describe('duracionHoras (Módulo 5 -- horas entrenadas)', () => {
  it('calcula la duración real cuando hay start/end', () => {
    const booking = { startTime: '19:00:00', endTime: '20:00:00' } as any;
    expect(duracionHoras(booking)).toBe(1);
  });

  it('calcula duraciones fraccionarias (45 min -> 0.75h)', () => {
    const booking = { startTime: '19:00:00', endTime: '19:45:00' } as any;
    expect(duracionHoras(booking)).toBe(0.75);
  });

  it('asume 1h de fallback cuando no hay endTime cargado', () => {
    const booking = { startTime: '19:00:00', endTime: null } as any;
    expect(duracionHoras(booking)).toBe(1);
  });
});

describe('formatSegundosATexto / parseTextoATiempo (PRs de tiempo, ej. WODs)', () => {
  it('formatea segundos a mm:ss', () => {
    expect(formatSegundosATexto(255)).toBe('4:15');
    expect(formatSegundosATexto(65)).toBe('1:05');
  });

  it('parsea mm:ss de vuelta a segundos (round-trip)', () => {
    expect(parseTextoATiempo('4:15')).toBe(255);
    expect(parseTextoATiempo('1:05')).toBe(65);
  });

  it('rechaza formatos inválidos', () => {
    expect(parseTextoATiempo('cuatro min')).toBeNull();
    expect(parseTextoATiempo('4:99')).toBeNull();
  });
});

describe('mensajeMotivador', () => {
  it('saluda a arrancar el mes si todavía no hizo clases', () => {
    expect(mensajeMotivador(0, 0)).toMatch(/arrancamos/i);
  });

  it('felicita fuerte con >=80% de asistencia', () => {
    expect(mensajeMotivador(85, 10)).toMatch(/fire/i);
  });

  it('da un mensaje neutro con asistencia baja pero no en cero', () => {
    expect(mensajeMotivador(20, 2)).toMatch(/sumá/i);
  });
});
