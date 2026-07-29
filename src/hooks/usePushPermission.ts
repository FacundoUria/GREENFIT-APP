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

async function persistSubscription(userId: string, subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) throw new Error('La suscripción del navegador no trajo las claves.');
  await savePushSubscription(userId, { endpoint: subscription.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
}

// Estado unificado del switch "Notificaciones push" del Perfil: en web
// maneja la suscripción real de Web Push (VAPID); en nativo refleja el
// permiso de expo-notifications (que ya dispara el popup local vía
// useNotificationSubscription). Un solo hook para que la UI del Perfil no
// tenga que conocer la diferencia entre plataformas.
export function usePushPermission(userId: string | undefined) {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      if (Platform.OS === 'web') {
        const ok = isWebPushSupported();
        setSupported(ok);
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

  return { supported, enabled, isLoading, toggle };
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
