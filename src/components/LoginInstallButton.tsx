import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { BeforeInstallPromptEvent, isIosSafariBrowser, isAlreadyStandalone } from '../lib/pwaInstall';

// Botón manual y discreto para instalar la PWA desde la pantalla de Login.
// Se muestra SIEMPRE (no depende de haber capturado `beforeinstallprompt`
// todavía, ni de que el navegador lo dispare en absoluto) porque ese evento
// puede tardar o directamente no existir (iOS Safari, Firefox). El único
// motivo real para ocultarlo es que la PWA ya esté corriendo instalada.
export default function LoginInstallButton() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isAlreadyStandalone()) {
      setHidden(true);
      return;
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setHidden(true);
      setDeferredEvent(null);
      setShowManual(false);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handlePress = useCallback(async () => {
    if (deferredEvent) {
      await deferredEvent.prompt();
      // El evento solo se puede usar una vez, sin importar la elección.
      await deferredEvent.userChoice;
      setDeferredEvent(null);
      return;
    }
    // Todavía no llegó el prompt nativo (o este navegador nunca lo dispara,
    // ej. iOS Safari) -- guiamos al socio para que lo haga a mano.
    setShowManual(true);
  }, [deferredEvent]);

  if (Platform.OS !== 'web' || hidden) return null;

  const disponible = !!deferredEvent;

  return (
    <>
      <TouchableOpacity
        style={[styles.button, disponible && styles.buttonDisponible]}
        onPress={handlePress}
        accessibilityLabel="Instalar Greenfit como app"
        hitSlop={8}
      >
        <Ionicons name="download-outline" size={18} color={disponible ? colors.primary : colors.textSecondary} />
      </TouchableOpacity>

      {showManual && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowManual(false)} hitSlop={10}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={styles.iconCircle}>
              <Ionicons name="download-outline" size={26} color={colors.primary} />
            </View>

            <Text style={styles.title}>Instalá Greenfit</Text>
            {isIosSafariBrowser() ? (
              <Text style={styles.text}>
                Tocá <Text style={styles.bold}>Compartir</Text>{' '}
                <Ionicons name="arrow-redo-outline" size={13} color={colors.textPrimary} /> y luego{' '}
                <Text style={styles.bold}>"Agregar a inicio"</Text>.
              </Text>
            ) : (
              <Text style={styles.text}>
                Tocá el menú <Text style={styles.bold}>⋮</Text> de tu navegador y elegí{' '}
                <Text style={styles.bold}>"Instalar aplicación"</Text> o{' '}
                <Text style={styles.bold}>"Agregar a pantalla principal"</Text>.
              </Text>
            )}

            <TouchableOpacity style={styles.primaryButton} onPress={() => setShowManual(false)}>
              <Text style={styles.primaryButtonText}>Entendido</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    bottom: 18,
    right: 18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  buttonDisponible: {
    borderColor: 'rgba(0, 255, 56, 0.35)',
    opacity: 1,
  },
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
    zIndex: 60,
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
