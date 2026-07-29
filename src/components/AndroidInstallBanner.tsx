import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';

const DISMISS_KEY = 'greenfit:android-install-banner-dismissed-at';
const SNOOZE_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isAlreadyStandalone(): boolean {
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

// Chrome/Edge/Android (y Chromium en general) disparan `beforeinstallprompt`
// en vez de instalar solos — hay que interceptarlo, guardar el evento, y
// recién llamar a `.prompt()` cuando el usuario toca nuestro botón. El
// evento no llega en iOS Safari (ver IosInstallBanner, que cubre ese caso
// con una guía manual) ni si el navegador ya decidió que no es instalable
// (sin manifest válido, sin service worker, o ya instalada).
export default function AndroidInstallBanner() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isAlreadyStandalone()) return;

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();

      AsyncStorage.getItem(DISMISS_KEY).then((value) => {
        if (value) {
          const daysSinceDismiss = (Date.now() - Number(value)) / 86_400_000;
          if (daysSinceDismiss < SNOOZE_DAYS) return;
        }
        setDeferredEvent(event as BeforeInstallPromptEvent);
        setVisible(true);
      });
    }

    function handleAppInstalled() {
      setVisible(false);
      setDeferredEvent(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    // El evento solo se puede usar una vez, sin importar la elección.
    await deferredEvent.userChoice;
    setDeferredEvent(null);
    setVisible(false);
  }, [deferredEvent]);

  function dismiss() {
    setVisible(false);
    AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  if (!visible || !deferredEvent) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="download-outline" size={22} color={colors.primary} />
      <Text style={styles.text}>Instalá Greenfit para reservar tus clases más rápido.</Text>
      <TouchableOpacity style={styles.installButton} onPress={handleInstall}>
        <Text style={styles.installButtonText}>Instalar App</Text>
      </TouchableOpacity>
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
  installButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  installButtonText: { color: colors.onPrimary, fontSize: 12, fontWeight: '700' },
});
