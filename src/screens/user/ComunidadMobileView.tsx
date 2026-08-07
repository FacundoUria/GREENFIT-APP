import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  checkMensajesDisponible,
  fetchMisClasesDelMes,
  fetchDisciplinasGrupales,
  fetchFeed,
  crearPost,
  toggleReaction,
  fetchComentarios,
  agregarComentario,
  fetchRanking,
  subirFotoComunidad,
  abrirChatPrivado,
  fetchInboxMensajes,
  fetchMensajesPrivados,
  enviarMensajePrivado,
  ComunidadPost,
  ComunidadComentario,
  RankingEntry,
  DisciplinaGrupal,
  DmThreadResumen,
  DmMensaje,
} from '../../lib/comunidadApi';
import { fetchTotalXp, calcularResumenXp } from '../../lib/xpApi';
import Avatar from '../../components/Avatar';

// Vista nueva y paralela (Módulo 6 del rediseño) -- tab de primer nivel en
// MainTabs.tsx (Comunidad es la función de retención del gym, no puede
// quedar escondida en un tile de Perfil).
//
// Real vs. demo: ver el comentario largo al principio de src/lib/comunidadApi.ts.
// En resumen, las tablas `community_*` todavía no están desplegadas
// (backend/supabase_migration_comunidad.sql existe pero no se corrió), así
// que por default esta pantalla arranca en "modo demo" -- un banner arriba
// de Feed/Mensajes lo deja clarísimo, y el ranking usa datos de muestra
// salvo el XP propio del socio, que siempre es real.
//
// "Mi Box" (grupos por disciplina) se reemplazó por "Mensajes" (chats
// privados 1 a 1, ver backend/supabase_migration_mensajes.sql) -- decisión
// explícita del usuario. Se abre un chat tocando el avatar/nombre de un
// socio en el Feed o en el Ranking; la pestaña "Mensajes" es la bandeja de
// chats activos (hilos con al menos un mensaje real).

type Tab = 'feed' | 'mensajes' | 'ranking';

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
// sí). Sirve para resolver la disciplina principal del USUARIO ACTUAL, que
// sí puede leer sus propias reservas bajo RLS.
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
  { key: 'mensajes', label: 'Mensajes' },
  { key: 'ranking', label: 'Ranking' },
];

interface DmChatActivo {
  threadId: string;
  otherUserId: string;
  otherUserName: string;
  otherAvatarUrl: string | null;
}

