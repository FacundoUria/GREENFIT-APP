import React, { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { checkXpDisponible, fetchAsistenciaHoyRegistrada, otorgarXpAsistenciaDiaria } from '../lib/xpApi';

interface HoyEntreneButtonProps {
  userId: string;
  // Se llama SOLO cuando el servidor otorga XP nuevo de verdad (nunca
  // cuando ya estaba registrado) -- el padre (HomeScreen) lo usa para
  // sumar +100 al contador de XP en memoria al instante, sin esperar a
  // que la pantalla vuelva a tomar foco para pedir el total de nuevo.
  onClaimed?: () => void;
}

const MENSAJE_YA_REGISTRADO = 'Ya registraste tu entrenamiento de hoy -- tus +100 XP ya fueron otorgados.';

// Botón universal del Dashboard (HomeScreen): +100 XP autoreportados por
// "hoy entrené", tope 1 por día -- comparte el cupo diario, server-side,
// con la asistencia confirmada por el admin desde el panel (ver
// backend/supabase_migration_xp.sql, índice único de xp_events). Componente
// aparte (no inline en HomeScreen.tsx) para poder testearlo solo, sin tener
// que mockear todo lo que ya carga esa pantalla (balances, reservas, pagos).
export default function HoyEntreneButton({ userId, onClaimed }: HoyEntreneButtonProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [modoDemo, setModoDemo] = useState(false);
  const [yaRegistrado, setYaRegistrado] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Toast inline en vez de Alert.alert -- Alert.alert() es un NO-OP mudo en
  // react-native-web (ver node_modules/react-native-web/src/exports/Alert:
  // "static alert() {}"), así que en la PWA -- el target principal de este
  // widget -- un Alert.alert acá nunca se vería. Mismo patrón ya usado en
  // PerfilMobileView.tsx (comingSoonToast): funciona igual en web y nativo.
  const [toastMensaje, setToastMensaje] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function mostrarToast(mensaje: string) {
    setToastMensaje(mensaje);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMensaje(null), 3200);
  }

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
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [userId]);

  async function handlePress() {
    // Ya sabíamos (desde que cargó el widget) que hoy ya se registró --
    // ni siquiera vale la pena pegarle al servidor de nuevo: se avisa
    // directo por qué el botón no hace nada nuevo.
    if (yaRegistrado) {
      mostrarToast(MENSAJE_YA_REGISTRADO);
      return;
    }

    setIsSaving(true);
    try {
      // 'ya_registrado_hoy' puede pasar si una clase confirmada por el
      // admin (o una pestaña duplicada) ya otorgó el XP de hoy justo antes
      // de tocar este botón -- se avisa igual que el caso de arriba, en vez
      // de festejar en silencio un +100 que en realidad no se sumó.
      const resultado = await otorgarXpAsistenciaDiaria(userId, modoDemo);
      setYaRegistrado(true);
      if (resultado === 'ya_registrado_hoy') {
        mostrarToast(MENSAJE_YA_REGISTRADO);
      } else {
        onClaimed?.();
      }
    } catch (err) {
      mostrarToast(err instanceof Error ? err.message : 'No se pudo registrar. Intentá de nuevo en un momento.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return null;

  return (
    <View>
      <TouchableOpacity
        style={[styles.button, yaRegistrado && styles.buttonDone]}
        onPress={handlePress}
        disabled={isSaving}
        activeOpacity={0.85}
        accessibilityLabel={yaRegistrado ? 'Entrenamiento de hoy ya registrado' : '¡Hoy entrené!'}
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
              {yaRegistrado ? 'Entrenamiento de hoy ya registrado' : '¡Hoy entrené! (+100 XP)'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {!!toastMensaje && (
        <View style={styles.toast}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.toastText}>{toastMensaje}</Text>
        </View>
      )}
    </View>
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
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  toastText: { color: colors.textSecondary, fontSize: 11.5, flex: 1 },
});
