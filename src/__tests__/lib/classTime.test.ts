import { getCountdown, formatCountdownEmpieza } from '../../lib/classTime';

// Checklist punto 3 ("Próxima Reserva" dinamizada en Home): el banner "Tu
// próxima clase" quiere un remate tipo "Empieza en 1 hora" -- getCountdown()
// en sí sigue devolviendo "En 1 hora" (lo siguen usando las tarjetas de
// Agenda, donde ese formato corto funciona bien) y formatCountdownEmpieza()
// es la variante de texto para el banner de Home.
describe('formatCountdownEmpieza', () => {
  it('una clase que arranca en más de una hora: "En X horas" -> "Empieza en X horas"', () => {
    const dentroDe3Horas = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    expect(formatCountdownEmpieza(getCountdown(dentroDe3Horas))).toBe('Empieza en 3 horas');
  });

  it('una clase que arranca en 1 hora exacta: singular ("Empieza en 1 hora", no "1 horas")', () => {
    const dentroDe1Hora = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(formatCountdownEmpieza(getCountdown(dentroDe1Hora))).toBe('Empieza en 1 hora');
  });

  it('una clase que arranca en menos de 1 hora: "Faltan X min" -> "Empieza en X min"', () => {
    const dentroDe20Min = new Date(Date.now() + 20 * 60_000).toISOString();
    expect(formatCountdownEmpieza(getCountdown(dentroDe20Min))).toBe('Empieza en 20 min');
  });

  it('una clase que ya arrancó ("En curso") no se toca -- no tiene sentido decir "Empieza en curso"', () => {
    const yaArranco = new Date(Date.now() - 5 * 60_000).toISOString();
    const countdown = getCountdown(yaArranco);
    expect(countdown.label).toBe('En curso');
    expect(formatCountdownEmpieza(countdown)).toBe('En curso');
  });
});
