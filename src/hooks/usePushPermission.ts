import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  isWebPushSupported,
  getExistingSubscription,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../lib/webPush';
import { savePushSubscription, deletePushSubscription } from '../lib/pushApi';
import { isIosSafariBrowser, isAlreadyStandalone } from '../lib/pwaInstall';

async function persistSubscription(userId: string, subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) throw new Error('La suscripción del navegador no trajo las claves.');
  await savePushSubscription(userId, { endpoint: subscription.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
}

function currentWebPermission(): NotificationPermission | null {
  return typeof Notification !== 'undefined' ? Notification.permission : null;
}

// Estado unificado del switch "Notificaciones push" del Perfil: en web
// maneja la suscripción real de Web Push (VAPID); en nativo refleja el
// permiso de expo-notifications (que ya dispara el popup local vía
// useNotificationSubscription). Un solo hook para que la UI del Perfil no
// tenga que conocer la diferencia entre plataformas.
//
// `permission` solo se usa en web: una vez que el socio rechaza el permiso
// del navegador, éste queda en 'denied' y ningún llamado a
// requestPermission() vuelve a mostrar el prompt -- hay que avisarle que lo
// habilite a mano desde los ajustes del sitio (ver PushBlockedModal).
export function usePushPermission(userId: string | undefined) {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // iOS Safari solo expone la Push API cuando la PWA corre en modo
  // standalone (agregada a la pantalla de inicio, iOS 16.4+). En una
  // pestaña normal `isWebPushSupported()` da false sin explicar por qué --
  // esta bandera distingue ese caso para mostrarle al socio cómo instalar
  // la app en vez de ocultarle el bloque de notificaciones sin más.
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      if (Platform.OS === 'web') {
        const ok = isWebPushSupported();
        setSupported(ok);
        setIosNeedsInstall(isIosSafariBrowser() && !isAlreadyStandalone());
        setPermission(currentWebPermission());
        setEnabled(ok ? !!(await getExistingSubscription()) : false);
      } else {
        const { status } = await Notifications.getPermissionsAsync();
        setSupported(true);
        setEnabled(status === 'granted');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!userId) return;
      setIsLoading(true);
      try {
        if (Platform.OS === 'web') {
          if (next) {
            const subscription = await subscribeToWebPush();
            await persistSubscription(userId, subscription);
            setEnabled(true);
          } else {
            const endpoint = await unsubscribeFromWebPush();
            if (endpoint) await deletePushSubscription(endpoint);
            setEnabled(false);
          }
          setPermission(currentWebPermission());
        } else if (next) {
          const { status } = await Notifications.requestPermissionsAsync();
          setEnabled(status === 'granted');
        } else {
          throw new Error('Para desactivar las notificaciones, hacelo desde la configuración del sistema.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  return { supported, enabled, permission, isLoading, toggle, iosNeedsInstall };
}

// Se dispara una sola vez al loguearse (punto 3 del pedido: "solicitar
// permisos... al iniciar sesión"). Solo pregunta si el navegador todavía no
// tiene una decisión guardada — si el socio ya lo rechazó antes, no lo
// volvemos a interrumpir en cada login; le queda el switch del Perfil para
// activarlo cuando quiera.
export function useAutoRequestWebPush(userId: string | undefined) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !userId) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    if (!isWebPushSupported()) return;

    subscribeToWebPush()
      .then((subscription) => persistSubscription(userId, subscription))
      .catch(() => {
        // Silencioso: si el socio cierra el prompt del navegador o falla,
        // no lo interrumpimos con un error — puede activarlo a mano después.
      });
  }, [userId]);
}
