import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { formatDateOnly } from './classesApi';

// Módulo Comunidad -- las tablas `community_*` (Feed/Reacciones/Comentarios)
// y el RPC `community_ranking_xp()` pueden no estar desplegadas todavía en
// este ambiente (ver backend/supabase_migration_comunidad.sql y
// supabase_migration_xp.sql). Este archivo intenta SIEMPRE el camino real
// primero; si la tabla/función no existe, cae a un "modo demo" persistido
// en AsyncStorage (datos de ejemplo, locales al dispositivo, editables)
// para que ComunidadMobileView nunca muestre una pantalla en blanco ni
// rota. El flag `modoDemo` lo resuelve la vista UNA vez al cargar
// (checkComunidadDisponible/checkRankingDisponible/checkMensajesDisponible)
// y se lo pasa a cada función de acá para no reintentar contra tablas que
// ya sabemos que no existen en cada tap.
//
// "Mi Box" (grupos por disciplina) se reemplazó por "Mensajes" (chats
// privados 1 a 1) -- decisión explícita del usuario: las tablas
// community_groups* de supabase_migration_comunidad.sql NO se tocaron ni se
// borraron, solo dejaron de estar enganchadas desde acá.

export interface ComunidadPost {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorNivel: number | null;
  authorDiscipline: string | null;
  body: string;
  mediaUrl: string | null;
  createdAt: string;
  reactionCount: number;
  reactedByMe: boolean;
  commentCount: number;
}

export interface ComunidadComentario {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
}

export interface RankingEntry {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  xp: number;
}

export interface DisciplinaGrupal {
  id: string;
  name: string;
}

// -- Mensajes privados (chats 1 a 1) --

export interface DmThreadResumen {
  threadId: string;
  otherUserId: string;
  otherUserName: string;
  otherAvatarUrl: string | null;
  lastBody: string;
  lastCreatedAt: string;
}

export interface DmMensaje {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
}

// 42P01 = undefined_table (Postgres). PGRST205/PGRST202 = PostgREST no
// encuentra la tabla/función en su schema cache -- las tres apuntan a
// "esto todavía no existe en la base", no a un error real de la app.
function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find');
}

export async function checkComunidadDisponible(): Promise<boolean> {
  const { error } = await supabase.from('community_posts').select('id').limit(1);
  return !(error && isMissingRelationError(error));
}

export async function checkRankingDisponible(): Promise<boolean> {
  const { error } = await supabase.rpc('community_ranking_xp');
  return !(error && isMissingRelationError(error));
}

export async function checkMensajesDisponible(): Promise<boolean> {
  const { error } = await supabase.rpc('community_dm_inbox');
  return !(error && isMissingRelationError(error));
}

// El embed `profiles(full_name, avatar_url)` de PostgREST corre bajo la RLS
// del socio que MIRA el feed -- profiles_select_own_or_admin es "cada uno lo
// suyo", así que ese embed siempre volvía null para posts/comentarios/
// mensajes de OTRO socio (de ahí el bug de "Socio GreenFit" en vez del
// nombre real, y lo mismo pasaría con la foto). Fix: un RPC security
// definer que devuelve id+full_name+avatar_url para un lote de ids (ver
// backend/supabase_migration_comunidad_fix_autor.sql +
// supabase_migration_avatar.sql).
interface AuthorInfo {
  fullName: string;
  avatarUrl: string | null;
}

async function fetchAuthorInfoMap(ids: string[]): Promise<Map<string, AuthorInfo>> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('community_author_names', { p_ids: uniqueIds });
  if (error) throw new Error(error.message);
  const map = new Map<string, AuthorInfo>();
  for (const row of data ?? []) map.set(row.id, { fullName: row.full_name, avatarUrl: row.avatar_url ?? null });
  return map;
}

// Clases con asistencia real de ESTE socio en el mes en curso, SOLO en
// disciplinas grupales (kind='credits') -- mismo criterio que el ranking:
// Aparatos son pase libre, no reservan clases puntuales, así
// que no suman acá. Se usa para el callout "Vos: X clases" del tab Ranking
// cuando hay un filtro de disciplina activo (distinto de xpApi.fetchClasesDelMes,
// que suma TODAS las disciplinas).
export async function fetchMisClasesDelMes(userId: string): Promise<number> {
  const now = new Date();
  const inicioMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const hoyStr = formatDateOnly(now);
  const { data, error } = await supabase
    .from('bookings')
    .select('id, classes!inner(disciplines!inner(kind))')
    .eq('user_id', userId)
    .eq('attended', true)
    .gte('booking_date', inicioMes)
    .lte('booking_date', hoyStr);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((row: any) => {
    const clase = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    const disciplina = Array.isArray(clase?.disciplines) ? clase.disciplines[0] : clase?.disciplines;
    return disciplina?.kind === 'credits';
  }).length;
}

