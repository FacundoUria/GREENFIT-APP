import { vibrar } from '../../lib/vibrar';
import { VIBRACION } from '../../theme/motion';

// Tanda visual, parte 4: vibración corta con navigator.vibrate, si existe.
// Android la tiene; iPhone no (Safari no implementa la Vibration API): ahí
// no vibra y no falla.

const nav = globalThis.navigator as Navigator & { vibrate?: unknown };
const original = Object.getOwnPropertyDescriptor(nav, 'vibrate');

afterEach(() => {
  if (original) Object.defineProperty(nav, 'vibrate', original);
  else delete nav.vibrate;
});

function ponerVibrate(fn: unknown) {
  Object.defineProperty(nav, 'vibrate', { value: fn, configurable: true, writable: true });
}

describe('vibrar', () => {
  it('12 ms al reservar y al cancelar, 15 ms al finalizar (tokens de motion.ts)', () => {
    const vibrate = jest.fn(() => true);
    ponerVibrate(vibrate);

    vibrar('reservar');
    vibrar('cancelar');
    vibrar('finalizar');

    expect(vibrate.mock.calls).toEqual([[12], [12], [15]]);
    expect(VIBRACION).toEqual({ reservar: 12, cancelar: 12, finalizar: 15 });
  });

  it('se llama con navigator como `this` (Chrome tira "Illegal invocation" si no)', () => {
    let receptor: unknown = null;
    ponerVibrate(function (this: unknown) {
      receptor = this;
      return true;
    });
    vibrar('reservar');
    expect(receptor).toBe(nav);
  });

  it('sin navigator.vibrate (iPhone): no hace nada y no falla', () => {
    delete nav.vibrate;
    expect(() => vibrar('reservar')).not.toThrow();
  });

  it('si el navegador se niega (tira), no falla', () => {
    ponerVibrate(() => {
      throw new Error('bloqueado');
    });
    expect(() => vibrar('finalizar')).not.toThrow();
  });
});
