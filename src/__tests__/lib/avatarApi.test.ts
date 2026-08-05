jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import { checkAvatarDisponible, subirAvatarPerfil } from '../../lib/avatarApi';

const mockedFrom = supabase.from as jest.Mock;
const mockedStorageFrom = supabase.storage.from as jest.Mock;

const FAKE_BLOB = { size: 123 } as any;

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(FAKE_BLOB) });
});

function makeUpdateChain(result: any) {
  return { update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue(result) })) };
}

describe('checkAvatarDisponible (detección de la columna profiles.avatar_url)', () => {
  it('devuelve false si la columna todavía no existe (42703 = undefined_column)', async () => {
    mockedFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: null, error: { code: '42703', message: 'column does not exist' } }),
    });
    expect(await checkAvatarDisponible()).toBe(false);
  });

  it('devuelve true si la columna responde', async () => {
    mockedFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    expect(await checkAvatarDisponible()).toBe(true);
  });
});

describe('subirAvatarPerfil (Storage bucket "avatars" + profiles.avatar_url)', () => {
  it('camino feliz: sube a Storage, actualiza profiles.avatar_url y devuelve una URL con cache-busting', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: null });
    const getPublicUrlMock = jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn/avatars/user-1/avatar.jpg' } });
    mockedStorageFrom.mockReturnValue({ upload: uploadMock, getPublicUrl: getPublicUrlMock });
    mockedFrom.mockReturnValue(makeUpdateChain({ data: null, error: null }));

    const url = await subirAvatarPerfil('user-1', 'file:///tmp/foto.jpg');

    expect(uploadMock).toHaveBeenCalledWith(
      'user-1/avatar.jpg',
      FAKE_BLOB,
      expect.objectContaining({ contentType: 'image/jpeg', upsert: true })
    );
    expect(url).toMatch(/^https:\/\/cdn\/avatars\/user-1\/avatar\.jpg\?t=\d+$/);
  });

  it('si el bucket "avatars" todavía no está creado, tira un error identificable (code BUCKET_MISSING)', async () => {
    mockedStorageFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: { message: 'Bucket not found', statusCode: '404' } }),
      getPublicUrl: jest.fn(),
    });

    await expect(subirAvatarPerfil('user-1', 'file:///tmp/foto.jpg')).rejects.toMatchObject({ code: 'BUCKET_MISSING' });
  });

  it('si profiles.avatar_url todavía no existe como columna, tira un error identificable (code COLUMN_MISSING)', async () => {
    mockedStorageFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn/avatars/user-1/avatar.jpg' } }),
    });
    mockedFrom.mockReturnValue(makeUpdateChain({ data: null, error: { code: '42703', message: 'column does not exist' } }));

    await expect(subirAvatarPerfil('user-1', 'file:///tmp/foto.jpg')).rejects.toMatchObject({ code: 'COLUMN_MISSING' });
  });
});
