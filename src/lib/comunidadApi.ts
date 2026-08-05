import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { formatDateOnly } from './classesApi';

// Módulo 6 (Comunidad) -- las tablas `community_*` y el RPC
// `community_ranking_mes()` todavía NO están desplegadas en Supabase (ver
// backend/supabase_migration_comunidad.sql, escrita pero sin correr a
// propósito -- es un cambio de schema sobre producción, hay que revisarla
// antes). Este archivo intenta SIEMPRE el camino real primero; si la tabla
// no existe, cae a un "modo demo" persistido en AsyncStorage (datos de
// ejemplo, locales al dispositivo, editables) para que ComunidadMobileView
// nunca muestre una pantalla en blanco ni rota. El flag `modoDemo` lo
// resuelve la vista UNA vez al cargar (checkComunidadDisponible/
// checkRankingDisponible) y se lo pasa a cada función de acá para no
// reintentar contra tablas que ya sabemos que no existen en cada tap.

export interface ComunidadPost {
  id: string;
  authorId: string;
  authorName: string;
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
  body: string;
  createdAt: string;
}

export interface ComunidadGrupo {
  id: string;
  name: string;
  createdBy: string;
  memberCount: number;
  isMember: boolean;
  // null = grupo abierto ("entre amigos"). Si tiene disciplina, solo se
  // puede sumar un socio con créditos cargados en ESA disciplina -- ver
  // puedeUnirseAGrupo() y la policy de insert en community_group_members.
  disciplineId: string | null;
  disciplineName: string | null;
}

