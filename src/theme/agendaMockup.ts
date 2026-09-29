import { useEffect } from 'react';
import { Platform } from 'react-native';

// Paleta y tipografía del mockup de Stitch "Agenda - GreenFit" (config de
// Tailwind del HTML), copiadas TAL CUAL a pedido del cliente (2026-09-29):
// la Agenda es una copia visual exacta del mockup, no una interpretación con
// theme/colors.ts. Es el ÚNICO lugar donde viven estos hex -- la pantalla y
// el DaySelector los leen de acá (ver AgendaRediseno.guardas.test.ts).
export const mockup = {
  background: '#131315',
  surfaceContainerLow: '#1c1b1e',
  surfaceContainer: '#201f22',
  surfaceContainerHigh: '#2a2a2c',
  onSurface: '#e5e1e4',
  onSurfaceVariant: '#b9ccb5',
  outlineVariant: '#3b4b3a',
  primaryContainer: '#00ff66', // verde neón: día elegido, pill "Reservar", CrossFit
  onSecondaryFixed: '#002109', // texto sobre el verde neón
  tertiaryContainer: '#85edff', // Funcional
  onPrimary: '#003911', // fondo del pill "Reservada" (verde muy oscuro)
  amber: '#E0B953', // "Sin créditos" (el mockup no tiene este estado: mismo ámbar que colors.warning)
} as const;

// Mismo color con transparencia (equivalente a `bg-x/40` de Tailwind).
export function alfa(hex: string, opacidad: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacidad})`;
}

// Color del nombre de la disciplina: el mockup muestra CrossFit en verde neón
// y Funcional en celeste; las que no aparecen en el mockup usan su color de
// siempre (theme/disciplineColors.ts, `fallback`).
export function colorDisciplinaMockup(titulo: string, fallback: string): string {
  const t = titulo.toLowerCase();
  if (t.includes('crossfit')) return mockup.primaryContainer;
  if (t.includes('funcional')) return mockup.tertiaryContainer;
  return fallback;
}

// Tipografías del mockup: Space Grotesk (títulos, horarios, labels) e Inter
// (texto). En web se cargan de Google Fonts, igual que el HTML del mockup;
// en nativo caen a la fuente del sistema.
export const fuentes = {
  titulo: Platform.OS === 'web' ? '"Space Grotesk", system-ui, sans-serif' : undefined,
  texto: Platform.OS === 'web' ? 'Inter, system-ui, sans-serif' : undefined,
};

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap';

export function useFuentesMockup() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById('gf-fuentes-agenda')) return;
    const link = document.createElement('link');
    link.id = 'gf-fuentes-agenda';
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
  }, []);
}
