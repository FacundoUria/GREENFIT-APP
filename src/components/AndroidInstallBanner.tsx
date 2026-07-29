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
    <View style={styles.overlay}>
      <View style={styles.card}>
        <TouchableOpacity style={styles.closeButton} onPress={dismiss} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.iconCircle}>
          <Ionicons name="download-outline" size={28} color={colors.primary} />
        </View>

        <Text style={styles.title}>Instalá Greenfit</Text>
        <Text style={styles.text}>Reservá tus clases más rápido con la app instalada en tu celular.</Text>

        <TouchableOpacity style={styles.primaryButton} onPress={handleInstall}>
          <Text style={styles.primaryButtonText}>Instalar App</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={dismiss} hitSlop={10} style={styles.dismissLink}>
          <Text style={styles.dismissLinkText}>Ahora no</Text>
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
  dismissLink: { marginTop: 14 },
  dismissLinkText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
