import React from 'react';
import { Modal, View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import Confetti from './Confetti';

interface RoutineCompleteModalProps {
  visible: boolean;
  completos: number;
  total: number;
  onClose: () => void;
}

// Feedback gratificante al cerrar el entreno de hoy -- reemplaza el
// Alert.alert() anterior, que en react-native-web (el target principal de
// esta pantalla) es un no-op mudo y nunca se llegaba a ver. Mismo patrón
// visual que ReservaConfirmadaModal (mascota + confetti), sin tocar XP real:
// esto es puro feedback de UI, no otorga ni escribe ningún XP nuevo.
export default function RoutineCompleteModal({ visible, completos, total, onClose }: RoutineCompleteModalProps) {
  const completo = total > 0 && completos === total;
  const titulo = completo ? '¡Rutina completa! 🔥' : '¡Buen entrenamiento! 💪';
  const subtitulo =
    total === 0
      ? 'Registramos tu entrenamiento de hoy.'
      : completo
        ? 'Marcaste todos los ejercicios de hoy. ¡Constancia que suma!'
        : `Llevás ${completos} de ${total} ejercicios de hoy -- lo que sumaste ya cuenta.`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Confetti active={visible} />

          <Image source={require('../../assets/perro.png')} style={styles.mascot} resizeMode="contain" />

          <Text style={styles.title}>{titulo}</Text>
          <Text style={styles.subtitle}>{subtitulo}</Text>

          <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Genial</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  mascot: { width: 96, height: 96, marginBottom: 10 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13.5,
    marginTop: 6,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 19,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
