import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// "Meta personal" (+300 XP al completarla) -- ver backend/supabase_migration_xp.sql.
// Autogestionada por el socio con 2 frenos anti-abuso (decisión del
// usuario): solo 1 meta activa a la vez, y no se puede completar antes de
// 7 días de creada. Ambos frenos están validados SERVER-SIDE (índice único
// + trigger) -- acá se repiten client-side solo para dar un mensaje
// amigable antes de golpear la base.
//
// El XP de 'meta' SOLO lo otorga el trigger de completar_meta_personal()
// (event_type='meta' no es insertable directo por el cliente, a propósito:
// la regla de los 7 días tiene que quedar validada en un solo lugar
// confiable). Por eso, a diferencia de PRs/posteos, el modo demo de esta
// pantalla no puede otorgar XP real -- completar una meta demo cierra la
// meta local pero no suma al ledger hasta que exista la tabla de verdad.

export interface MetaPersonal {
  id: string;
  texto: string;
  createdAt: string;
  completedAt: string | null;
}

export const DIAS_MINIMOS_PARA_COMPLETAR = 7;

function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find');
}

export async function checkMetasDisponible(): Promise<boolean> {
  const { error } = await supabase.from('metas_personales').select('id').limit(1);
  return !(error && isMissingRelationError(error));
}

// Días que faltan para poder completarla -- 0 significa "ya se puede".
export function diasParaCompletar(meta: MetaPersonal): number {
  const diasTranscurridos = (Date.now() - new Date(meta.createdAt).getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(DIAS_MINIMOS_PARA_COMPLETAR - diasTranscurridos));
}

// ============================================================
// Camino real (Supabase)
// ============================================================

async function fetchMetaActivaReal(userId: string): Promise<MetaPersonal | null> {
  const { data, error } = await supabase
    .from('metas_personales')
    .select('id, texto, created_at, completed_at')
    .eq('user_id', userId)
    .is('completed_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, texto: data.texto, createdAt: data.created_at, completedAt: data.completed_at };
}

async function crearMetaReal(userId: string, texto: string): Promise<void> {
  const { error } = await supabase.from('metas_personales').insert({ user_id: userId, texto });
  if (error) {
    if (error.code === '23505') throw new Error('Ya tenés una meta activa -- completala antes de crear otra.');
    throw new Error(error.message);
  }
}

async function completarMetaReal(userId: string, metaId: string): Promise<void> {
  const { error } = await supabase
    .from('metas_personales')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', metaId)
    .eq('user_id', userId);
  if (error) {
    // El trigger levanta esta excepción textual si todavía no pasaron los 7 días.
    if (error.message.includes('7 días')) {
      throw new Error('Todavía no pasaron 7 días desde que creaste esta meta.');
    }
    throw new Error(error.message);
  }
}

// ============================================================
// Modo demo (AsyncStorage, local al dispositivo)
// ============================================================

function demoKey(userId: string): string {
  return `greenfit:meta-demo:${userId}`;
}

async function loadDemoMeta(userId: string): Promise<MetaPersonal | null> {
  try {
    const raw = await AsyncStorage.getItem(demoKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveDemoMeta(userId: string, meta: MetaPersonal | null): Promise<void> {
  try {
    if (meta) await AsyncStorage.setItem(demoKey(userId), JSON.stringify(meta));
    else await AsyncStorage.removeItem(demoKey(userId));
  } catch {
    // Best-effort -- mismo criterio que el resto de los módulos con AsyncStorage.
  }
}

// ============================================================
// API pública -- unifica real/demo según `modoDemo` (resuelto por la vista
// con checkMetasDisponible)
// ============================================================

export async function fetchMetaActiva(userId: string, modoDemo: boolean): Promise<MetaPersonal | null> {
  if (!modoDemo) return fetchMetaActivaReal(userId);
  return loadDemoMeta(userId);
}

export async function crearMeta(userId: string, texto: string, modoDemo: boolean): Promise<void> {
  if (!modoDemo) return crearMetaReal(userId, texto);
  const existente = await loadDemoMeta(userId);
  if (existente) throw new Error('Ya tenés una meta activa -- completala antes de crear otra.');
  await saveDemoMeta(userId, { id: `local-${Date.now()}`, texto, createdAt: new Date().toISOString(), completedAt: null });
}

export async function completarMeta(userId: string, meta: MetaPersonal, modoDemo: boolean): Promise<void> {
  if (diasParaCompletar(meta) > 0) {
    throw new Error('Todavía no pasaron 7 días desde que creaste esta meta.');
  }
  if (!modoDemo) return completarMetaReal(userId, meta.id);
  // Demo: cierra la meta local. No otorga XP real -- ver comentario arriba.
  await saveDemoMeta(userId, null);
}
