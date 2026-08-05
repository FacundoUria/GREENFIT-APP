import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import {
  checkComunidadDisponible,
  checkRankingDisponible,
  checkMensajesDisponible,
  fetchFeed,
  crearPost,
  toggleReaction,
  fetchComentarios,
  agregarComentario,
  fetchRanking,
  abrirChatPrivado,
  fetchInboxMensajes,
  fetchMensajesPrivados,
  enviarMensajePrivado,
} from '../../lib/comunidadApi';

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'eq', 'order', 'limit', 'in'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('checkComunidadDisponible (Módulo 6 -- detección de tablas reales vs. modo demo)', () => {
  afterEach(() => jest.clearAllMocks());

  it('devuelve false si community_posts todavía no existe (42P01 = undefined_table)', async () => {
    mockedFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'relation "community_posts" does not exist' },
      }),
    });
    expect(await checkComunidadDisponible()).toBe(false);
  });

  it('devuelve true si la tabla responde sin error (ya migrada)', async () => {
    mockedFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    expect(await checkComunidadDisponible()).toBe(true);
  });
});

describe('checkRankingDisponible', () => {
  afterEach(() => jest.clearAllMocks());

  it('devuelve false si el RPC community_ranking_xp no está desplegado (PGRST202)', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    expect(await checkRankingDisponible()).toBe(false);
  });

  it('devuelve true si el RPC responde', async () => {
    mockedRpc.mockResolvedValue({ data: [], error: null });
    expect(await checkRankingDisponible()).toBe(true);
  });
});

describe('checkMensajesDisponible (Mensajes/DM -- reemplaza a "Mi Box")', () => {
  afterEach(() => jest.clearAllMocks());

  it('devuelve false si el RPC community_dm_inbox no está desplegado', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    expect(await checkMensajesDisponible()).toBe(false);
  });

  it('devuelve true si el RPC responde', async () => {
    mockedRpc.mockResolvedValue({ data: [], error: null });
    expect(await checkMensajesDisponible()).toBe(true);
  });
});

describe('Ranking real -- ordena por XP total e incluye avatar_url', () => {
  afterEach(() => jest.clearAllMocks());

  it('fetchRanking en modo real llama a community_ranking_xp y mapea total_xp -> xp, avatar_url -> avatarUrl', async () => {
    mockedRpc.mockResolvedValue({
      data: [
        { user_id: 'u1', full_name: 'Lucía Fernández', avatar_url: 'https://cdn/u1.jpg', total_xp: 1850 },
        { user_id: 'u2', full_name: 'Tomás Ibarra', avatar_url: null, total_xp: 900 },
      ],
      error: null,
    });
    const ranking = await fetchRanking(false, null);
    expect(mockedRpc).toHaveBeenCalledWith('community_ranking_xp', { p_discipline_id: null });
    expect(ranking).toEqual([
      { userId: 'u1', fullName: 'Lucía Fernández', avatarUrl: 'https://cdn/u1.jpg', xp: 1850 },
      { userId: 'u2', fullName: 'Tomás Ibarra', avatarUrl: null, xp: 900 },
    ]);
  });
});