export default function ComunidadMobileView() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  const [modoDemo, setModoDemo] = useState(false);
  const [rankingDemo, setRankingDemo] = useState(false);
  const [mensajesDemo, setMensajesDemo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [miNivel, setMiNivel] = useState(1);
  const [miDisciplina, setMiDisciplina] = useState<string | null>(null);
  const [misClasesDelMes, setMisClasesDelMes] = useState(0);
  const [miXpTotal, setMiXpTotal] = useState(0);
  const [disciplinasGrupales, setDisciplinasGrupales] = useState<DisciplinaGrupal[]>([]);

  const [posts, setPosts] = useState<ComunidadPost[]>([]);
  const [expandedComments, setExpandedComments] = useState<Record<string, ComunidadComentario[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const [inboxMensajes, setInboxMensajes] = useState<DmThreadResumen[]>([]);
  const [dmChat, setDmChat] = useState<DmChatActivo | null>(null);
  const [dmMensajes, setDmMensajes] = useState<DmMensaje[]>([]);
  const [dmDraft, setDmDraft] = useState('');
  const [dmLoading, setDmLoading] = useState(false);

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
      const [feedOk, rankOk, mensajesOk, misClases, historico, gruposDisponibles, totalXp] = await Promise.all([
        checkComunidadDisponible(),
        checkRankingDisponible(),
        checkMensajesDisponible(),
        fetchMisClasesDelMes(user.id),
        fetchHistoricoPropio(user.id),
        fetchDisciplinasGrupales(),
        fetchTotalXp(user.id),
      ]);
      setModoDemo(!feedOk);
      setRankingDemo(!rankOk);
      setMensajesDemo(!mensajesOk);
      setMisClasesDelMes(misClases);
      setMiXpTotal(totalXp);
      // Mismo nivel real (XP) que muestra el badge de Mi Perfil -- se
      // snapshotea acá para author_nivel de los posteos nuevos.
      setMiNivel(calcularResumenXp(totalXp).nivel);
      setDisciplinasGrupales(gruposDisponibles);

      const conteo = new Map<string, number>();
      for (const h of historico) conteo.set(h.disciplineTitle, (conteo.get(h.disciplineTitle) ?? 0) + 1);
      const top = Array.from(conteo.entries()).sort((a, b) => b[1] - a[1])[0];
      setMiDisciplina(top ? top[0] : null);

      const [feed, rankingList, inbox] = await Promise.all([
        fetchFeed(user.id, !feedOk),
        fetchRanking(!rankOk, null),
        fetchInboxMensajes(user.id, !mensajesOk),
      ]);
      setPosts(feed);
      setRanking(rankingList);
      setRankingDisciplina(null);
      setInboxMensajes(inbox);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la comunidad.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // useFocusEffect (no useEffect a secas) -- Comunidad es un tab, React
  // Navigation la mantiene montada al cambiar de tab, así que un useEffect
  // normal solo cargaba una vez y el Ranking/XP quedaban desactualizados
  // para siempre después de la primera visita (mismo bug ya corregido en
  // PerfilMobileView -- ver el comentario largo ahí). Mismo criterio que
  // ya usa HomeScreen.tsx.
  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

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
      // Publicar sigue funcionando igual que siempre -- ya no otorga XP
      // (esa regla se dio de baja, ver REGLAS_XP en XpInfoModal.tsx y
      // backend/supabase_migration_xp_solo_asistencia.sql).
      await crearPost(user.id, user.name, user.avatarUrl, composerText.trim(), miNivel, miDisciplina, mediaUrl, modoDemo);
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
      await agregarComentario(user.id, user.name, user.avatarUrl, postId, texto, modoDemo);
      setCommentDraft((prev) => ({ ...prev, [postId]: '' }));
      const comentarios = await fetchComentarios(user.id, postId, modoDemo);
      setExpandedComments((prev) => ({ ...prev, [postId]: comentarios }));
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, commentCount: comentarios.length } : p)));
    } catch (err) {
      Alert.alert('No se pudo comentar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  // -- Mensajes privados --

  // Se llama al tocar el avatar/nombre de OTRO socio en el Feed o el
  // Ranking -- abre (o crea) el hilo 1 a 1 y lo muestra directo, sin pasar
  // por la bandeja. Tocarse a uno mismo no hace nada (no tiene sentido
  // chatear con uno mismo).
  async function handleAbrirChatPrivado(otherUserId: string, otherUserName: string, otherAvatarUrl: string | null) {
    if (!user || otherUserId === user.id) return;
    setDmLoading(true);
    try {
      const threadId = await abrirChatPrivado(user.id, otherUserId, otherUserName, otherAvatarUrl, mensajesDemo);
      setDmChat({ threadId, otherUserId, otherUserName, otherAvatarUrl });
      setDmMensajes(await fetchMensajesPrivados(user.id, threadId, mensajesDemo));
    } catch (err) {
      Alert.alert('No se pudo abrir el chat', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setDmLoading(false);
    }
  }

  async function abrirDesdeInbox(thread: DmThreadResumen) {
    if (!user) return;
    setDmChat({
      threadId: thread.threadId,
      otherUserId: thread.otherUserId,
      otherUserName: thread.otherUserName,
      otherAvatarUrl: thread.otherAvatarUrl,
    });
    setDmLoading(true);
    try {
      setDmMensajes(await fetchMensajesPrivados(user.id, thread.threadId, mensajesDemo));
    } catch (err) {
      Alert.alert('No se pudieron cargar los mensajes', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setDmLoading(false);
    }
  }

  async function handleEnviarMensajePrivado() {
    if (!user || !dmChat || !dmDraft.trim()) return;
    try {
      await enviarMensajePrivado(user.id, user.name, user.avatarUrl, dmChat.threadId, dmDraft.trim(), mensajesDemo);
      setDmDraft('');
      setDmMensajes(await fetchMensajesPrivados(user.id, dmChat.threadId, mensajesDemo));
      // Refresca la bandeja en segundo plano (best-effort) para que este
      // hilo aparezca/suba en "Mensajes" la próxima vez que se abra ese tab.
      fetchInboxMensajes(user.id, mensajesDemo)
        .then(setInboxMensajes)
        .catch(() => {});
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
                      <TouchableOpacity
                        onPress={() => handleAbrirChatPrivado(post.authorId, post.authorName, post.authorAvatarUrl)}
                        disabled={post.authorId === user.id}
                        accessibilityLabel={`Chatear con ${post.authorName}`}
                      >
                        <Avatar uri={post.authorAvatarUrl} name={post.authorName} size={38} />
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <TouchableOpacity
                          onPress={() => handleAbrirChatPrivado(post.authorId, post.authorName, post.authorAvatarUrl)}
                          disabled={post.authorId === user.id}
                        >
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
                        </TouchableOpacity>
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
                            <Avatar uri={c.authorAvatarUrl} name={c.authorName} size={22} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.commentAuthor}>{c.authorName}</Text>
                              <Text style={styles.commentBody}>{c.body}</Text>
                            </View>
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

          {tab === 'mensajes' && (
            <>
              {mensajesDemo && (
                <View style={styles.demoBanner}>
                  <Ionicons name="flask-outline" size={14} color={colors.warning} />
                  <Text style={styles.demoBannerText}>
                    Modo demo: los mensajes que mandes quedan guardados en este dispositivo -- todavía no está
                    conectada la mensajería real (falta correr la migración de Mensajes).
                  </Text>
                </View>
              )}
              {inboxMensajes.length === 0 && (
                <Text style={styles.emptyText}>
                  Todavía no tenés conversaciones. Iniciá una tocando el avatar de un socio en el Feed o el Ranking.
                </Text>
              )}
              {inboxMensajes.map((thread) => (
                <TouchableOpacity key={thread.threadId} style={styles.inboxRow} onPress={() => abrirDesdeInbox(thread)}>
                  <Avatar uri={thread.otherAvatarUrl} name={thread.otherUserName} size={44} />
                  <View style={styles.inboxTextCol}>
                    <Text style={styles.inboxName} numberOfLines={1}>
                      {thread.otherUserName}
                    </Text>
                    <Text style={styles.inboxPreview} numberOfLines={1}>
                      {thread.lastBody}
                    </Text>
                  </View>
                  <Text style={styles.inboxTime}>{formatRelativeTime(thread.lastCreatedAt)}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {tab === 'ranking' && (
            <>
              <View style={styles.miClasesCallout}>
                <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
                <Text style={styles.miClasesText}>
                  Vos: <Text style={{ fontWeight: '800', color: colors.textPrimary }}>{miXpTotal} XP</Text> totales
                  {rankingDisciplina ? ` · ${misClasesDelMes} clases en ${rankingDisciplina.name} este mes` : ''}
                </Text>
              </View>

              {rankingDemo ? (
                <View style={styles.demoBanner}>
                  <Ionicons name="flask-outline" size={14} color={colors.warning} />
                  <Text style={styles.demoBannerText}>
                    Ranking de ejemplo -- se activa con datos reales del box apenas se despliegue la función del
                    servidor (community_ranking_xp).
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
                <Text style={styles.emptyText}>Todavía no hay XP registrado en esta disciplina.</Text>
              ) : (
                <>
                  <View style={styles.podiumRow}>
                    {podio.map((entry, i) => (
                      <TouchableOpacity
                        key={entry.userId}
                        style={[styles.podiumCol, i === 0 && styles.podiumColFirst]}
                        onPress={() => handleAbrirChatPrivado(entry.userId, entry.fullName, entry.avatarUrl)}
                        disabled={entry.userId === user.id}
                      >
                        <Text style={styles.podiumMedal}>{medallas[i]}</Text>
                        <Avatar uri={entry.avatarUrl} name={entry.fullName} size={40} />
                        <Text style={styles.podiumName} numberOfLines={1}>
                          {entry.fullName}
                        </Text>
                        <Text style={styles.podiumClases}>{entry.xp} XP</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {resto.map((entry, i) => (
                    <TouchableOpacity
                      key={entry.userId}
                      style={styles.rankingRow}
                      onPress={() => handleAbrirChatPrivado(entry.userId, entry.fullName, entry.avatarUrl)}
                      disabled={entry.userId === user.id}
                    >
                      <Text style={styles.rankingPosition}>{i + 4}</Text>
                      <Avatar uri={entry.avatarUrl} name={entry.fullName} size={30} />
                      <Text style={styles.rankingName} numberOfLines={1}>
                        {entry.fullName}
                      </Text>
                      <Text style={styles.rankingClases}>{entry.xp} XP</Text>
                    </TouchableOpacity>
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

      <Modal visible={!!dmChat} transparent animationType="slide" onRequestClose={() => setDmChat(null)}>
        <View style={styles.chatBackdrop}>
          <View style={styles.chatCard}>
            <View style={styles.chatHeaderRow}>
              <Avatar uri={dmChat?.otherAvatarUrl} name={dmChat?.otherUserName ?? '?'} size={32} />
              <Text style={styles.chatTitle} numberOfLines={1}>
                {dmChat?.otherUserName}
              </Text>
              <TouchableOpacity onPress={() => setDmChat(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.chatMessages}>
              {dmLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
              ) : dmMensajes.length === 0 ? (
                <Text style={styles.emptyText}>Escribile el primer mensaje.</Text>
              ) : (
                dmMensajes.map((m) => {
                  const mine = m.authorId === user.id;
                  return (
                    <View key={m.id} style={[styles.chatBubbleRow, mine && styles.chatBubbleRowMine]}>
                      <Avatar uri={m.authorAvatarUrl} name={m.authorName} size={24} />
                      <View style={[styles.chatBubble, mine && styles.chatBubbleMine]}>
                        <Text style={styles.chatBubbleBody}>{m.body}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Escribí un mensaje..."
                placeholderTextColor={colors.textSecondary}
                value={dmDraft}
                onChangeText={setDmDraft}
              />
              <TouchableOpacity onPress={handleEnviarMensajePrivado}>
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
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.background, borderRadius: 10, padding: 8 },
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

  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  inboxTextCol: { flex: 1, minWidth: 0 },
  inboxName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  inboxPreview: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  inboxTime: { color: colors.textSecondary, fontSize: 10.5 },

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
    gap: 6,
  },
  podiumColFirst: { borderColor: colors.primary, paddingVertical: 20 },
  podiumMedal: { fontSize: 22 },
  podiumName: { color: colors.textPrimary, fontSize: 11.5, fontWeight: '700', maxWidth: '100%' },
  podiumClases: { color: colors.textSecondary, fontSize: 10.5 },
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
    gap: 10,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceAlt,
  },
  chatTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', flex: 1 },
  chatMessages: { flex: 1 },
  chatBubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 10, maxWidth: '85%' },
  chatBubbleRowMine: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  chatBubble: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    flexShrink: 1,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  chatBubbleMine: { backgroundColor: 'rgba(0, 255, 56, 0.12)', borderColor: colors.primary },
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