export interface ComunidadMensaje {
  id: string;
  groupId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface RankingEntry {
  userId: string;
  fullName: string;
  xp: number;
}

export interface DisciplinaGrupal {
  id: string;
  name: string;
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

// El embed `profiles(full_name)` de PostgREST corre bajo la RLS del socio
// que MIRA el feed -- profiles_select_own_or_admin es "cada uno lo suyo",
// así que ese embed siempre volvía null para posts/comentarios/mensajes de
// OTRO socio (de ahí el bug de "Socio GreenFit" en vez del nombre real).
// Fix: un RPC security definer que devuelve solo id+full_name para un lote
// de ids (ver backend/supabase_migration_comunidad_fix_autor.sql).
async function fetchAuthorNamesMap(ids: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('community_author_names', { p_ids: uniqueIds });
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(row.id, row.full_name);
  return map;
}

// Clases con asistencia real de ESTE socio en el mes en curso, SOLO en
// disciplinas grupales (kind='credits') -- mismo criterio que el ranking:
// Musculación/Aparatos son pase libre, no reservan clases puntuales, así
// que no suman acá. Se usa para el callout "Vos: X clases" del tab Ranking.
// Siempre real, esté o no disponible el RPC de ranking grupal
// (bookings_select_own_or_admin sí permite leer las propias).
export async function fetchMisClasesDelMes(userId: string): Promise<number> {
  const now = new Date();
  const inicioMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const hoyStr = formatDateOnly(now);
  // Trae las filas (no un count directo) y filtra por kind en JS -- filtrar
  // por una columna de una tabla embebida anidada dos niveles vía .eq() es
  // frágil entre versiones de PostgREST/supabase-js; este patrón (embed +
  // filtro client-side) es el mismo que ya usa ProgresoMobileView.tsx.
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

// Gate client-side antes de intentar unirse -- da un mensaje claro en vez
// de dejar que el socio se choque con el error crudo de la policy de RLS.
// No valida vigencia/expiración puntual (eso queda para una revisión
// futura): alcanza con "tuvo o tiene créditos cargados en esa disciplina".
export async function puedeUnirseAGrupo(userId: string, disciplineId: string | null): Promise<boolean> {
  if (!disciplineId) return true;
  const { count, error } = await supabase
    .from('user_credits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('discipline_id', disciplineId);
  if (error) {
    if (isMissingRelationError(error)) return true;
    throw new Error(error.message);
  }
  return (count ?? 0) > 0;
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
// Camino real (Supabase)
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

  const [{ data: reactions, error: reactionsError }, { data: comments, error: commentsError }, authorNames] =
    await Promise.all([
      supabase.from('community_reactions').select('post_id, user_id').in('post_id', postIds),
      supabase.from('community_comments').select('post_id').in('post_id', postIds),
      fetchAuthorNamesMap((posts ?? []).map((p: any) => p.author_id)),
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

  return (posts ?? []).map((p: any) => ({
    id: p.id,
    authorId: p.author_id,
    authorName: authorNames.get(p.author_id) ?? 'Socio GreenFit',
    authorNivel: p.author_nivel,
    authorDiscipline: p.author_discipline,
    body: p.body,
    mediaUrl: p.media_url,
    createdAt: p.created_at,
    reactionCount: reactionCountByPost.get(p.id) ?? 0,
    reactedByMe: reactedByMeSet.has(p.id),
    commentCount: commentCountByPost.get(p.id) ?? 0,
  }));
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
  const authorNames = await fetchAuthorNamesMap((data ?? []).map((c: any) => c.author_id));
  return (data ?? []).map((c: any) => ({
    id: c.id,
    postId: c.post_id,
    authorId: c.author_id,
    authorName: authorNames.get(c.author_id) ?? 'Socio GreenFit',
    body: c.body,
    createdAt: c.created_at,
  }));
}

async function agregarComentarioReal(userId: string, postId: string, body: string): Promise<void> {
  const { error } = await supabase.from('community_comments').insert({ post_id: postId, author_id: userId, body });
  if (error) throw new Error(error.message);
}

async function fetchGruposReal(userId: string): Promise<ComunidadGrupo[]> {
  const [{ data: groups, error: gErr }, { data: members, error: mErr }] = await Promise.all([
    supabase.from('community_groups').select('id, name, created_by, discipline_id, disciplines(name)'),
    supabase.from('community_group_members').select('group_id, user_id'),
  ]);
  if (gErr) throw new Error(gErr.message);
  if (mErr) throw new Error(mErr.message);

  const memberCountByGroup = new Map<string, number>();
  const myGroupIds = new Set<string>();
  for (const m of members ?? []) {
    memberCountByGroup.set(m.group_id, (memberCountByGroup.get(m.group_id) ?? 0) + 1);
    if (m.user_id === userId) myGroupIds.add(m.group_id);
  }
  return (groups ?? []).map((g: any) => {
    const disciplina = Array.isArray(g.disciplines) ? g.disciplines[0] : g.disciplines;
    return {
      id: g.id,
      name: g.name,
      createdBy: g.created_by,
      memberCount: memberCountByGroup.get(g.id) ?? 0,
      isMember: myGroupIds.has(g.id),
      disciplineId: g.discipline_id,
      disciplineName: disciplina?.name ?? null,
    };
  });
}

async function crearGrupoReal(userId: string, name: string, disciplineId: string | null): Promise<string> {
  const { data, error } = await supabase
    .from('community_groups')
    .insert({ name, created_by: userId, discipline_id: disciplineId })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const { error: joinError } = await supabase.from('community_group_members').insert({ group_id: data.id, user_id: userId });
  if (joinError) throw new Error(joinError.message);
  return data.id;
}

async function unirseAGrupoReal(userId: string, groupId: string): Promise<void> {
  const { error } = await supabase.from('community_group_members').insert({ group_id: groupId, user_id: userId });
  if (error) throw new Error(error.message);
}

async function eliminarGrupoReal(groupId: string): Promise<void> {
  // RLS (community_groups_delete_own_or_admin) exige ser el creador o
  // admin -- si el socio no cumple, esto vuelve con un error que la UI
  // muestra tal cual.
  const { error } = await supabase.from('community_groups').delete().eq('id', groupId);
  if (error) throw new Error(error.message);
}

async function fetchMensajesGrupoReal(groupId: string): Promise<ComunidadMensaje[]> {
  const { data, error } = await supabase
    .from('community_group_messages')
    .select('id, group_id, author_id, body, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const authorNames = await fetchAuthorNamesMap((data ?? []).map((m: any) => m.author_id));
  return (data ?? []).map((m: any) => ({
    id: m.id,
    groupId: m.group_id,
    authorId: m.author_id,
    authorName: authorNames.get(m.author_id) ?? 'Socio GreenFit',
    body: m.body,
    createdAt: m.created_at,
  }));
}

async function enviarMensajeGrupoReal(userId: string, groupId: string, body: string): Promise<void> {
  const { error } = await supabase.from('community_group_messages').insert({ group_id: groupId, author_id: userId, body });
  if (error) throw new Error(error.message);
}

async function fetchRankingReal(disciplineId: string | null): Promise<RankingEntry[]> {
  const { data, error } = await supabase.rpc('community_ranking_xp', { p_discipline_id: disciplineId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ userId: r.user_id, fullName: r.full_name, xp: r.total_xp }));
}

// ============================================================
// Modo demo (AsyncStorage, local al dispositivo)
// ============================================================

interface DemoComentario {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}
interface DemoPost {
  id: string;
  authorId: string;
  authorName: string;
  authorNivel: number | null;
  authorDiscipline: string | null;
  body: string;
  mediaUrl: string | null;
  createdAt: string;
  reactedBy: string[];
  comments: DemoComentario[];
}
interface DemoMensaje {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}
interface DemoGrupo {
  id: string;
  name: string;
  createdBy: string;
  members: string[];
  messages: DemoMensaje[];
  disciplineId: string | null;
  disciplineName: string | null;
}
interface DemoState {
  posts: DemoPost[];
  groups: DemoGrupo[];
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
        authorNivel: null,
        authorDiscipline: null,
        body: '¡Bienvenidos a la Comunidad GreenFit! 🐾 Compartí tus entrenamientos, sumate a un grupo y no te pierdas el ranking del mes.',
        mediaUrl: null,
        createdAt: new Date(now - 2 * 3_600_000).toISOString(),
        reactedBy: [],
        comments: [],
      },
      {
        id: 'seed-2',
        authorId: 'seed-socio',
        authorName: 'Martina R.',
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
            body: '¡Vamos que se puede! 🔥',
            createdAt: new Date(now - 19 * 3_600_000).toISOString(),
          },
        ],
      },
    ],
    groups: [
      {
        id: 'seed-g1',
        name: 'CrossFit Mañana',
        createdBy: 'seed-coach',
        members: [],
        messages: [],
        disciplineId: null,
        disciplineName: 'CrossFit',
      },
      {
        id: 'seed-g2',
        name: 'Kick Team',
        createdBy: 'seed-coach',
        members: [],
        messages: [],
        disciplineId: null,
        disciplineName: 'Kickboxing',
      },
    ],
  };
}

async function loadDemoState(userId: string): Promise<DemoState> {
  try {
    const raw = await AsyncStorage.getItem(demoKey(userId));
    if (raw) return JSON.parse(raw);
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

function mapDemoGrupo(g: DemoGrupo, userId: string): ComunidadGrupo {
  return {
    id: g.id,
    name: g.name,
    createdBy: g.createdBy,
    memberCount: g.members.length,
    isMember: g.members.includes(userId),
    disciplineId: g.disciplineId,
    disciplineName: g.disciplineName,
  };
}

// ============================================================
// API pública -- unifica real/demo según `modoDemo` (resuelto una sola vez
// por la vista con checkComunidadDisponible/checkRankingDisponible)
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
    body: c.body,
    createdAt: c.createdAt,
  }));
}

