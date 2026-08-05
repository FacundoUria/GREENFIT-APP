import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { checkXpDisponible, fetchAsistenciaHoyRegistrada, otorgarXpAsistenciaDiaria } from '../lib/xpApi';

interface HoyEntreneButtonProps {
  userId: string;
}

// Botón universal del Dashboard (HomeScreen): +100 XP autoreportados por
// "hoy entrené", tope 1 por día -- comparte el cupo diario, server-side,
// con la asistencia confirmada por el admin desde el panel (ver
// backend/supabase_migration_xp.sql, índice único de xp_events). Componente
// aparte (no inline en HomeScreen.tsx) para poder testearlo solo, sin tener
// que mockear todo lo que ya carga esa pantalla (balances, reservas, pagos).
export default function HoyEntreneButton({ userId }: HoyEntreneButtonProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [modoDemo, setModoDemo] = useState(false);
  const [yaRegistrado, setYaRegistrado] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try {
        const disponible = await checkXpDisponible();
        const registrado = await fetchAsistenciaHoyRegistrada(userId, !disponible);
        if (!cancelado) {
          setModoDemo(!disponible);
          setYaRegistrado(registrado);
        }
      } catch {
        // Si falla la carga, el botón queda habilitado -- mejor eso que
        // bloquear el dashboard entero por este widget secundario.
      } finally {
        if (!cancelado) setIsLoading(false);
      }
    }
    cargar();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  async function handlePress() {
    setIsSaving(true);
    try {
      // 'ya_registrado_hoy' puede pasar si una clase confirmada por el
      // admin ya otorgó el XP de hoy antes de tocar el botón -- no es un
      // error, el cupo de hoy ya está de todas formas.
      await otorgarXpAsistenciaDiaria(userId, modoDemo);
      setYaRegistrado(true);
    } catch {
      // Silencioso -- es un widget secundario del dashboard, no amerita un
      // Alert bloqueante.
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return null;

  return (
    <TouchableOpacity
      style={[styles.button, yaRegistrado && styles.buttonDone]}
      onPress={handlePress}
      disabled={yaRegistrado || isSaving}
      activeOpacity={0.85}
    >
      {isSaving ? (
        <ActivityIndicator color={colors.onPrimary} size="small" />
      ) : (
        <>
          <Ionicons
            name={yaRegistrado ? 'checkmark-circle' : 'flame'}
            size={18}
            color={yaRegistrado ? colors.primary : colors.onPrimary}
          />
          <Text style={[styles.text, yaRegistrado && styles.textDone]}>
            {yaRegistrado ? '¡Entrenamiento de hoy registrado! +100 XP' : '¡Hoy entrené! (+100 XP)'}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  buttonDone: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  text: { color: colors.onPrimary, fontWeight: '700', fontSize: 13.5 },
  textDone: { color: colors.primary },
});
