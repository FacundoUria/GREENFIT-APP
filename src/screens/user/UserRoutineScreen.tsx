import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { getUserRoutine } from '../../lib/routinesApi';
import { Routine } from '../../types';
import VideoModal from '../../components/VideoModal';

// La rutina asignada al socio logueado (la más reciente), con sus
// ejercicios en orden y acceso al video de técnica de cada uno.
export default function UserRoutineScreen() {
  const { user } = useAuth();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      setRoutine(await getUserRoutine(user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu rutina.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20 }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
    >
      {isLoading && !routine && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {!isLoading && !error && !routine && (
        <View style={styles.emptyCard}>
          <Ionicons name="barbell-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.emptyText}>Aún no tenés una rutina asignada. Consultá con tu entrenador.</Text>
        </View>
      )}

      {routine && (
        <>
          <View style={styles.headerCard}>
            <Text style={styles.title}>{routine.title}</Text>
            {routine.notes ? <Text style={styles.notes}>{routine.notes}</Text> : null}
          </View>

          {routine.exercises.map((re) => (
            <View key={re.id} style={styles.exerciseCard}>
              <Text style={styles.exerciseName}>{re.exercise.name}</Text>
              <Text style={styles.exerciseGroup}>{re.exercise.muscleGroup}</Text>
              <Text style={styles.exerciseDetail}>
                {re.sets} series x {re.reps} reps · Descanso: {re.restSeconds}s
              </Text>
              {re.exercise.description ? (
                <Text style={styles.exerciseDescription}>{re.exercise.description}</Text>
              ) : null}
              {re.exercise.videoUrl && (
                <TouchableOpacity
                  style={styles.videoButton}
                  onPress={() => setVideoUrl(re.exercise.videoUrl)}
                >
                  <Ionicons name="play-circle" size={18} color={colors.onPrimary} />
                  <Text style={styles.videoButtonText}>Ver técnica / video</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </>
      )}

      <VideoModal visible={!!videoUrl} videoUrl={videoUrl} onClose={() => setVideoUrl(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  error: { color: colors.danger, marginTop: 20 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    marginTop: 20,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  notes: { color: colors.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 18 },
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  exerciseName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  exerciseGroup: { color: colors.primary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  exerciseDetail: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  exerciseDescription: { color: colors.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 },
  videoButton: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 12,
  },
  videoButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
});
