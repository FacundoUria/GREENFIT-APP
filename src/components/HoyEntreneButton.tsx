import React, { useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { registrarHoyEntrene } from '../lib/xpApi';

interface HoyEntreneButtonProps {
  // Cuántas disciplinas tiene ACTIVAS hoy el socio -- define el tope de
  // clics diarios (1 disciplina activa = 1 clic, 2 = hasta 2, etc.). Se
  // vuelve a validar server-side en cada click (nunca se confía en esto
  // para el enforcement real, solo para pintar la UI) -- ver
  // registrar_hoy_entrene() en PAGINA SUPABASE/supabase_migration_hoy_entrene.sql.
  disciplinasActivas: number;
  // Cuántas veces ya se usó el botón hoy -- estado inicial (fetchEntrenamientosHoy)
  // que el padre mantiene actualizado después de cada click exitoso.
  entrenamientosHoy: number;
  // Se dispara solo cuando el RPC realmente otorgó los 100 XP -- el padre
  // usa esto para actualizar el total de XP en pantalla al instante, sin
  // esperar ningún refetch/realtime.
  onRegistrado: (xpGanado: number, nuevoEntrenamientosHoy: number) => void;
}

// Reincorpora el autoreporte de XP (+100) que se había sacado del todo --
// ahora con un tope real por día (disciplinas activas), no autoreporte
// libre. Ver la nota larga en xpApi.ts sobre por qué existe este límite.
export default function HoyEntreneButton({ disciplinasActivas, entrenamientosHoy, onRegistrado }: HoyEntreneButtonProps) {
  const [cargando, setCargando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Sin ninguna disciplina activa no hay ningún entrenamiento que registrar
  // -- mismo criterio que usa el RPC para rechazarlo, así que ni se muestra
  // el botón en vez de mostrarlo siempre deshabilitado sin explicación.
  if (disciplinasActivas <= 0) return null;

  const disponibles = Math.max(0, disciplinasActivas - entrenamientosHoy);
  const agotado = disponibles <= 0;

  async function handlePress() {
    if (cargando || agotado) return;
    setCargando(true);
    setFeedback(null);
    try {
      const resultado = await registrarHoyEntrene();
      if (!resultado.otorgado) {
        setFeedback('Ya registraste todos tus entrenamientos de hoy');
        onRegistrado(0, resultado.entrenamientosHoy);
        return;
      }
      const restantes = Math.max(0, resultado.entrenamientosMaximos - resultado.entrenamientosHoy);
      setFeedback(
        restantes > 0
          ? `¡Bien! Te queda ${restantes} entrenamiento${restantes === 1 ? '' : 's'} disponible${restantes === 1 ? '' : 's'} hoy`
          : '¡Bien! Ya registraste todos tus entrenamientos de hoy'
      );
      onRegistrado(resultado.xpOtorgado, resultado.entrenamientosHoy);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo registrar. Intentá de nuevo.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.button, agotado && styles.buttonAgotado]}
        onPress={handlePress}
        disabled={agotado || cargando}
        accessibilityLabel={agotado ? 'Ya registraste todos tus entrenamientos de hoy' : 'Hoy Entrené'}
      >
        {cargando ? (
          <ActivityIndicator color={colors.onPrimary} size="small" />
        ) : (
          <Text style={[styles.buttonText, agotado && styles.buttonTextAgotado]}>
            {agotado ? 'Ya registraste todos tus entrenamientos de hoy' : '💪 Hoy Entrené'}
          </Text>
        )}
      </TouchableOpacity>
      {!!feedback && <Text style={styles.feedback}>{feedback}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonAgotado: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },
  buttonTextAgotado: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  feedback: { color: colors.primary, fontSize: 12.5, fontWeight: '700', textAlign: 'center', marginTop: 8 },
});