export async function agregarComentario(
  userId: string,
  userName: string,
  postId: string,
  body: string,
  modoDemo: boolean
): Promise<void> {
  if (!modoDemo) return agregarComentarioReal(userId, postId, body);
  const state = await loadDemoState(userId);
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return;
  post.comments.push({ id: `local-${Date.now()}`, authorId: userId, authorName: userName, body, createdAt: new Date().toISOString() });
  await saveDemoState(userId, state);
}

export async function fetchGrupos(userId: string, modoDemo: boolean): Promise<ComunidadGrupo[]> {
  if (!modoDemo) return fetchGruposReal(userId);
  const state = await loadDemoState(userId);
  return state.groups.map((g) => mapDemoGrupo(g, userId));
}

export async function crearGrupo(
  userId: string,
  name: string,
  disciplineId: string | null,
  disciplineName: string | null,
  modoDemo: boolean
): Promise<string> {
  if (!modoDemo) return crearGrupoReal(userId, name, disciplineId);
  const state = await loadDemoState(userId);
  const id = `local-${Date.now()}`;
  state.groups.unshift({ id, name, createdBy: userId, members: [userId], messages: [], disciplineId, disciplineName });
  await saveDemoState(userId, state);
  return id;
}

export async function unirseAGrupo(userId: string, groupId: string, modoDemo: boolean): Promise<void> {
  if (!modoDemo) return unirseAGrupoReal(userId, groupId);
  const state = await loadDemoState(userId);
  const group = state.groups.find((g) => g.id === groupId);
  if (group && !group.members.includes(userId)) group.members.push(userId);
  await saveDemoState(userId, state);
}

