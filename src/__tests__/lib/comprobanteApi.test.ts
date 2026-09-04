jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import { subirComprobantePago, crearPagoPendiente } from '../../lib/comprobanteApi';

const mockedRpc = supabase.rpc as jest.Mock;
const mockedStorageFrom = supabase.storage.from as jest.Mock;

const FAKE_BLOB = { size: 456 } as any;

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(FAKE_BLOB) });
});

describe('subirComprobantePago (Storage bucket privado "comprobantes-pago")', () => {
  it('camino feliz: sube con un path <userId>/<timestamp>.<ext> (no fijo -- pueden mandarse varios comprobantes) y devuelve el PATH crudo (bucket privado, sin getPublicUrl)', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: null });
    mockedStorageFrom.mockReturnValue({ upload: uploadMock });

    const antes = Date.now();
    const path = await subirComprobantePago('socio-1', 'file:///tmp/comprobante.jpg');
    const despues = Date.now();

    expect(mockedStorageFrom).toHaveBeenCalledWith('comprobantes-pago');
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^socio-1\/\d+\.jpg$/),
      FAKE_BLOB,
      expect.objectContaining({ contentType: 'image/jpeg' })
    );
    // No upsert:true -- a diferencia del avatar, no debe pisar un
    // comprobante anterior (mismo criterio que subirFotoComunidad).
    expect(uploadMock.mock.calls[0][2]).not.toHaveProperty('upsert');

    expect(path).toBe(uploadMock.mock.calls[0][0]);
    const timestampEnPath = Number(path.split('/')[1].split('.')[0]);
    expect(timestampEnPath).toBeGreaterThanOrEqual(antes);
    expect(timestampEnPath).toBeLessThanOrEqual(despues);
  });

  it('si el bucket "comprobantes-pago" todavía no existe, tira un error identificable (code BUCKET_MISSING) en vez de un mensaje técnico', async () => {
    mockedStorageFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: { message: 'Bucket not found', statusCode: '404' } }),
    });

    await expect(subirComprobantePago('socio-1', 'file:///tmp/x.jpg')).rejects.toMatchObject({
      code: 'BUCKET_MISSING',
    });
  });

  it('con un error real de Storage, lo propaga tal cual (no lo tapa)', async () => {
    mockedStorageFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: { message: 'Payload too large' } }),
    });

    await expect(subirComprobantePago('socio-1', 'file:///tmp/x.jpg')).rejects.toThrow('Payload too large');
  });

  // Criterio "spinner infinito" (ya establecido para otros flujos de red de
  // esta app): si la subida se cuelga a mitad de camino (wifi del
  // gimnasio), la promesa tiene que rechazar igual -- nunca quedar
  // pendiente para siempre y dejar el botón "Enviando..." trabado.
  it('si el upload se cuelga sin resolver ni rechazar, corta con un mensaje claro en vez de quedarse esperando para siempre', async () => {
    jest.useFakeTimers();
    try {
      mockedStorageFrom.mockReturnValue({ upload: jest.fn(() => new Promise(() => {})) });

      const promesa = subirComprobantePago('socio-1', 'file:///tmp/x.jpg');
      const assertion = expect(promesa).rejects.toThrow(/tardó demasiado/i);
      jest.advanceTimersByTime(20_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('crearPagoPendiente (RPC crear_pago_pendiente_transferencia -- insert directo lo bloquea RLS)', () => {
  it('camino feliz: manda pack/comprobante/monto y devuelve el id de la fila creada', async () => {
    mockedRpc.mockResolvedValue({ data: 'pago-123', error: null });

    const id = await crearPagoPendiente({ packId: 'pack-1', comprobantePath: 'socio-1/1700.jpg', monto: 15000 });

    expect(mockedRpc).toHaveBeenCalledWith('crear_pago_pendiente_transferencia', {
      p_pack_id: 'pack-1',
      p_comprobante_url: 'socio-1/1700.jpg',
      p_monto: 15000,
    });
    expect(id).toBe('pago-123');
  });

  it('si la función todavía no está creada en este ambiente (42883/PGRST202), tira un error identificable en vez de un mensaje técnico de Postgres', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });

    await expect(
      crearPagoPendiente({ packId: 'pack-1', comprobantePath: 'x.jpg', monto: 100 })
    ).rejects.toMatchObject({ code: 'FUNCTION_MISSING' });
  });

  it('con un error real del RPC (ej. pack inactivo), lo propaga tal cual', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { message: 'El pack indicado no existe o ya no está disponible.' } });

    await expect(crearPagoPendiente({ packId: 'pack-1', comprobantePath: 'x.jpg', monto: 100 })).rejects.toThrow(
      'El pack indicado no existe o ya no está disponible.'
    );
  });
});
