import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

// Mientras la app está abierta (foreground o backgrounded con el proceso
// vivo), muestra un popup nativo con sonido cuando entra una notificación
// nueva relevante para este usuario. No es push remoto (no despierta la app
// si está cerrada del todo) — es un listener en vivo sobre Realtime.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useNotificationSubscription(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    Notifications.requestPermissionsAsync().catch(() => {
      // Si el usuario rechaza el permiso, seguimos sin push local —
      // la notificación igual queda visible en la pantalla de Notificaciones.
    });

    const channel = supabase
      .channel(`notifications-inbox-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        async (payload) => {
          // El evento de Realtime no respeta RLS por sí solo — confirmamos
          // acá haciendo un select por id, que SÍ está sujeto a
          // notifications_select_recipient. Si no es para este usuario,
          // vuelve null y no mostramos nada.
          const { data } = await supabase
            .from('notifications')
            .select('title, body')
            .eq('id', (payload.new as { id: string }).id)
            .maybeSingle();

          if (!data) return;

          await Notifications.scheduleNotificationAsync({
            content: {
              title: data.title,
              body: data.body,
              sound: true,
            },
            trigger: null,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