export async function eliminarGrupo(userId: string, groupId: string, modoDemo: boolean): Promise<void> {
  if (!modoDemo) return eliminarGrupoReal(groupId);
  const state = await loadDemoState(userId);
  state.groups = state.groups.filter((g) => g.id !== groupId);
  await saveDemoState(userId, state);
}

export async function fetchMensajesGrupo(userId: string, groupId: string, modoDemo: boolean): Promise<ComunidadMensaje[]> {
  if (!modoDemo) return fetchMensajesGrupoReal(groupId);
  const state = await loadDemoState(userId);
  const group = state.groups.find((g) => g.id === groupId);
  return (group?.messages ?? []).map((m) => ({
    id: m.id,
    groupId,
    authorId: m.authorId,
    authorName: m.authorName,
    body: m.body,
    createdAt: m.createdAt,
  }));
}

export async function enviarMensajeGrupo(
  userId: string,
  userName: string,
  groupId: string,
  body: string,
  modoDemo: boolean
): Promise<void> {
  if (!modoDemo) return enviarMensajeGrupoReal(userId, groupId, body);
  const state = await loadDemoState(userId);
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  group.messages.push({ id: `local-${Date.now()}`, authorId: userId, authorName: userName, body, createdAt: new Date().toISOString() });
  await saveDemoState(userId, state);
}

// Ranking demo: SIEMPRE datos de muestra (no hay forma honesta de simular
// "el resto del box" localmente) -- ignora el filtro de disciplina, la
// vista lo bannerea como ejemplo y muestra aparte, siempre real, el XP
// propio del socio (fetchTotalXp en xpApi.ts).
export async function fetchRanking(modoDemo: boolean, disciplineId: string | null = null): Promise<RankingEntry[]> {
  if (!modoDemo) return fetchRankingReal(disciplineId);
  return [
    { userId: 'demo-1', fullName: 'Lucía Fernández', xp: 1850 },
    { userId: 'demo-2', fullName: 'Tomás Ibarra', xp: 1500 },
    { userId: 'demo-3', fullName: 'Sofía Gómez', xp: 1200 },
    { userId: 'demo-4', fullName: 'Bruno Álvarez', xp: 900 },
    { userId: 'demo-5', fullName: 'Valentina Ríos', xp: 700 },
  ];
}
