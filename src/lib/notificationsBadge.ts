import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Mismo criterio y misma key de AsyncStorage que usa NotificacionesMobileView.tsx
// para el estado de leído/no leído -- si esa key cambia allá, hay que
// actualizarla acá también. Se duplica en vez de importar de esa vista para
// no crear una dependencia entre una pantalla (Home) y otra (Notificaciones).
function leidasKey(userId: string): string {
  return `greenfit:notif-leidas:${userId}`;
}

async function loadLeidasIds(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(leidasKey(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

// Contador liviano para el badge de la campanita -- mismo límite de 30 filas
// que ya trae la bandeja de notificaciones (no hace falta traer más para un
// simple conteo de no leídas).
export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  const [{ data, error }, leidas] = await Promise.all([
    supabase.from('notifications').select('id').order('created_at', { ascending: false }).limit(30),
    loadLeidasIds(userId),
  ]);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((n) => !leidas.has(n.id)).length;
}
