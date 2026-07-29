import React, { useEffect, useState, useCallback, useRef } from 'react';
import { TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Cuánto esperamos el evento `beforeinstallprompt` antes de asumir que este
// navegador no lo va a disparar nunca (Safari/iOS, Firefox) y ocultar el
// ícono -- sin esto quedaría un botón gris permanentemente inerte.
const CHECK_TIMEOUT_MS = 2500;

function isAlreadyStandalone(): boolean {
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

// Botón manual y discreto para instalar la PWA desde la pantalla de Login,
// pensado para el socio que cerró/ignoró el modal automático (AndroidInstallBanner)
// y quiere instalar más tarde. Mismo evento `beforeinstallprompt`, distinto
// disparador (toque explícito en vez de un modal que aparece solo).
export default function LoginInstallButton() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isAlreadyStandalone()) {
      setHidden(true);
      return;
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setDeferredEvent(event as BeforeInstallPromptEvent);
      setHidden(false);
    }

    function handleAppInstalled() {
      setHidden(true);
      setDeferredEvent(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Si a esta altura ningún navegador soportado ya disparó el evento,
    // asumimos que no lo va a hacer (ej. Safari/iOS) y ocultamos el ícono.
    timeoutRef.current = setTimeout(() => {
      setDeferredEvent((current) => {
        if (!current) setHidden(true);
        return current;
      });
    }, CHECK_TIMEOUT_MS);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    // El evento solo se puede usar una vez, sin importar la elección.
    await deferredEvent.userChoice;
    setDeferredEvent(null);
    setHidden(true);
  }, [deferredEvent]);

  if (Platform.OS !== 'web' || hidden) return null;

  const disponible = !!deferredEvent;

  return (
    <TouchableOpacity
      style={[styles.button, disponible && styles.buttonDisponible]}
      onPress={handleInstall}
      disabled={!disponible}
      accessibilityLabel="Instalar Greenfit como app"
      hitSlop={8}
    >
      <Ionicons name="download-outline" size={18} color={disponible ? colors.primary : colors.textSecondary} />
    </TouchableOpacity>
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
});
