import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { getDisciplineStyle } from '../../theme/disciplineColors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  checkComunidadDisponible,
  checkRankingDisponible,
  fetchMisClasesDelMes,
  fetchDisciplinasGrupales,
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
  subirFotoComunidad,
  ComunidadPost,
  ComunidadComentario,
  ComunidadGrupo,
  ComunidadMensaje,
  RankingEntry,
  DisciplinaGrupal,
} from '../../lib/comunidadApi';
import { fetchTotalXp, calcularResumenXp, otorgarXpPost } from '../../lib/xpApi';

// Vista nueva y paralela (Módulo 6 del rediseño) -- tab de primer nivel en
// MainTabs.tsx (Comunidad es la función de retención del gym, no puede
// quedar escondida en un tile de Perfil).
//
// Real vs. demo: ver el comentario largo al principio de src/lib/comunidadApi.ts.
// En resumen, las tablas `community_*` todavía no están desplegadas
// (backend/supabase_migration_comunidad.sql existe pero no se corrió), así
// que por default esta pantalla arranca en "modo demo" -- un banner arriba
// de Feed/Grupos lo deja clarísimo, y el ranking usa datos de muestra salvo
// el conteo propio del socio (fetchMisClasesDelMes), que siempre es real.

type Tab = 'feed' | 'grupos' | 'ranking';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHoras = Math.floor(diffMin / 60);
  if (diffHoras < 24) return `hace ${diffHoras} h`;
  const diffDias = Math.floor(diffHoras / 24);
  return `hace ${diffDias} d`;
}

interface AsistenciaHistorica {
  disciplineTitle: string;
}

// Mismo query que ProgresoMobileView.fetchAsistenciasHistoricas -- se
// duplica acá por el mismo criterio (vistas paralelas, no se tocan entre
// sí). Sirve para resolver nivel + disciplina principal del USUARIO ACTUAL,
// que sí puede leer sus propias reservas bajo RLS -- y de paso, qué
// disciplinas grupales puede usar como filtro al crear un grupo restringido
// (solo puede restringir a una disciplina en la que ÉL mismo tenga
// actividad, si no su propio auto-join al crearlo chocaría contra la
// policy de RLS que exige créditos en esa disciplina).
async function fetchHistoricoPropio(userId: string): Promise<AsistenciaHistorica[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('classes!inner(title)')
    .eq('user_id', userId)
    .eq('attended', true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => {
    const clase = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    return { disciplineTitle: clase.title as string };
  });
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'grupos', label: 'Mi Box' },
  { key: 'ranking', label: 'Ranking' },
];

