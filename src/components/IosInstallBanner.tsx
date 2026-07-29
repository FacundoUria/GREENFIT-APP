import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';

const DISMISS_KEY = 'greenfit:ios-install-banner-dismissed-at';
const SNOOZE_DAYS = 14;

function isIosSafariBrowser(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
  return isIos && isSafari;
}

function isAlreadyStandalone(): boolean {
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

// Safari en iOS no soporta el evento `beforeinstallprompt` (el que usan
// Chrome/Android para el botón nativo "Instalar") — ahí la única forma de
// instalar es que el usuario mismo toque Compartir > Agregar a inicio. Este
// banner es el reemplazo pedagógico de ese prompt que iOS no ofrece.
export default function IosInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (!isIosSafariBrowser() || isAlreadyStandalone()) return;

    AsyncStorage.getItem(DISMISS_KEY).then((value) => {
      if (!value) {
        setVisible(true);
        return;
      }
      const daysSinceDismiss = (Date.now() - Number(value)) / 86_400_000;
      if (daysSinceDismiss >= SNOOZE_DAYS) setVisible(true);
    });
  }, []);

  function dismiss() {
    setVisible(false);
    AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <TouchableOpacity style={styles.closeButton} onPress={dismiss} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.iconCircle}>
          <Ionicons name="download-outline" size={28} color={colors.primary} />
        </View>

        <Text style={styles.title}>Instalá Greenfit</Text>
        <Text style={styles.text}>
          Tocá <Text style={styles.bold}>Compartir</Text>{' '}
          <Ionicons name="arrow-redo-outline" size={13} color={colors.textPrimary} /> y luego{' '}
          <Text style={styles.bold}>"Agregar a inicio"</Text> para tenerla siempre a mano.
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={dismiss}>
          <Text style={styles.primaryButtonText}>Entendido</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(4px)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: 20,
  } as any,
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  closeButton: { position: 'absolute', top: 14, right: 14, zIndex: 1 },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  text: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginBottom: 20 },
  bold: { fontWeight: '700', color: colors.textPrimary },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
