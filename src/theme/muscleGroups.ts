// Paleta por grupo muscular para los badges de ejercicios -- mismo criterio
// que colorGrupoMuscular en el admin (texto libre, normalizado, con un
// color por defecto para lo que no matchea).
const COLORES_GRUPO: Record<string, { bg: string; text: string }> = {
  pecho: { bg: 'rgba(249, 115, 22, 0.15)', text: '#fb923c' },
  espalda: { bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8' },
  piernas: { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc' },
  hombros: { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24' },
  'bíceps': { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185' },
  biceps: { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185' },
  'tríceps': { bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6' },
  triceps: { bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6' },
  'core / abdomen': { bg: 'rgba(20, 184, 166, 0.15)', text: '#2dd4bf' },
  core: { bg: 'rgba(20, 184, 166, 0.15)', text: '#2dd4bf' },
  'gluteos': { bg: 'rgba(217, 70, 239, 0.15)', text: '#e879f9' },
  'glúteos': { bg: 'rgba(217, 70, 239, 0.15)', text: '#e879f9' },
  cardio: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171' },
  'cuerpo completo': { bg: 'rgba(0, 255, 56, 0.15)', text: '#00FF38' },
};

const DEFAULT_COLOR = { bg: 'rgba(255,255,255,0.08)', text: '#A0A0A0' };

export function colorGrupoMuscular(grupo: string | null | undefined) {
  const clave = (grupo ?? '').trim().toLowerCase();
  return COLORES_GRUPO[clave] ?? DEFAULT_COLOR;
}
