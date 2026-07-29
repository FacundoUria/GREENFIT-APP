import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

interface PushBlockedModalProps {
  visible: boolean;
  onClose: () => void;
}

// El navegador no deja re-pedir permiso una vez que el socio lo rechazó
// (Notification.requestPermission() vuelve a resolver 'denied' sin ni
// mostrar el prompt) -- la única salida es que el socio mismo lo habilite
// desde los ajustes del sitio en su navegador. Esta guía reemplaza al
// switch en ese caso.
export default function PushBlockedModal({ visible, onClose }: PushBlockedModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={22} color={colors.warning} />
          </View>
          <Text style={styles.title}>Notificaciones bloqueadas</Text>
          <Text style={styles.text}>
            Bloqueaste las notificaciones de Greenfit en este navegador. Para volver a activarlas:
          </Text>
          <View style={styles.steps}>
            <Text style={styles.step}>1. Tocá el ícono de candado 🔒 (o "ⓘ") en la barra de direcciones.</Text>
            <Text style={styles.step}>2. Buscá "Notificaciones" y cambiá el permiso a "Permitir".</Text>
            <Text style={styles.step}>3. Volvé a esta pantalla y activá el switch de nuevo.</Text>
          </View>
          <TouchableOpacity style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Entendido</Text>
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
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(224, 185, 83, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  text: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  steps: { gap: 8, marginBottom: 18 },
  step: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
