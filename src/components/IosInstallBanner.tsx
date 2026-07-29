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
    <View style={styles.banner}>
      <Ionicons name="download-outline" size={22} color={colors.primary} />
      <Text style={styles.text}>
        Instalá Greenfit: tocá <Text style={styles.bold}>Compartir</Text>{' '}
        <Ionicons name="arrow-redo-outline" size={13} color={colors.textPrimary} /> y luego{' '}
        <Text style={styles.bold}>"Agregar a inicio"</Text>.
      </Text>
      <TouchableOpacity onPress={dismiss} hitSlop={10}>
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  text: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  bold: { fontWeight: '700' },
});