describe('Feed real -- nombre y foto de autor vía RPC (fix del bug "Socio GreenFit")', () => {
  afterEach(() => jest.clearAllMocks());

  it('resuelve full_name y avatar_url reales de otro socio a través de community_author_names, no del embed bloqueado por RLS', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'community_posts') {
        return makeChain({
          data: [
            {
              id: 'post-1',
              author_id: 'otro-socio',
              body: 'Hola comunidad',
              media_url: null,
              author_nivel: 3,
              author_discipline: 'CrossFit',
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        });
      }
      // community_reactions / community_comments para ese post
      return makeChain({ data: [], error: null });
    });
    mockedRpc.mockResolvedValue({
      data: [{ id: 'otro-socio', full_name: 'Martina Ríos', avatar_url: 'https://cdn/martina.jpg' }],
      error: null,
    });

    const feed = await fetchFeed('yo', false);

    expect(mockedRpc).toHaveBeenCalledWith('community_author_names', { p_ids: ['otro-socio'] });
    expect(feed[0].authorName).toBe('Martina Ríos');
    expect(feed[0].authorAvatarUrl).toBe('https://cdn/martina.jpg');
  });

  it('cae al fallback "Socio GreenFit" / avatar null solo si el RPC no devuelve esa fila (perfil borrado, etc.)', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'community_posts') {
        return makeChain({
          data: [
            {
              id: 'post-1',
              author_id: 'socio-borrado',
              body: 'Post huérfano',
              media_url: null,
              author_nivel: null,
              author_discipline: null,
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        });
      }
      return makeChain({ data: [], error: null });
    });
    mockedRpc.mockResolvedValue({ data: [], error: null });

    const feed = await fetchFeed('yo', false);
    expect(feed[0].authorName).toBe('Socio GreenFit');
    expect(feed[0].authorAvatarUrl).toBeNull();
  });
});

// Modo demo (tablas ausentes) no toca supabase.from/rpc en absoluto -- solo
// AsyncStorage (mockeada globalmente en jest.setup.js). Esto es justamente
// lo que corre HOY en este proyecto, porque la migración de Comunidad
// todavía no se aplicó (backend/supabase_migration_comunidad.sql).

describe('Feed en modo demo', () => {
  const userId = 'user-test-feed';

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('arranca con el feed semilla de bienvenida', async () => {
    const feed = await fetchFeed(userId, true);
    expect(feed.length).toBeGreaterThanOrEqual(2);
  });

  it('crear un post lo deja primero en el feed con nivel, disciplina y avatar del autor', async () => {
    await crearPost(
      userId,
      'Facundo Uria',
      'https://cdn/facu.jpg',
      'Rompí mi PR de Back Squat: 100kg',
      3,
      'CrossFit',
      null,
      true
    );
    const feed = await fetchFeed(userId, true);
    expect(feed[0].body).toContain('100kg');
    expect(feed[0].authorName).toBe('Facundo Uria');
    expect(feed[0].authorAvatarUrl).toBe('https://cdn/facu.jpg');
    expect(feed[0].authorNivel).toBe(3);
    expect(feed[0].authorDiscipline).toBe('CrossFit');
  });

  it('togglear "¡A tope!" sube y baja el contador de reacciones', async () => {
    await crearPost(userId, 'Facundo Uria', null, 'post de prueba', 1, null, null, true);
    const postId = (await fetchFeed(userId, true))[0].id;

    await toggleReaction(userId, postId, false, true);
    let feed = await fetchFeed(userId, true);
    expect(feed.find((p) => p.id === postId)!.reactedByMe).toBe(true);
    expect(feed.find((p) => p.id === postId)!.reactionCount).toBe(1);

    await toggleReaction(userId, postId, true, true);
    feed = await fetchFeed(userId, true);
    expect(feed.find((p) => p.id === postId)!.reactedByMe).toBe(false);
    expect(feed.find((p) => p.id === postId)!.reactionCount).toBe(0);
  });

  it('agregar un comentario sube el commentCount del post y guarda el avatar del comentarista', async () => {
    await crearPost(userId, 'Facundo Uria', null, 'post con comentarios', 1, null, null, true);
    const postId = (await fetchFeed(userId, true))[0].id;

    await agregarComentario(userId, 'Facundo Uria', 'https://cdn/facu.jpg', postId, '¡Vamos con todo!', true);
    const comentarios = await fetchComentarios(userId, postId, true);
    expect(comentarios).toHaveLength(1);
    expect(comentarios[0].body).toBe('¡Vamos con todo!');
    expect(comentarios[0].authorAvatarUrl).toBe('https://cdn/facu.jpg');

    const feed = await fetchFeed(userId, true);
    expect(feed.find((p) => p.id === postId)!.commentCount).toBe(1);
  });
});

