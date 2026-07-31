import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

interface PushNeedsInstallModalProps {
  visible: boolean;
  onClose: () => void;
}

// En iOS, Safari solo expone la Push API cuando la PWA corre en modo
// standalone (agregada a la pantalla de inicio, iOS 16.4+) -- en una
// pestaña normal el switch de notificaciones no tiene nada para activar.
// Este modal reemplaza al switch en ese caso puntual (ver iosNeedsInstall
// en usePushPermission) y guía al socio a instalar la app primero.
export default function PushNeedsInstallModal({ visible, onClose }: PushNeedsInstallModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="download-outline" size={22} color={colors.primary} />
          </View>
          <Text style={styles.title}>Instalá Greenfit para activarlas</Text>
          <Text style={styles.text}>
            En iPhone, las notificaciones solo funcionan si agregás Greenfit a tu pantalla de inicio:
          </Text>
          <View style={styles.steps}>
            <Text style={styles.step}>
              1. Tocá <Text style={styles.bold}>Compartir</Text>{' '}
              <Ionicons name="arrow-redo-outline" size={13} color={colors.textPrimary} /> en la barra del navegador.
            </Text>
            <Text style={styles.step}>
              2. Elegí <Text style={styles.bold}>"Agregar a inicio"</Text>.
            </Text>
            <Text style={styles.step}>3. Abrí Greenfit desde ese ícono nuevo y activá el switch de nuevo.</Text>
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
    backgroundColor: 'rgba(0, 255, 56, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  text: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  steps: { gap: 8, marginBottom: 18 },
  step: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '700', color: colors.textPrimary },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
