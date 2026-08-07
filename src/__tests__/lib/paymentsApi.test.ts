// Bug crítico (2026-08-07): antes, CUALQUIER error de
// create-payment-preference (desplegada o no) caía al mismo mock -- si la
// función SÍ estaba desplegada y devolvía un error real (Mercado Pago
// rechazó la preferencia, pack inactivo, etc.), la PWA igual navegaba a un
// init_point falso sin avisarle nada al socio. Estos tests fijan la
// distinción: `response` presente en el resultado de supabase-js (la
// función contestó, aunque con error) NUNCA cae al mock.
const mockInvoke = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { createPaymentPreference, PaymentPreferenceError } from '../../lib/paymentsApi';

describe('createPaymentPreference', () => {
  beforeEach(() => jest.clearAllMocks());

  it('con un initPoint real, lo devuelve tal cual', async () => {
    mockInvoke.mockResolvedValue({
      data: { initPoint: 'https://mp.test/checkout', preferenceId: 'pref-1' },
      error: null,
      response: { status: 200 },
    });

    const preference = await createPaymentPreference({ packId: 'pack-1', userId: 'user-1' });
    expect(preference).toEqual({ initPoint: 'https://mp.test/checkout', preferenceId: 'pref-1' });
    expect(mockInvoke).toHaveBeenCalledWith('create-payment-preference', { body: { packId: 'pack-1', userId: 'user-1' } });
  });

  it('la función está desplegada y contesta un error real (Mercado Pago rechazó la preferencia) -- NO cae al mock, tira PaymentPreferenceError con el mensaje real', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new Error('Function returned an error'),
      response: { status: 502, json: () => Promise.resolve({ error: 'Mercado Pago respondió 400 al crear la preferencia.' }) },
    });

    await expect(createPaymentPreference({ packId: 'pack-1', userId: 'user-1' })).rejects.toThrow(
      new PaymentPreferenceError('Mercado Pago respondió 400 al crear la preferencia.')
    );
  });

  it('la función está desplegada pero el body de error no es JSON parseable -- usa el mensaje genérico en vez de reventar', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new Error('Function returned an error'),
      response: { status: 500, json: () => Promise.reject(new Error('no es json')) },
    });

    await expect(createPaymentPreference({ packId: 'pack-1', userId: 'user-1' })).rejects.toThrow(
      new PaymentPreferenceError('No se pudo generar la orden de pago. Consultá con el gimnasio.')
    );
  });

  it('sin response (error de red real -- la función no está desplegada todavía), SÍ cae al mock', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request'), response: undefined });

    const preference = await createPaymentPreference({ packId: 'pack-1', userId: 'user-1' });
    expect(preference.initPoint).toContain('mercadopago.com.ar');
    expect(preference.preferenceId).toBeNull();
  });

  it('200 sin initPoint en el body -- tira PaymentPreferenceError en vez de navegar a una URL vacía', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null, response: { status: 200 } });

    await expect(createPaymentPreference({ packId: 'pack-1', userId: 'user-1' })).rejects.toThrow(
      new PaymentPreferenceError('No se pudo generar la orden de pago. Consultá con el gimnasio.')
    );
  });
});