describe('fetchRanking en modo demo', () => {
  it('devuelve una lista de ejemplo ya ordenada de mayor a menor', async () => {
    const ranking = await fetchRanking(true);
    expect(ranking.length).toBeGreaterThan(0);
    const xp = ranking.map((r) => r.xp);
    expect([...xp].sort((a, b) => b - a)).toEqual(xp);
  });
});

describe('Mensajes privados (DM) real -- vía RPCs community_dm_get_or_create/community_dm_inbox', () => {
  afterEach(() => jest.clearAllMocks());

  it('abrirChatPrivado llama al RPC get_or_create con el otro usuario y devuelve el thread id', async () => {
    mockedRpc.mockResolvedValue({ data: 'thread-abc', error: null });
    const threadId = await abrirChatPrivado('yo', 'otro-socio', 'Martina Ríos', null, false);
    expect(mockedRpc).toHaveBeenCalledWith('community_dm_get_or_create', { p_other_user_id: 'otro-socio' });
    expect(threadId).toBe('thread-abc');
  });

  it('fetchInboxMensajes mapea la bandeja real (solo hilos con mensajes)', async () => {
    mockedRpc.mockResolvedValue({
      data: [
        {
          thread_id: 'thread-abc',
          other_user_id: 'otro-socio',
          other_full_name: 'Martina Ríos',
          other_avatar_url: 'https://cdn/martina.jpg',
          last_body: 'Hola!',
          last_created_at: '2026-08-01T10:00:00.000Z',
        },
      ],
      error: null,
    });
    const inbox = await fetchInboxMensajes('yo', false);
    expect(mockedRpc).toHaveBeenCalledWith('community_dm_inbox');
    expect(inbox).toEqual([
      {
        threadId: 'thread-abc',
        otherUserId: 'otro-socio',
        otherUserName: 'Martina Ríos',
        otherAvatarUrl: 'https://cdn/martina.jpg',
        lastBody: 'Hola!',
        lastCreatedAt: '2026-08-01T10:00:00.000Z',
      },
    ]);
  });

  it('enviarMensajePrivado inserta en community_dm_messages con el thread y el autor', async () => {
    const insertMock = jest.fn().mockResolvedValue({ data: null, error: null });
    mockedFrom.mockReturnValue({ insert: insertMock });
    await enviarMensajePrivado('yo', 'Facundo Uria', null, 'thread-abc', 'Hola Martina!', false);
    expect(insertMock).toHaveBeenCalledWith({ thread_id: 'thread-abc', author_id: 'yo', body: 'Hola Martina!' });
  });
});

describe('Mensajes privados (DM) en modo demo -- persistido en AsyncStorage', () => {
  const userId = 'user-test-dm';

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('abrir un chat nuevo lo deja vacío y sin aparecer todavía en la bandeja (sin mensajes = no es "chat activo")', async () => {
    const threadId = await abrirChatPrivado(userId, 'otro-1', 'Martina Ríos', null, true);
    expect(await fetchMensajesPrivados(userId, threadId, true)).toEqual([]);
    expect(await fetchInboxMensajes(userId, true)).toEqual([]);
  });

  it('enviar un mensaje lo persiste y hace aparecer el hilo en la bandeja', async () => {
    const threadId = await abrirChatPrivado(userId, 'otro-1', 'Martina Ríos', null, true);
    await enviarMensajePrivado(userId, 'Facundo Uria', null, threadId, 'Hola!', true);

    const mensajes = await fetchMensajesPrivados(userId, threadId, true);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].body).toBe('Hola!');
    expect(mensajes[0].authorId).toBe(userId);

    const inbox = await fetchInboxMensajes(userId, true);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].otherUserName).toBe('Martina Ríos');
    expect(inbox[0].lastBody).toBe('Hola!');
  });

  it('abrir el chat con el mismo socio dos veces reutiliza el mismo hilo (no lo duplica)', async () => {
    const primero = await abrirChatPrivado(userId, 'otro-1', 'Martina Ríos', null, true);
    const segundo = await abrirChatPrivado(userId, 'otro-1', 'Martina Ríos', null, true);
    expect(segundo).toBe(primero);
  });
});
