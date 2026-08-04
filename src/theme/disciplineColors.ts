import { Ionicons } from '@expo/vector-icons';
import { colors } from './colors';

export interface DisciplineStyle {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
}

// Mapeo por nombre de disciplina (texto libre cargado por el admin en
// Supabase, no un enum) -- las claves van normalizadas sin tildes/mayúsculas.
// Si en algún box lo escriben distinto ("Kick Strike" vs "kickstrike") el
// match parcial de getDisciplineStyle() igual lo agarra.
const DISCIPLINE_STYLES: Record<string, DisciplineStyle> = {
  crossfit: { color: '#22D3EE', icon: 'flash' }, // ciano/azul
  gap: { color: '#E040FB', icon: 'body' }, // magenta
  boxeo: { color: '#FF3B5C', icon: 'fitness' }, // rojo neón
  kickboxing: { color: '#FF3B5C', icon: 'fitness' },
  kickstrike: { color: '#FF3B5C', icon: 'fitness' },
  funcional: { color: colors.primary, icon: 'barbell' }, // verde GreenFit
  musculacion: { color: colors.primary, icon: 'barbell' },
  aparatos: { color: colors.primary, icon: 'barbell' },
};

// Paleta de respaldo para disciplinas nuevas que el admin cargue y todavía
// no estén en el mapeo de arriba -- así ninguna tarjeta se ve "gris"/rota.
const FALLBACK_PALETTE = ['#22D3EE', '#E040FB', '#FF3B5C', colors.primary, '#FBBF24', '#818CF8'];

// U+0300-U+036F: rango Unicode de "combining diacritical marks" -- es lo que
// separa NFD de una á (a + acento combinante). Se arma con fromCharCode para
// no depender de tipear el rango literal (frágil por encoding).
const DIACRITICS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');

// Saca tildes (á -> a + combining acute) para poder matchear "crossfit"
// aunque el admin lo haya cargado como "CrossFit" o con mayúsculas sueltas.
function normalize(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(DIACRITICS_RE, '').trim();
}

// Hash determinístico (no random) para que una misma disciplina no mapeada
// siempre caiga en el mismo color de la paleta de respaldo entre renders.
function hashToIndex(text: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % mod;
}

export function getDisciplineStyle(name: string): DisciplineStyle {
  const key = normalize(name);
  if (DISCIPLINE_STYLES[key]) return DISCIPLINE_STYLES[key];

  const partialMatch = Object.keys(DISCIPLINE_STYLES).find((k) => key.includes(k) || k.includes(key));
  if (partialMatch) return DISCIPLINE_STYLES[partialMatch];

  return { color: FALLBACK_PALETTE[hashToIndex(key, FALLBACK_PALETTE.length)], icon: 'barbell-outline' };
}
