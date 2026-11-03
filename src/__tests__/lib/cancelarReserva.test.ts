jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { supabase } from '../../lib/supabase';
import { cancelarReserva, MENSAJE_NEUTRO, CANCELAR_TIMEOUT_MESSAGE } from '../../lib/cancelarReserva';

const mockedRpc = supabase.rpc as jest.Mock;

// T4 -- cancelar dice la verdad sobre el crédito: el resultado y el texto
// salen de cancel_booking_detalle (servidor). Antes, cancel_booking devolvía
// true siempre que cancelaba y la PWA decía "Te devolvimos el crédito."
describe('cancelarReserva (T4)', () => {
  beforeEach(() => {
    mockedRpc.mockReset();
  });

  it('llama a cancel_booking_detalle con la clase, la fecha y el motivo, y devuelve lo que dice el servidor', async () => {
    mockedRpc.mockResolvedValue({
      data: { reintegrado: true, motivo: 'reintegrado', vence: '2026-12-02', lote_id: 'l1', mensaje: 'Te devolvimos el crédito (vence el 02/12/2026).' },
      error: null,
    });

    const r = await cancelarReserva('clase-1', '2026-11-10', 'estoy enfermo');

    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(mockedRpc).toHaveBeenCalledWith('cancel_booking_detalle', {
      p_class_id: 'clase-1',
      p_booking_date: '2026-11-10',
      p_reason: 'estoy enfermo',
    });
    expect(r).toEqual({ reintegrado: true, motivo: 'reintegrado', vence: '2026-12-02', mensaje: 'Te devolvimos el crédito (vence el 02/12/2026).' });
  });

  it('sin devolución: reintegrado false y el texto del servidor (nunca "Te devolvimos")', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        reintegrado: false,
        motivo: 'lote_de_otro_plan',
        vence: null,
        mensaje: 'El crédito no se devolvió porque era de un plan anterior, no del que tenés vigente.',
      },
      error: null,
    });

    const r = await cancelarReserva('clase-1', '2026-11-10', '');

    expect(mockedRpc).toHaveBeenCalledWith('cancel_booking_detalle', { p_class_id: 'clase-1', p_booking_date: '2026-11-10', p_reason: null });
    expect(r.reintegrado).toBe(false);
    expect(r.motivo).toBe('lote_de_otro_plan');
    expect(r.mensaje).not.toMatch(/Te devolvimos/);
  });

  it('respuesta sin mensaje: texto neutro, y reintegrado solo si vino true', async () => {
    mockedRpc.mockResolvedValue({ data: { reintegrado: 'true', motivo: 'reintegrado' }, error: null });
    const r = await cancelarReserva('clase-1', '2026-11-10', null);
    expect(r.reintegrado).toBe(false);
    expect(r.mensaje).toBe(MENSAJE_NEUTRO);
  });

  it('error real del servidor (fuera del límite, ya no tenía la reserva): lo lanza con el mensaje real y NO cae a cancel_booking', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { message: 'No podés cancelar esta reserva -- faltan menos de 120 minutos para que empiece la clase.' },
    });

    await expect(cancelarReserva('clase-1', '2026-11-10', null)).rejects.toThrow(
      'No podés cancelar esta reserva -- faltan menos de 120 minutos para que empiece la clase.'
    );
    expect(mockedRpc).toHaveBeenCalledTimes(1);
  });

  it('D-T4c: si cancel_booking_detalle no existe (PGRST202), usa cancel_booking y devuelve un texto NEUTRO', async () => {
    mockedRpc.mockImplementation((fn: string) =>
      fn === 'cancel_booking_detalle'
        ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.cancel_booking_detalle' } })
        : Promise.resolve({ data: true, error: null })
    );

    const r = await cancelarReserva('clase-1', '2026-11-10', null);

    expect(mockedRpc).toHaveBeenNthCalledWith(2, 'cancel_booking', { p_class_id: 'clase-1', p_booking_date: '2026-11-10', p_reason: null });
    // cancel_booking viejo devolvía true siempre: no se le cree, el texto es neutro.
    expect(r).toEqual({ reintegrado: false, motivo: 'desconocido', vence: null, mensaje: MENSAJE_NEUTRO });
  });

  it('D-T4c: si el fallback también falla, lanza su error', async () => {
    mockedRpc.mockImplementation((fn: string) =>
      fn === 'cancel_booking_detalle'
        ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
        : Promise.resolve({ data: null, error: { message: 'No tenías una reserva en esta clase' } })
    );
    await expect(cancelarReserva('clase-1', '2026-11-10', null)).rejects.toThrow('No tenías una reserva en esta clase');
  });

  it('D-T4d: si el servidor no responde, corta a los 20 s con el mensaje de conexión', async () => {
    jest.useFakeTimers();
    try {
      mockedRpc.mockReturnValue(new Promise(() => {}));
      const promesa = cancelarReserva('clase-1', '2026-11-10', null);
      jest.advanceTimersByTime(20_000);
      await expect(promesa).rejects.toThrow(CANCELAR_TIMEOUT_MESSAGE);
    } finally {
      jest.useRealTimers();
    }
  });
});