export async function fetchDisciplinasGrupales(): Promise<DisciplinaGrupal[]> {
  const { data, error } = await supabase
    .from('disciplines')
    .select('id, name')
    .eq('kind', 'credits')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

// ============================================================
// Storage (foto real del composer) -- independiente de si community_posts
// ya existe: el bucket puede estar creado o no sin relación con las tablas.
// ============================================================

function isMissingBucketError(error: { message?: string; statusCode?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('bucket not found') || error.statusCode === '404';
}

export async function subirFotoComunidad(userId: string, localUri: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = localUri.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('community-media')
    .upload(path, blob, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
  if (error) {
    if (isMissingBucketError(error)) {
      throw Object.assign(new Error('El bucket de fotos todavía no está creado.'), { code: 'BUCKET_MISSING' });
    }
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from('community-media').getPublicUrl(path);
  return data.publicUrl;
}

// ============================================================
// Camino real (Supabase) -- Feed
// ============================================================

async function fetchFeedReal(userId: string): Promise<ComunidadPost[]> {
  const { data: posts, error } = await supabase
    .from('community_posts')
    .select('id, author_id, body, media_url, author_nivel, author_discipline, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  const postIds = (posts ?? []).map((p: any) => p.id);
  if (postIds.length === 0) return [];

  const [{ data: reactions, error: reactionsError }, { data: comments, error: commentsError }, authorInfo] =
    await Promise.all([
      supabase.from('community_reactions').select('post_id, user_id').in('post_id', postIds),
      supabase.from('community_comments').select('post_id').in('post_id', postIds),
      fetchAuthorInfoMap((posts ?? []).map((p: any) => p.author_id)),
    ]);
  if (reactionsError) throw new Error(reactionsError.message);
  if (commentsError) throw new Error(commentsError.message);

  const reactionCountByPost = new Map<string, number>();
  const reactedByMeSet = new Set<string>();
  for (const r of reactions ?? []) {
    reactionCountByPost.set(r.post_id, (reactionCountByPost.get(r.post_id) ?? 0) + 1);
    if (r.user_id === userId) reactedByMeSet.add(r.post_id);
  }
  const commentCountByPost = new Map<string, number>();
  for (const c of comments ?? []) {
    commentCountByPost.set(c.post_id, (commentCountByPost.get(c.post_id) ?? 0) + 1);
  }

  return (posts ?? []).map((p: any) => {
    const info = authorInfo.get(p.author_id);
    return {
      id: p.id,
      authorId: p.author_id,
      authorName: info?.fullName ?? 'Socio GreenFit',
      authorAvatarUrl: info?.avatarUrl ?? null,
      authorNivel: p.author_nivel,
      authorDiscipline: p.author_discipline,
      body: p.body,
      mediaUrl: p.media_url,
      createdAt: p.created_at,
      reactionCount: reactionCountByPost.get(p.id) ?? 0,
      reactedByMe: reactedByMeSet.has(p.id),
      commentCount: commentCountByPost.get(p.id) ?? 0,
    };
  });
}

async function crearPostReal(
  userId: string,
  body: string,
  authorNivel: number | null,
  authorDiscipline: string | null,
  mediaUrl: string | null
): Promise<void> {
  const { error } = await supabase.from('community_posts').insert({
    author_id: userId,
    body,
    author_nivel: authorNivel,
    author_discipline: authorDiscipline,
    media_url: mediaUrl,
    media_type: mediaUrl ? 'image' : null,
  });
  if (error) throw new Error(error.message);
}

async function toggleReactionReal(userId: string, postId: string, currentlyReacted: boolean): Promise<void> {
  if (currentlyReacted) {
    const { error } = await supabase.from('community_reactions').delete().eq('post_id', postId).eq('user_id', userId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('community_reactions').insert({ post_id: postId, user_id: userId });
    if (error) throw new Error(error.message);
  }
}

async function fetchComentariosReal(postId: string): Promise<ComunidadComentario[]> {
  const { data, error } = await supabase
    .from('community_comments')
    .select('id, post_id, author_id, body, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const authorInfo = await fetchAuthorInfoMap((data ?? []).map((c: any) => c.author_id));
  return (data ?? []).map((c: any) => {
    const info = authorInfo.get(c.author_id);
    return {
      id: c.id,
      postId: c.post_id,
      authorId: c.author_id,
      authorName: info?.fullName ?? 'Socio GreenFit',
      authorAvatarUrl: info?.avatarUrl ?? null,
      body: c.body,
      createdAt: c.created_at,
    };
  });
}

async function agregarComentarioReal(userId: string, postId: string, body: string): Promise<void> {
  const { error } = await supabase.from('community_comments').insert({ post_id: postId, author_id: userId, body });
  if (error) throw new Error(error.message);
}

async function fetchRankingReal(disciplineId: string | null): Promise<RankingEntry[]> {
  const { data, error } = await supabase.rpc('community_ranking_xp', { p_discipline_id: disciplineId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    fullName: r.full_name,
    avatarUrl: r.avatar_url ?? null,
    xp: r.total_xp,
  }));
}

// ============================================================
// Camino real (Supabase) -- Mensajes privados
// ============================================================

async function abrirChatPrivadoReal(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('community_dm_get_or_create', { p_other_user_id: otherUserId });
  if (error) throw new Error(error.message);
  return data as string;
}

async function fetchInboxMensajesReal(): Promise<DmThreadResumen[]> {
  const { data, error } = await supabase.rpc('community_dm_inbox');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    threadId: row.thread_id,
    otherUserId: row.other_user_id,
    otherUserName: row.other_full_name ?? 'Socio GreenFit',
    otherAvatarUrl: row.other_avatar_url ?? null,
    lastBody: row.last_body,
    lastCreatedAt: row.last_created_at,
  }));
}

async function fetchMensajesPrivadosReal(threadId: string): Promise<DmMensaje[]> {
  const { data, error } = await supabase
    .from('community_dm_messages')
    .select('id, thread_id, author_id, body, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const authorInfo = await fetchAuthorInfoMap((data ?? []).map((m: any) => m.author_id));
  return (data ?? []).map((m: any) => {
    const info = authorInfo.get(m.author_id);
    return {
      id: m.id,
      threadId: m.thread_id,
      authorId: m.author_id,
      authorName: info?.fullName ?? 'Socio GreenFit',
      authorAvatarUrl: info?.avatarUrl ?? null,
      body: m.body,
      createdAt: m.created_at,
    };
  });
}

async function enviarMensajePrivadoReal(userId: string, threadId: string, body: string): Promise<void> {
  const { error } = await supabase.from('community_dm_messages').insert({ thread_id: threadId, author_id: userId, body });
  if (error) throw new Error(error.message);
}

// ============================================================
// Modo demo (AsyncStorage, local al dispositivo)
// ============================================================

interface DemoComentario {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
}
interface DemoPost {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorNivel: number | null;
  authorDiscipline: string | null;
  body: string;
  mediaUrl: string | null;
  createdAt: string;
  reactedBy: string[];
  comments: DemoComentario[];
}
interface DemoDmMensaje {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
}
interface DemoDmThread {
  id: string;
  otherUserId: string;
  otherUserName: string;
  otherAvatarUrl: string | null;
  messages: DemoDmMensaje[];
}
interface DemoState {
  posts: DemoPost[];
  dmThreads: DemoDmThread[];
}

function demoKey(userId: string): string {
  return `greenfit:comunidad-demo:${userId}`;
}

function buildSeedDemoState(): DemoState {
  const now = Date.now();
  return {
    posts: [
      {
        id: 'seed-1',
        authorId: 'seed-coach',
        authorName: 'Equipo GreenFit',
        authorAvatarUrl: null,
        authorNivel: null,
        authorDiscipline: null,
        body: '¡Bienvenidos a la Comunidad GreenFit! 🐾 Compartí tus entrenamientos y no te pierdas el ranking del mes.',
        mediaUrl: null,
        createdAt: new Date(now - 2 * 3_600_000).toISOString(),
        reactedBy: [],
        comments: [],
      },
      {
        id: 'seed-2',
        authorId: 'seed-socio',
        authorName: 'Martina R.',
        authorAvatarUrl: null,
        authorNivel: 4,
        authorDiscipline: 'CrossFit',
        body: '¡Rompí mi PR de Back Squat esta semana! 💪 Gracias equipo por el empuje de siempre.',
        mediaUrl: null,
        createdAt: new Date(now - 20 * 3_600_000).toISOString(),
        reactedBy: [],
        comments: [
          {
            id: 'seed-c1',
            authorId: 'seed-coach',
            authorName: 'Equipo GreenFit',
            authorAvatarUrl: null,
            body: '¡Vamos que se puede! 🔥',
            createdAt: new Date(now - 19 * 3_600_000).toISOString(),
          },
        ],
      },
    ],
    dmThreads: [],
  };
}

async function loadDemoState(userId: string): Promise<DemoState> {
  try {
    const raw = await AsyncStorage.getItem(demoKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      // Normaliza estado guardado por una versión anterior de la demo (antes
      // tenía `groups` en vez de `dmThreads`) -- sin esto, un dispositivo que
      // ya usó la Comunidad en modo demo antes de este cambio rompería acá.
      return { posts: parsed.posts ?? [], dmThreads: parsed.dmThreads ?? [] };
    }
  } catch {
    // sigue al seed de abajo
  }
  const seed = buildSeedDemoState();
  await saveDemoState(userId, seed);
  return seed;
}

async function saveDemoState(userId: string, state: DemoState): Promise<void> {
  try {
    await AsyncStorage.setItem(demoKey(userId), JSON.stringify(state));
  } catch {
    // Best-effort -- ver mismo criterio en Progreso/Notificaciones.
  }
}

function mapDemoPost(p: DemoPost, userId: string): ComunidadPost {
  return {
    id: p.id,
    authorId: p.authorId,
    authorName: p.authorName,
    authorAvatarUrl: p.authorAvatarUrl,
    authorNivel: p.authorNivel,
    authorDiscipline: p.authorDiscipline,
    body: p.body,
    mediaUrl: p.mediaUrl,
    createdAt: p.createdAt,
    reactionCount: p.reactedBy.length,
    reactedByMe: p.reactedBy.includes(userId),
    commentCount: p.comments.length,
  };
}

function dmDemoThreadId(otherUserId: string): string {
  return `dm-${otherUserId}`;
}

// ============================================================
// API pública -- unifica real/demo según `modoDemo` (resuelto una sola vez
// por la vista con checkComunidadDisponible/checkRankingDisponible/
// checkMensajesDisponible)
// ============================================================

export async function fetchFeed(userId: string, modoDemo: boolean): Promise<ComunidadPost[]> {
  if (!modoDemo) return fetchFeedReal(userId);
  const state = await loadDemoState(userId);
  return state.posts
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((p) => mapDemoPost(p, userId));
}

export async function crearPost(
  userId: string,
  userName: string,
  userAvatarUrl: string | null,
  body: string,
  authorNivel: number | null,
  authorDiscipline: string | null,
  mediaUrl: string | null,
  modoDemo: boolean
): Promise<void> {
  if (!modoDemo) return crearPostReal(userId, body, authorNivel, authorDiscipline, mediaUrl);
  const state = await loadDemoState(userId);
  state.posts.unshift({
    id: `local-${Date.now()}`,
    authorId: userId,
    authorName: userName,
    authorAvatarUrl: userAvatarUrl,
    authorNivel,
    authorDiscipline,
    body,
    mediaUrl,
    createdAt: new Date().toISOString(),
    reactedBy: [],
    comments: [],
  });
  await saveDemoState(userId, state);
}

export async function toggleReaction(
  userId: string,
  postId: string,
  currentlyReacted: boolean,
  modoDemo: boolean
): Promise<void> {
  if (!modoDemo) return toggleReactionReal(userId, postId, currentlyReacted);
  const state = await loadDemoState(userId);
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return;
  post.reactedBy = currentlyReacted ? post.reactedBy.filter((id) => id !== userId) : [...post.reactedBy, userId];
  await saveDemoState(userId, state);
}

export async function fetchComentarios(userId: string, postId: string, modoDemo: boolean): Promise<ComunidadComentario[]> {
  if (!modoDemo) return fetchComentariosReal(postId);
  const state = await loadDemoState(userId);
  const post = state.posts.find((p) => p.id === postId);
  return (post?.comments ?? []).map((c) => ({
    id: c.id,
    postId,
    authorId: c.authorId,
    authorName: c.authorName,
    authorAvatarUrl: c.authorAvatarUrl,
    body: c.body,
    createdAt: c.createdAt,
  }));
}

export async function agregarComentario(
  userId: string,
  userName: string,
  userAvatarUrl: string | null,
  postId: string,
  body: string,
  modoDemo: boolean
): Promise<void> {
  if (!modoDemo) return agregarComentarioReal(userId, postId, body);
  const state = await loadDemoState(userId);
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return;
  post.comments.push({
    id: `local-${Date.now()}`,
    authorId: userId,
    authorName: userName,
    authorAvatarUrl: userAvatarUrl,
    body,
    createdAt: new Date().toISOString(),
  });
  await saveDemoState(userId, state);
}

// Ranking demo: SIEMPRE datos de muestra (no hay forma honesta de simular
// "el resto del box" localmente) -- ignora el filtro de disciplina, la
// vista lo bannerea como ejemplo y muestra aparte, siempre real, el XP
// propio del socio (fetchTotalXp en xpApi.ts).
export async function fetchRanking(modoDemo: boolean, disciplineId: string | null = null): Promise<RankingEntry[]> {
  if (!modoDemo) return fetchRankingReal(disciplineId);
  return [
    { userId: 'demo-1', fullName: 'Lucía Fernández', avatarUrl: null, xp: 1850 },
    { userId: 'demo-2', fullName: 'Tomás Ibarra', avatarUrl: null, xp: 1500 },
    { userId: 'demo-3', fullName: 'Sofía Gómez', avatarUrl: null, xp: 1200 },
    { userId: 'demo-4', fullName: 'Bruno Álvarez', avatarUrl: null, xp: 900 },
    { userId: 'demo-5', fullName: 'Valentina Ríos', avatarUrl: null, xp: 700 },
  ];
}

// -- Mensajes privados --

// Abre (o crea) el hilo 1 a 1 con `otherUserId` -- se llama al tocar un
// avatar/nombre en el Feed o el Ranking. `otherUserName`/`otherAvatarUrl`
// solo se usan en modo demo (ahí no hay servidor que los resuelva); en modo
// real el propio caller ya los tiene de la fila que tocó, no hace falta
// mandarlos de vuelta.
export async function abrirChatPrivado(
  userId: string,
  otherUserId: string,
  otherUserName: string,
  otherAvatarUrl: string | null,
  modoDemo: boolean
): Promise<string> {
  if (!modoDemo) return abrirChatPrivadoReal(otherUserId);
  const state = await loadDemoState(userId);
  const threadId = dmDemoThreadId(otherUserId);
  if (!state.dmThreads.find((t) => t.id === threadId)) {
    state.dmThreads.unshift({ id: threadId, otherUserId, otherUserName, otherAvatarUrl, messages: [] });
    await saveDemoState(userId, state);
  }
  return threadId;
}

// Bandeja de "Mensajes" -- solo hilos con al menos un mensaje real ("chats
// activos", no hilos recién abiertos y abandonados sin escribir nada).
export async function fetchInboxMensajes(userId: string, modoDemo: boolean): Promise<DmThreadResumen[]> {
  if (!modoDemo) return fetchInboxMensajesReal();
  const state = await loadDemoState(userId);
  return state.dmThreads
    .filter((t) => t.messages.length > 0)
    .map((t) => {
      const last = t.messages[t.messages.length - 1];
      return {
        threadId: t.id,
        otherUserId: t.otherUserId,
        otherUserName: t.otherUserName,
        otherAvatarUrl: t.otherAvatarUrl,
        lastBody: last.body,
        lastCreatedAt: last.createdAt,
      };
    })
    .sort((a, b) => new Date(b.lastCreatedAt).getTime() - new Date(a.lastCreatedAt).getTime());
}

export async function fetchMensajesPrivados(userId: string, threadId: string, modoDemo: boolean): Promise<DmMensaje[]> {
  if (!modoDemo) return fetchMensajesPrivadosReal(threadId);
  const state = await loadDemoState(userId);
  const thread = state.dmThreads.find((t) => t.id === threadId);
  return (thread?.messages ?? []).map((m) => ({
    id: m.id,
    threadId,
    authorId: m.authorId,
    authorName: m.authorName,
    authorAvatarUrl: m.authorAvatarUrl,
    body: m.body,
    createdAt: m.createdAt,
  }));
}

// En modo demo, el mensaje enviado se guarda pero no hay nadie "del otro
// lado" que responda -- mismo criterio ya asumido para el ranking demo (no
// hay forma honesta de simular al resto del box localmente).
export async function enviarMensajePrivado(
  userId: string,
  userName: string,
  userAvatarUrl: string | null,
  threadId: string,
  body: string,
  modoDemo: boolean
): Promise<void> {
  if (!modoDemo) return enviarMensajePrivadoReal(userId, threadId, body);
  const state = await loadDemoState(userId);
  const thread = state.dmThreads.find((t) => t.id === threadId);
  if (!thread) return;
  thread.messages.push({
    id: `local-${Date.now()}`,
    authorId: userId,
    authorName: userName,
    authorAvatarUrl: userAvatarUrl,
    body,
    createdAt: new Date().toISOString(),
  });
  await saveDemoState(userId, state);
}
