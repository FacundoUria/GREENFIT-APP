import { withTimeout } from '../../lib/withTimeout';

// Item 1 del ticket ("se queda pensando y nunca concreta la inscripción"):
// el cliente de Supabase no tiene timeout por defecto -- si la conexión se
// cuelga a mitad de una request (wifi del gimnasio), la promesa de esa
// llamada podía quedar pendiente para siempre y ningún estado de carga se
// cerraba jamás. withTimeout() es la red de seguridad: acota cualquier
// promesa a un tiempo máximo.
describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resuelve con el valor real si la promesa original resuelve antes del límite', async () => {
    const promesa = withTimeout(Promise.resolve('ok'), 20_000, 'timeout');
    await expect(promesa).resolves.toBe('ok');
  });

  it('rechaza con el error real si la promesa original rechaza antes del límite (no lo tapa)', async () => {
    const promesa = withTimeout(Promise.reject(new Error('error real de la red')), 20_000, 'timeout');
    await expect(promesa).rejects.toThrow('error real de la red');
  });

  it('si la promesa original nunca resuelve ni rechaza, corta al límite con el mensaje de timeout', async () => {
    const promesaColgada = new Promise(() => {});
    const promesa = withTimeout(promesaColgada, 20_000, 'Esto está tardando demasiado.');

    const assertion = expect(promesa).rejects.toThrow('Esto está tardando demasiado.');
    jest.advanceTimersByTime(20_000);
    await assertion;
  });

  it('si la promesa original resuelve DESPUÉS del límite, ya no importa -- el timeout ganó', async () => {
    let resolverExterno: (v: string) => void;
    const promesaLenta = new Promise<string>((resolve) => {
      resolverExterno = resolve;
    });
    const promesa = withTimeout(promesaLenta, 20_000, 'timeout');

    const assertion = expect(promesa).rejects.toThrow('timeout');
    jest.advanceTimersByTime(20_000);
    await assertion;

    // Resolver tarde no debería tirar un unhandled rejection ni romper nada.
    resolverExterno!('llegó tarde');
  });
});
