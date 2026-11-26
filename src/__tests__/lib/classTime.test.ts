import { getCountdown, formatCountdownEmpieza, formatClassTime } from '../../lib/classTime';

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

// Tanda visual, parte 4: formatClassTime reusa un mismo formateador (antes
// toLocaleTimeString armaba uno nuevo en cada llamada). Tiene que dar
// exactamente lo mismo que antes, y armar uno nuevo si cambia el huso.
describe('formatClassTime', () => {
  const OPCIONES = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
  const comoAntes = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', OPCIONES);
  const CASOS = ['2026-11-25T22:00:00.000Z', '2026-11-25T03:05:00.000Z', '2026-11-25T23:59:00-03:00', '2026-01-01T00:00:00.000Z'];

  afterEach(() => jest.restoreAllMocks());

  it('24 hs, dos dígitos: igual que toLocaleTimeString("es-AR") con las mismas opciones', () => {
    for (const iso of CASOS) {
      expect(formatClassTime(iso)).toMatch(/^\d{2}:\d{2}$/);
      expect(formatClassTime(iso)).toBe(comoAntes(iso));
    }
  });

  it('reusa el formateador; si cambia el huso del dispositivo, arma uno nuevo', () => {
    formatClassTime(CASOS[0]); // deja armado el del huso actual
    const constructor = jest.spyOn(Intl, 'DateTimeFormat');
    formatClassTime(CASOS[0]);
    formatClassTime(CASOS[1]);
    expect(constructor).not.toHaveBeenCalled();

    const desfasaje = new Date().getTimezoneOffset();
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(desfasaje + 60);
    formatClassTime(CASOS[0]);
    expect(constructor).toHaveBeenCalledTimes(1);
    formatClassTime(CASOS[1]);
    expect(constructor).toHaveBeenCalledTimes(1);
  });
});