export default function ComunidadMobileView() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  const [modoDemo, setModoDemo] = useState(false);
  const [rankingDemo, setRankingDemo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [miNivel, setMiNivel] = useState(1);
  const [miDisciplina, setMiDisciplina] = useState<string | null>(null);
  const [misClasesDelMes, setMisClasesDelMes] = useState(0);
  const [disciplinasGrupales, setDisciplinasGrupales] = useState<DisciplinaGrupal[]>([]);
  const [misDisciplinasParaGrupo, setMisDisciplinasParaGrupo] = useState<DisciplinaGrupal[]>([]);

  const [posts, setPosts] = useState<ComunidadPost[]>([]);
  const [expandedComments, setExpandedComments] = useState<Record<string, ComunidadComentario[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const [grupos, setGrupos] = useState<ComunidadGrupo[]>([]);
  const [nuevoGrupoNombre, setNuevoGrupoNombre] = useState('');
  const [nuevoGrupoDisciplina, setNuevoGrupoDisciplina] = useState<DisciplinaGrupal | null>(null);
  const [creandoGrupo, setCreandoGrupo] = useState(false);
  const [chatGroup, setChatGroup] = useState<ComunidadGrupo | null>(null);
  const [chatMensajes, setChatMensajes] = useState<ComunidadMensaje[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [rankingDisciplina, setRankingDisciplina] = useState<DisciplinaGrupal | null>(null);

  const [composerVisible, setComposerVisible] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerImageUri, setComposerImageUri] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [feedOk, rankOk, misClases, historico, gruposDisponibles, totalXp] = await Promise.all([
        checkComunidadDisponible(),
        checkRankingDisponible(),
        fetchMisClasesDelMes(user.id),
        fetchHistoricoPropio(user.id),
        fetchDisciplinasGrupales(),
        fetchTotalXp(user.id),
      ]);
      setModoDemo(!feedOk);
      setRankingDemo(!rankOk);
      setMisClasesDelMes(misClases);
      // Mismo nivel real (XP) que muestra el badge de Mi Perfil -- se
      // snapshotea acá para author_nivel de los posteos nuevos.
      setMiNivel(calcularResumenXp(totalXp).nivel);
      setDisciplinasGrupales(gruposDisponibles);

      const conteo = new Map<string, number>();
      for (const h of historico) conteo.set(h.disciplineTitle, (conteo.get(h.disciplineTitle) ?? 0) + 1);
      const top = Array.from(conteo.entries()).sort((a, b) => b[1] - a[1])[0];
      setMiDisciplina(top ? top[0] : null);

      const misNombres = new Set(historico.map((h) => h.disciplineTitle));
      setMisDisciplinasParaGrupo(gruposDisponibles.filter((d) => misNombres.has(d.name)));

      const [feed, gruposList, rankingList] = await Promise.all([
        fetchFeed(user.id, !feedOk),
        fetchGrupos(user.id, !feedOk),
        fetchRanking(!rankOk, null),
      ]);
      setPosts(feed);
      setGrupos(gruposList);
      setRanking(rankingList);
      setRankingDisciplina(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la comunidad.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

  if (!user) return null;

  // -- Feed --

  async function handleElegirFoto() {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso necesario', 'Habilitá el acceso a tus fotos para poder adjuntar una imagen.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!resultado.canceled && resultado.assets[0]) {
      setComposerImageUri(resultado.assets[0].uri);
    }
  }

  async function handlePublicar() {
    if (!user || !composerText.trim()) return;
    setIsPosting(true);
    try {
      let mediaUrl: string | null = null;
      if (composerImageUri) {
        try {
          mediaUrl = await subirFotoComunidad(user.id, composerImageUri);
        } catch (err) {
          if (modoDemo) {
            // Sin tabla real igual no hay a quién mostrarle la foto salvo a
            // este mismo dispositivo -- la dejamos como preview local.
            mediaUrl = composerImageUri;
          } else {
            Alert.alert(
              'No se pudo subir la foto',
              err instanceof Error ? err.message : 'Intentá de nuevo o publicá sin foto.'
            );
            setIsPosting(false);
            return;
          }
        }
      }
      await crearPost(user.id, user.name, composerText.trim(), miNivel, miDisciplina, mediaUrl, modoDemo);
      // +25 XP, tope 1 por día (lo hace cumplir el índice único de
      // xp_events del lado del servidor) -- efecto secundario, no bloquea
      // la publicación si falla.
      otorgarXpPost(user.id).catch((err) => console.error('No se pudo otorgar XP de post:', err.message));
      setComposerText('');
      setComposerImageUri(null);
      setComposerVisible(false);
      setPosts(await fetchFeed(user.id, modoDemo));
    } catch (err) {
      Alert.alert('No se pudo publicar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setIsPosting(false);
    }
  }

  async function handleToggleReaction(post: ComunidadPost) {
    if (!user) return;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, reactedByMe: !p.reactedByMe, reactionCount: p.reactionCount + (p.reactedByMe ? -1 : 1) }
          : p
      )
    );
    try {
      await toggleReaction(user.id, post.id, post.reactedByMe, modoDemo);
    } catch (err) {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
      Alert.alert('No se pudo reaccionar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  async function toggleComentarios(postId: string) {
    if (!user) return;
    if (expandedComments[postId]) {
      setExpandedComments((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
      return;
    }
    try {
      setExpandedComments((prev) => ({ ...prev, [postId]: [] }));
      const comentarios = await fetchComentarios(user.id, postId, modoDemo);
      setExpandedComments((prev) => ({ ...prev, [postId]: comentarios }));
    } catch (err) {
      Alert.alert('No se pudieron cargar los comentarios', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  async function handleEnviarComentario(postId: string) {
    if (!user) return;
    const texto = (commentDraft[postId] ?? '').trim();
    if (!texto) return;
    try {
      await agregarComentario(user.id, user.name, postId, texto, modoDemo);
      setCommentDraft((prev) => ({ ...prev, [postId]: '' }));
      const comentarios = await fetchComentarios(user.id, postId, modoDemo);
      setExpandedComments((prev) => ({ ...prev, [postId]: comentarios }));
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, commentCount: comentarios.length } : p)));
    } catch (err) {
      Alert.alert('No se pudo comentar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  // -- Grupos --

  async function handleCrearGrupo() {
    if (!user || !nuevoGrupoNombre.trim()) return;
    setCreandoGrupo(true);
    try {
      await crearGrupo(
        user.id,
        nuevoGrupoNombre.trim(),
        nuevoGrupoDisciplina?.id ?? null,
        nuevoGrupoDisciplina?.name ?? null,
        modoDemo
      );
      setNuevoGrupoNombre('');
      setNuevoGrupoDisciplina(null);
      setGrupos(await fetchGrupos(user.id, modoDemo));
    } catch (err) {
      Alert.alert('No se pudo crear el grupo', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setCreandoGrupo(false);
    }
  }

  async function handleUnirseGrupo(grupo: ComunidadGrupo) {
    if (!user) return;
    try {
      const elegible = await puedeUnirseAGrupo(user.id, grupo.disciplineId);
      if (!elegible) {
        Alert.alert(
          'Grupo restringido',
          `"${grupo.name}" es solo para socios con créditos en ${grupo.disciplineName ?? 'esa disciplina'}.`
        );
        return;
      }
      await unirseAGrupo(user.id, grupo.id, modoDemo);
      setGrupos(await fetchGrupos(user.id, modoDemo));
    } catch (err) {
      Alert.alert('No se pudo unir al grupo', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  function handleEliminarGrupo(grupo: ComunidadGrupo) {
    Alert.alert('Eliminar grupo', `¿Eliminar "${grupo.name}"? Esta acción no se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (!user) return;
          try {
            await eliminarGrupo(user.id, grupo.id, modoDemo);
            if (chatGroup?.id === grupo.id) setChatGroup(null);
            setGrupos(await fetchGrupos(user.id, modoDemo));
          } catch (err) {
            Alert.alert('No se pudo eliminar', err instanceof Error ? err.message : 'Intentá de nuevo.');
          }
        },
      },
    ]);
  }

  async function abrirChatGrupo(grupo: ComunidadGrupo) {
    if (!user) return;
    setChatGroup(grupo);
    setChatLoading(true);
    try {
      setChatMensajes(await fetchMensajesGrupo(user.id, grupo.id, modoDemo));
    } catch (err) {
      Alert.alert('No se pudieron cargar los mensajes', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setChatLoading(false);
    }
  }

  async function handleEnviarMensaje() {
    if (!user || !chatGroup || !chatDraft.trim()) return;
    try {
      await enviarMensajeGrupo(user.id, user.name, chatGroup.id, chatDraft.trim(), modoDemo);
      setChatDraft('');
      setChatMensajes(await fetchMensajesGrupo(user.id, chatGroup.id, modoDemo));
    } catch (err) {
      Alert.alert('No se pudo enviar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  // -- Ranking --

  async function handleSeleccionarRankingDisciplina(disciplina: DisciplinaGrupal | null) {
    setRankingDisciplina(disciplina);
    try {
      setRanking(await fetchRanking(rankingDemo, disciplina?.id ?? null));
    } catch (err) {
      Alert.alert('No se pudo filtrar el ranking', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  const podio = ranking.slice(0, 3);
  const resto = ranking.slice(3);
  const medallas = ['🥇', '🥈', '🥉'];

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Comunidad</Text>

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        >
          {tab === 'feed' && (
            <>
              {modoDemo && (
                <View style={styles.demoBanner}>
                  <Ionicons name="flask-outline" size={14} color={colors.warning} />
                  <Text style={styles.demoBannerText}>
                    Modo demo: publicaciones de ejemplo guardadas en este dispositivo -- todavía no está conectado el
                    feed real (falta correr la migración de Comunidad).
                  </Text>
                </View>
              )}
              {posts.length === 0 && <Text style={styles.emptyText}>Sé el primero en publicar algo. 💚</Text>}
              {posts.map((post) => {
                const disciplineStyle = post.authorDiscipline ? getDisciplineStyle(post.authorDiscipline) : null;
                const comentarios = expandedComments[post.id];
                return (
                  <View key={post.id} style={styles.postCard}>
                    <View style={styles.postHeaderRow}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{getInitials(post.authorName)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.postHeaderNameRow}>
                          <Text style={styles.postAuthor} numberOfLines={1}>
                            {post.authorName}
                          </Text>
                          {post.authorNivel != null && (
                            <View style={styles.nivelBadge}>
                              <Text style={styles.nivelBadgeText}>N{post.authorNivel}</Text>
                            </View>
                          )}
                          {disciplineStyle && (
                            <View style={[styles.disciplineBadge, { backgroundColor: `${disciplineStyle.color}26` }]}>
                              <Text style={[styles.disciplineBadgeText, { color: disciplineStyle.color }]}>
                                {post.authorDiscipline}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.postTime}>{formatRelativeTime(post.createdAt)}</Text>
                      </View>
                    </View>

                    <Text style={styles.postBody}>{post.body}</Text>

                    {!!post.mediaUrl && (
                      <Image source={{ uri: post.mediaUrl }} style={styles.postImage} resizeMode="cover" />
                    )}

                    <View style={styles.postActionsRow}>
                      <TouchableOpacity
                        style={[styles.reactionButton, post.reactedByMe && styles.reactionButtonActive]}
                        onPress={() => handleToggleReaction(post)}
                      >
                        <Text style={styles.reactionEmoji}>💪</Text>
                        <Text style={[styles.reactionText, post.reactedByMe && styles.reactionTextActive]}>
                          ¡A tope!{post.reactionCount > 0 ? ` · ${post.reactionCount}` : ''}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentButton} onPress={() => toggleComentarios(post.id)}>
                        <Ionicons name="chatbubble-outline" size={14} color={colors.textSecondary} />
                        <Text style={styles.commentButtonText}>
                          Comentarios{post.commentCount > 0 ? ` (${post.commentCount})` : ''}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {comentarios && (
                      <View style={styles.commentsBox}>
                        {comentarios.length === 0 && <Text style={styles.emptyCommentsText}>Todavía no hay comentarios.</Text>}
                        {comentarios.map((c) => (
                          <View key={c.id} style={styles.commentRow}>
                            <Text style={styles.commentAuthor}>{c.authorName}</Text>
                            <Text style={styles.commentBody}>{c.body}</Text>
                          </View>
                        ))}
                        <View style={styles.commentInputRow}>
                          <TextInput
                            style={styles.commentInput}
                            placeholder="Escribí un comentario..."
                            placeholderTextColor={colors.textSecondary}
                            value={commentDraft[post.id] ?? ''}
                            onChangeText={(v) => setCommentDraft((prev) => ({ ...prev, [post.id]: v }))}
                          />
                          <TouchableOpacity onPress={() => handleEnviarComentario(post.id)}>
                            <Ionicons name="send" size={18} color={colors.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {tab === 'grupos' && (
            <>
              {modoDemo && (
                <View style={styles.demoBanner}>
                  <Ionicons name="flask-outline" size={14} color={colors.warning} />
                  <Text style={styles.demoBannerText}>
                    Modo demo: grupos de ejemplo guardados en este dispositivo, todavía no sincronizan con otros socios.
                  </Text>
                </View>
              )}
              <View style={styles.crearGrupoRow}>
                <TextInput
                  style={styles.crearGrupoInput}
                  placeholder="Nombre del grupo (ej: CrossFit Mañana)"
                  placeholderTextColor={colors.textSecondary}
                  value={nuevoGrupoNombre}
                  onChangeText={setNuevoGrupoNombre}
                />
                <TouchableOpacity style={styles.crearGrupoButton} onPress={handleCrearGrupo} disabled={creandoGrupo}>
                  {creandoGrupo ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Ionicons name="add" size={20} color={colors.onPrimary} />
                  )}
                </TouchableOpacity>
              </View>

              {misDisciplinasParaGrupo.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsRow}
                  style={{ marginBottom: 16 }}
                >
                  <TouchableOpacity
                    style={[styles.filterChip, !nuevoGrupoDisciplina && styles.filterChipActive]}
                    onPress={() => setNuevoGrupoDisciplina(null)}
                  >
                    <Text style={[styles.filterChipText, !nuevoGrupoDisciplina && styles.filterChipTextActive]}>
                      General
                    </Text>
                  </TouchableOpacity>
                  {misDisciplinasParaGrupo.map((d) => (
                    <TouchableOpacity
                      key={d.id}
                      style={[styles.filterChip, nuevoGrupoDisciplina?.id === d.id && styles.filterChipActive]}
                      onPress={() => setNuevoGrupoDisciplina(d)}
                    >
                      <Text
                        style={[styles.filterChipText, nuevoGrupoDisciplina?.id === d.id && styles.filterChipTextActive]}
                      >
                        {d.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {grupos.length === 0 && <Text style={styles.emptyText}>Todavía no hay grupos -- creá el primero.</Text>}
              {grupos.map((g) => {
                const disciplineStyle = g.disciplineName ? getDisciplineStyle(g.disciplineName) : null;
                return (
                  <View key={g.id} style={styles.groupCard}>
                    <View style={styles.groupIconCircle}>
                      <Ionicons name="people" size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.groupNameRow}>
                        <Text style={styles.groupName} numberOfLines={1}>
                          {g.name}
                        </Text>
                        {disciplineStyle && (
                          <View style={[styles.disciplineBadge, { backgroundColor: `${disciplineStyle.color}26` }]}>
                            <Text style={[styles.disciplineBadgeText, { color: disciplineStyle.color }]}>
                              {g.disciplineName}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.groupMeta}>
                        {g.memberCount} {g.memberCount === 1 ? 'miembro' : 'miembros'}
                      </Text>
                    </View>
                    {g.createdBy === user.id && (
                      <TouchableOpacity
                        onPress={() => handleEliminarGrupo(g)}
                        hitSlop={8}
                        style={styles.groupDeleteButton}
                        accessibilityLabel={`Eliminar ${g.name}`}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      </TouchableOpacity>
                    )}
                    {g.isMember ? (
                      <TouchableOpacity style={styles.groupOpenButton} onPress={() => abrirChatGrupo(g)}>
                        <Text style={styles.groupOpenButtonText}>Abrir chat</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.groupJoinButton} onPress={() => handleUnirseGrupo(g)}>
                        <Text style={styles.groupJoinButtonText}>Unirme</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {tab === 'ranking' && (
            <>
              <View style={styles.miClasesCallout}>
                <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
                <Text style={styles.miClasesText}>
                  Vos: <Text style={{ fontWeight: '800', color: colors.textPrimary }}>{misClasesDelMes}</Text> clases
                  este mes {rankingDisciplina ? `en ${rankingDisciplina.name}` : 'en disciplinas grupales'}
                </Text>
              </View>

              {rankingDemo ? (
                <View style={styles.demoBanner}>
                  <Ionicons name="flask-outline" size={14} color={colors.warning} />
                  <Text style={styles.demoBannerText}>
                    Ranking de ejemplo -- se activa con datos reales del box apenas se despliegue la función del
                    servidor (community_ranking_mes).
                  </Text>
                </View>
              ) : (
                disciplinasGrupales.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipsRow}
                    style={{ marginBottom: 16 }}
                  >
                    <TouchableOpacity
                      style={[styles.filterChip, !rankingDisciplina && styles.filterChipActive]}
                      onPress={() => handleSeleccionarRankingDisciplina(null)}
                    >
                      <Text style={[styles.filterChipText, !rankingDisciplina && styles.filterChipTextActive]}>Todas</Text>
                    </TouchableOpacity>
                    {disciplinasGrupales.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.filterChip, rankingDisciplina?.id === d.id && styles.filterChipActive]}
                        onPress={() => handleSeleccionarRankingDisciplina(d)}
                      >
                        <Text
                          style={[styles.filterChipText, rankingDisciplina?.id === d.id && styles.filterChipTextActive]}
                        >
                          {d.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )
              )}

              {ranking.length === 0 ? (
                <Text style={styles.emptyText}>Todavía no hay clases registradas este mes en esta disciplina.</Text>
              ) : (
                <>
                  <View style={styles.podiumRow}>
                    {podio.map((entry, i) => (
                      <View key={entry.userId} style={[styles.podiumCol, i === 0 && styles.podiumColFirst]}>
                        <Text style={styles.podiumMedal}>{medallas[i]}</Text>
                        <View style={styles.podiumAvatar}>
                          <Text style={styles.avatarText}>{getInitials(entry.fullName)}</Text>
                        </View>
                        <Text style={styles.podiumName} numberOfLines={1}>
                          {entry.fullName}
                        </Text>
                        <Text style={styles.podiumClases}>{entry.clases} clases</Text>
                      </View>
                    ))}
                  </View>

                  {resto.map((entry, i) => (
                    <View key={entry.userId} style={styles.rankingRow}>
                      <Text style={styles.rankingPosition}>{i + 4}</Text>
                      <Text style={styles.rankingName} numberOfLines={1}>
                        {entry.fullName}
                      </Text>
                      <Text style={styles.rankingClases}>{entry.clases} clases</Text>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      {tab === 'feed' && (
        <TouchableOpacity style={styles.fab} onPress={() => setComposerVisible(true)} accessibilityLabel="Nueva publicación">
          <Ionicons name="add" size={26} color={colors.onPrimary} />
        </TouchableOpacity>
      )}

      <Modal visible={composerVisible} transparent animationType="fade" onRequestClose={() => setComposerVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.composerCard}>
            <Text style={styles.composerTitle}>Nueva publicación</Text>
            <TextInput
              style={styles.composerInput}
              placeholder="¿Qué entrenaste hoy?"
              placeholderTextColor={colors.textSecondary}
              multiline
              value={composerText}
              onChangeText={setComposerText}
              autoFocus
            />

            {composerImageUri ? (
              <View style={styles.imagePreviewRow}>
                <Image source={{ uri: composerImageUri }} style={styles.imagePreview} resizeMode="cover" />
                <TouchableOpacity style={styles.removeImageButton} onPress={() => setComposerImageUri(null)}>
                  <Ionicons name="close-circle" size={22} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.attachButton} onPress={handleElegirFoto}>
                <Ionicons name="image-outline" size={16} color={colors.primary} />
                <Text style={styles.attachButtonText}>Adjuntar foto</Text>
              </TouchableOpacity>
            )}

            <View style={styles.composerButtonRow}>
              <TouchableOpacity style={styles.composerSecondaryButton} onPress={() => setComposerVisible(false)}>
                <Text style={styles.composerSecondaryButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.composerPrimaryButton}
                onPress={handlePublicar}
                disabled={isPosting || !composerText.trim()}
              >
                {isPosting ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.composerPrimaryButtonText}>Publicar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!chatGroup} transparent animationType="slide" onRequestClose={() => setChatGroup(null)}>
        <View style={styles.chatBackdrop}>
          <View style={styles.chatCard}>
            <View style={styles.chatHeaderRow}>
              <Text style={styles.chatTitle} numberOfLines={1}>
                {chatGroup?.name}
              </Text>
              {chatGroup?.createdBy === user.id && (
                <TouchableOpacity onPress={() => chatGroup && handleEliminarGrupo(chatGroup)} hitSlop={10} style={{ marginRight: 12 }}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setChatGroup(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.chatMessages}>
              {chatLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
              ) : chatMensajes.length === 0 ? (
                <Text style={styles.emptyText}>Sé el primero en escribir en este grupo.</Text>
              ) : (
                chatMensajes.map((m) => (
                  <View key={m.id} style={[styles.chatBubble, m.authorId === user.id && styles.chatBubbleMine]}>
                    <Text style={styles.chatBubbleAuthor}>{m.authorId === user.id ? 'Vos' : m.authorName}</Text>
                    <Text style={styles.chatBubbleBody}>{m.body}</Text>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Escribí un mensaje..."
                placeholderTextColor={colors.textSecondary}
                value={chatDraft}
                onChangeText={setChatDraft}
              />
              <TouchableOpacity onPress={handleEnviarMensaje}>
                <Ionicons name="send" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', padding: 16, paddingBottom: 0 },
  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '700' },
  tabTextActive: { color: colors.onPrimary },
  error: { color: colors.danger, paddingHorizontal: 16, marginTop: 12 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 20 },
  content: { padding: 16, paddingBottom: 96 },

  demoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(224, 185, 83, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  demoBannerText: { flex: 1, color: colors.warning, fontSize: 11.5, lineHeight: 16, fontWeight: '600' },

  chipsRow: { gap: 8, paddingRight: 4 },
  filterChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: colors.onPrimary },

  postCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  postHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  postHeaderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  postAuthor: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  nivelBadge: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1.5 },
  nivelBadgeText: { color: colors.onPrimary, fontSize: 9.5, fontWeight: '800' },
  disciplineBadge: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1.5 },
  disciplineBadgeText: { fontSize: 9.5, fontWeight: '800' },
  postTime: { color: colors.textSecondary, fontSize: 10.5, marginTop: 2 },
  postBody: { color: colors.textPrimary, fontSize: 13.5, lineHeight: 19, marginTop: 10 },
  postImage: { width: '100%', height: 200, borderRadius: 12, marginTop: 10, backgroundColor: colors.background },
  postActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  reactionButtonActive: { backgroundColor: 'rgba(0, 255, 56, 0.15)', borderColor: colors.primary },
  reactionEmoji: { fontSize: 13 },
  reactionText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  reactionTextActive: { color: colors.primary },
  commentButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10 },
  commentButtonText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '600' },
  commentsBox: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.surfaceAlt, gap: 8 },
  emptyCommentsText: { color: colors.textSecondary, fontSize: 12 },
  commentRow: { backgroundColor: colors.background, borderRadius: 10, padding: 8 },
  commentAuthor: { color: colors.textPrimary, fontSize: 11.5, fontWeight: '700' },
  commentBody: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  commentInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 12.5,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },

  crearGrupoRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  crearGrupoInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  crearGrupoButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  groupIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  groupName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  groupMeta: { color: colors.textSecondary, fontSize: 11.5, marginTop: 2 },
  groupDeleteButton: { padding: 2 },
  groupJoinButton: { backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  groupJoinButtonText: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
  groupOpenButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  groupOpenButtonText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },

  miClasesCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  miClasesText: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 20 },
  podiumCol: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  podiumColFirst: { borderColor: colors.primary, paddingVertical: 20 },
  podiumMedal: { fontSize: 22, marginBottom: 6 },
  podiumAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  podiumName: { color: colors.textPrimary, fontSize: 11.5, fontWeight: '700', maxWidth: '100%' },
  podiumClases: { color: colors.textSecondary, fontSize: 10.5, marginTop: 2 },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  rankingPosition: { color: colors.textSecondary, fontSize: 13, fontWeight: '800', width: 20 },
  rankingName: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  rankingClases: { color: colors.textSecondary, fontSize: 12 },

  fab: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  composerCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  composerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  composerInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    color: colors.textPrimary,
    minHeight: 90,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  attachButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  attachButtonText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },
  imagePreviewRow: { marginTop: 12, position: 'relative', alignSelf: 'flex-start' },
  imagePreview: { width: 100, height: 100, borderRadius: 12, backgroundColor: colors.background },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: colors.surface,
    borderRadius: 11,
  },
  composerButtonRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  composerSecondaryButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  composerSecondaryButtonText: { color: colors.textPrimary, fontWeight: '600' },
  composerPrimaryButton: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.primary },
  composerPrimaryButtonText: { color: colors.onPrimary, fontWeight: '700' },

  chatBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  chatCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    height: '70%',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  chatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceAlt,
  },
  chatTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', flex: 1 },
  chatMessages: { flex: 1 },
  chatBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    maxWidth: '80%',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: 'rgba(0, 255, 56, 0.12)', borderColor: colors.primary },
  chatBubbleAuthor: { color: colors.textSecondary, fontSize: 10.5, fontWeight: '700', marginBottom: 2 },
  chatBubbleBody: { color: colors.textPrimary, fontSize: 13 },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
});
