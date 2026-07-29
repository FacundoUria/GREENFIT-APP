import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { colorGrupoMuscular } from '../../theme/muscleGroups';
import {
  getUserRoutine,
  getTodayCompletions,
  markExerciseCompleted,
  unmarkExerciseCompleted,
} from '../../lib/routinesApi';
import { formatDateOnly } from '../../lib/classesApi';
import { Routine, RoutineExercise } from '../../types';
import VideoModal from '../../components/VideoModal';

const CONTACTO_WHATSAPP = 'https://wa.me/5492617139662';

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBlock}>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ExerciseCard({
  orden,
  bloque,
  completado,
  onToggle,
  onVerDemo,
}: {
  orden: number;
  bloque: RoutineExercise;
  completado: boolean;
  onToggle: () => void;
  onVerDemo: (url: string) => void;
}) {
  const color = colorGrupoMuscular(bloque.exercise.muscleGroup);
  const instrucciones = bloque.notes || bloque.exercise.description;

  return (
    <View style={[styles.exerciseCard, completado && styles.exerciseCardCompleted]}>
      <View style={styles.exerciseHeader}>
        <View style={styles.orderBadge}>
          <Text style={styles.orderBadgeText}>#{orden}</Text>
        </View>
        <View style={styles.exerciseHeaderInfo}>
          <Text style={styles.exerciseName} numberOfLines={2}>
            {bloque.exercise.name}
          </Text>
          <View style={[styles.muscleBadge, { backgroundColor: color.bg }]}>
            <Text style={[styles.muscleBadgeText, { color: color.text }]} numberOfLines={1}>
              {bloque.exercise.muscleGroup}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={onToggle} hitSlop={8} style={styles.checkboxTouchable}>
          <Ionicons
            name={completado ? 'checkmark-circle' : 'ellipse-outline'}
            size={30}
            color={completado ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.metricsGrid}>
        <MetricBlock label="Series" value={String(bloque.sets ?? '-')} />
        <MetricBlock label="Reps" value={bloque.reps || '-'} />
        <MetricBlock label="Carga" value={bloque.weightSuggestion || '-'} />
        <MetricBlock label="Descanso" value={bloque.restSeconds ? `${bloque.restSeconds}s` : '-'} />
      </View>

      {!!instrucciones && (
        <View style={styles.instructionsBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.instructionsText}>{instrucciones}</Text>
        </View>
      )}

      {!!bloque.exercise.videoUrl && (
        <TouchableOpacity style={styles.videoButton} onPress={() => onVerDemo(bloque.exercise.videoUrl!)}>
          <Ionicons name="play-circle" size={18} color={colors.onPrimary} />
          <Text style={styles.videoButtonText}>Ver Demo</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// La rutina asignada al socio logueado (la más reciente), organizada por
// días con checklist de ejercicios completados hoy.
export default function UserRoutineScreen() {
  const { user } = useAuth();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [completados, setCompletados] = useState<Set<string>>(new Set());

  const todayStr = useMemo(() => formatDateOnly(new Date()), []);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [r, completions] = await Promise.all([
        getUserRoutine(user.id),
        getTodayCompletions(user.id, todayStr),
      ]);
      setRoutine(r);
      setCompletados(completions);
      setSelectedDayIdx((prev) => (r && prev < r.days.length ? prev : 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu rutina.');
    } finally {
      setIsLoading(false);
    }
  }, [user, todayStr]);

  useEffect(() => {
    load();
  }, [load]);

  const diaActual = routine?.days[selectedDayIdx] ?? null;
  const totalDia = diaActual?.exercises.length ?? 0;
  const completadosDia = diaActual ? diaActual.exercises.filter((e) => completados.has(e.id)).length : 0;
  const progresoPct = totalDia > 0 ? Math.round((completadosDia / totalDia) * 100) : 0;
  const diaCompleto = totalDia > 0 && completadosDia === totalDia;

  async function handleToggle(routineExerciseId: string) {
    if (!user) return;
    const yaCompletado = completados.has(routineExerciseId);

    // Optimista: la app responde al toque de inmediato, se corrige sola si
    // la escritura falla.
    setCompletados((prev) => {
      const next = new Set(prev);
      if (yaCompletado) next.delete(routineExerciseId);
      else next.add(routineExerciseId);
      return next;
    });

    try {
      if (yaCompletado) {
        await unmarkExerciseCompleted(user.id, routineExerciseId, todayStr);
      } else {
        await markExerciseCompleted(user.id, routineExerciseId, todayStr);
      }
    } catch (err) {
      setCompletados((prev) => {
        const next = new Set(prev);
        if (yaCompletado) next.add(routineExerciseId);
        else next.delete(routineExerciseId);
        return next;
      });
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  function handleFinalizar() {
    Alert.alert('¡Entrenamiento completado! 💪', 'Registramos todos los ejercicios de hoy. ¡Buen trabajo!');
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
    >
      {isLoading && !routine && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {!isLoading && !error && !routine && (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="barbell-outline" size={32} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Todavía no tenés una rutina</Text>
          <Text style={styles.emptyText}>
            Tu entrenador aún no te asignó un plan de ejercicios. Escribile para coordinar tu rutina personalizada.
          </Text>
          <TouchableOpacity style={styles.whatsappButton} onPress={() => Linking.openURL(CONTACTO_WHATSAPP)}>
            <Ionicons name="logo-whatsapp" size={18} color={colors.onPrimary} />
            <Text style={styles.whatsappButtonText}>Contactar a mi entrenador</Text>
          </TouchableOpacity>
        </View>
      )}

      {routine && diaActual && (
        <>
          {/* Header: nombre del plan, progreso de hoy */}
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {routine.title}
            </Text>

            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progresoPct}%` }]} />
              </View>
              <Text style={styles.progressPct}>{progresoPct}%</Text>
            </View>
            <Text style={styles.progressLabel}>
              {completadosDia} de {totalDia} ejercicios completados hoy
            </Text>
          </View>

          {/* Selector de días */}
          {routine.days.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayTabsRow}
              style={styles.dayTabsScroll}
            >
              {routine.days.map((d, idx) => {
                const seleccionado = idx === selectedDayIdx;
                return (
                  <TouchableOpacity
                    key={d.id}
                    onPress={() => setSelectedDayIdx(idx)}
                    style={[styles.dayTab, seleccionado && styles.dayTabSelected]}
                  >
                    <Text style={[styles.dayTabText, seleccionado && styles.dayTabTextSelected]} numberOfLines={1}>
                      {d.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {diaActual.exercises.length === 0 ? (
            <Text style={styles.empty}>Este día todavía no tiene ejercicios cargados.</Text>
          ) : (
            diaActual.exercises.map((bloque, idx) => (
              <ExerciseCard
                key={bloque.id}
                orden={idx + 1}
                bloque={bloque}
                completado={completados.has(bloque.id)}
                onToggle={() => handleToggle(bloque.id)}
                onVerDemo={setVideoUrl}
              />
            ))
          )}

          {diaCompleto && (
            <TouchableOpacity style={styles.finishButton} onPress={handleFinalizar}>
              <Ionicons name="trophy" size={18} color={colors.onPrimary} />
              <Text style={styles.finishButtonText}>Finalizar Entrenamiento</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <VideoModal visible={!!videoUrl} videoUrl={videoUrl} onClose={() => setVideoUrl(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  error: { color: colors.danger, marginTop: 20 },
  empty: { color: colors.textSecondary, marginTop: 12, textAlign: 'center' },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    marginTop: 20,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
    maxWidth: 260,
  },
  whatsappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25D366',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 20,
  },
  whatsappButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },

  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  heroTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '700' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  progressPct: { color: colors.primary, fontWeight: '700', fontSize: 13, width: 38, textAlign: 'right' },
  progressLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },

  dayTabsScroll: { marginBottom: 14 },
  dayTabsRow: { gap: 8, paddingRight: 8 },
  dayTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    maxWidth: 180,
  },
  dayTabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayTabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  dayTabTextSelected: { color: colors.onPrimary },

  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  exerciseCardCompleted: { borderColor: colors.primary, opacity: 0.85 },
  exerciseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  orderBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  exerciseHeaderInfo: { flex: 1, minWidth: 0 },
  exerciseName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  muscleBadge: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, marginTop: 5 },
  muscleBadgeText: { fontSize: 11, fontWeight: '700' },
  checkboxTouchable: { padding: 2 },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  metricBlock: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    paddingVertical: 10,
    alignItems: 'center',
  },
  metricValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  metricLabel: { color: colors.textSecondary, fontSize: 10.5, marginTop: 2, textTransform: 'uppercase' },

  instructionsBox: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  instructionsText: { flex: 1, color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },

  videoButton: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 12,
  },
  videoButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },

  finishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 6,
    marginBottom: 10,
  },
  finishButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
