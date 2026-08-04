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
  fetchFeed,
  crearPost,
  toggleReaction,
  fetchComentarios,
  agregarComentario,
  fetchGrupos,
  crearGrupo,
  unirseAGrupo,
  eliminarGrupo,
  puedeUnirseAGrupo,
  fetchMensajesGrupo,
  enviarMensajeGrupo,
  fetchRanking,
} from '../../lib/comunidadApi';

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

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

  it('devuelve false si el RPC community_ranking_mes no está desplegado (PGRST202)', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    expect(await checkRankingDisponible()).toBe(false);
  });

  it('devuelve true si el RPC responde', async () => {
    mockedRpc.mockResolvedValue({ data: [], error: null });
    expect(await checkRankingDisponible()).toBe(true);
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

  it('crear un post lo deja primero en el feed con nivel y disciplina del autor', async () => {
    await crearPost(userId, 'Facundo Uria', 'Rompí mi PR de Back Squat: 100kg', 3, 'CrossFit', null, true);
    const feed = await fetchFeed(userId, true);
    expect(feed[0].body).toContain('100kg');
    expect(feed[0].authorName).toBe('Facundo Uria');
    expect(feed[0].authorNivel).toBe(3);
    expect(feed[0].authorDiscipline).toBe('CrossFit');
  });

  it('togglear "¡A tope!" sube y baja el contador de reacciones', async () => {
    await crearPost(userId, 'Facundo Uria', 'post de prueba', 1, null, null, true);
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

  it('agregar un comentario sube el commentCount del post', async () => {
    await crearPost(userId, 'Facundo Uria', 'post con comentarios', 1, null, null, true);
    const postId = (await fetchFeed(userId, true))[0].id;

    await agregarComentario(userId, 'Facundo Uria', postId, '¡Vamos con todo!', true);
    const comentarios = await fetchComentarios(userId, postId, true);
    expect(comentarios).toHaveLength(1);
    expect(comentarios[0].body).toBe('¡Vamos con todo!');

    const feed = await fetchFeed(userId, true);
    expect(feed.find((p) => p.id === postId)!.commentCount).toBe(1);
  });
});

describe('Grupos ("Mi Box") en modo demo', () => {
  const userId = 'user-test-grupos';

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('crear un grupo deja al creador como miembro automáticamente', async () => {
    await crearGrupo(userId, 'CrossFit Mañana Test', null, null, true);
    const grupos = await fetchGrupos(userId, true);
    const creado = grupos.find((g) => g.name === 'CrossFit Mañana Test');
    expect(creado?.isMember).toBe(true);
    expect(creado?.memberCount).toBe(1);
  });

  it('permite unirse a un grupo semilla existente', async () => {
    const seedGroup = (await fetchGrupos(userId, true))[0];
    expect(seedGroup.isMember).toBe(false);

    await unirseAGrupo(userId, seedGroup.id, true);
    const actualizados = await fetchGrupos(userId, true);
    expect(actualizados.find((g) => g.id === seedGroup.id)?.isMember).toBe(true);
  });

  it('envía y persiste un mensaje en el chat del grupo', async () => {
    const grupoId = await crearGrupo(userId, 'Grupo Chat Test', null, null, true);
    await enviarMensajeGrupo(userId, 'Facundo Uria', grupoId, 'Hola equipo!', true);
    const mensajes = await fetchMensajesGrupo(userId, grupoId, true);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].body).toBe('Hola equipo!');
    expect(mensajes[0].authorName).toBe('Facundo Uria');
  });

  it('crear un grupo con disciplina restringida guarda el id y el nombre', async () => {
    await crearGrupo(userId, 'CrossFit Elite', 'disc-crossfit-1', 'CrossFit', true);
    const grupos = await fetchGrupos(userId, true);
    const creado = grupos.find((g) => g.name === 'CrossFit Elite');
    expect(creado?.disciplineId).toBe('disc-crossfit-1');
    expect(creado?.disciplineName).toBe('CrossFit');
  });

  it('eliminarGrupo lo saca de la lista (creador o admin)', async () => {
    const grupoId = await crearGrupo(userId, 'Grupo a Borrar', null, null, true);
    await eliminarGrupo(userId, grupoId, true);
    const grupos = await fetchGrupos(userId, true);
    expect(grupos.find((g) => g.id === grupoId)).toBeUndefined();
  });
});

describe('puedeUnirseAGrupo (Módulo 6 -- gate de disciplina para unirse a un grupo)', () => {
  afterEach(() => jest.clearAllMocks());

  it('siempre permite unirse a un grupo sin disciplina (grupo abierto)', async () => {
    expect(await puedeUnirseAGrupo('user-1', null)).toBe(true);
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('permite unirse si el socio tiene créditos cargados en esa disciplina', async () => {
    mockedFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve({ count: 2, error: null }).then(resolve),
    });
    expect(await puedeUnirseAGrupo('user-1', 'disc-crossfit-1')).toBe(true);
  });

  it('rechaza unirse si el socio no tiene créditos en esa disciplina', async () => {
    mockedFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve({ count: 0, error: null }).then(resolve),
    });
    expect(await puedeUnirseAGrupo('user-1', 'disc-aparatos-1')).toBe(false);
  });
});

describe('fetchRanking en modo demo', () => {
  it('devuelve una lista de ejemplo ya ordenada de mayor a menor', async () => {
    const ranking = await fetchRanking(true);
    expect(ranking.length).toBeGreaterThan(0);
    const clases = ranking.map((r) => r.clases);
    expect([...clases].sort((a, b) => b - a)).toEqual(clases);
  });
});
