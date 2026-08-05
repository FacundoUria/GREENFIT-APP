import { SOCIO_DEMO } from './auth';
import type { TablaFixtures } from './supabaseMock';

// Fixtures compartidas entre specs -- fechas relativas a HOY (no
// hardcodeadas) para que la racha/"Clases (mes)" den un número
// predecible sin importar cuándo corra la suite.
function formatFechaISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const HOY = new Date();
const AYER = new Date(Date.now() - 86_400_000);
export const HOY_STR = formatFechaISO(HOY);
export const AYER_STR = formatFechaISO(AYER);

export const DISCIPLINA_CROSSFIT = { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' };
export const DISCIPLINA_APARATOS = { id: 'disc-aparatos', name: 'Aparatos', kind: 'membership' };

// 700 + 450 = 1150 XP -> NIVEL 3, 150/500 de progreso (misma cuenta que
// valida xpApi.test.ts) -- racha de 2 días (hoy + ayer) y "Clases (mes)"
// también en 2.
export const XP_EVENTS_BASE = [
  { id: 'xp-1', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 700, event_date: HOY_STR, reference_id: null },
  { id: 'xp-2', user_id: SOCIO_DEMO.id, event_type: 'asistencia', xp_amount: 450, event_date: AYER_STR, reference_id: null },
];

export const CLASE_HOY = {
  id: 'class-crossfit-hoy',
  title: 'CrossFit',
  discipline_id: DISCIPLINA_CROSSFIT.id,
  instructor: 'Seba',
  location: 'Box 1',
  capacity: 12,
  days_of_week: [HOY.getDay()],
  start_time: '19:00:00',
  end_time: '20:00:00',
  disciplines: { is_active: true },
};

// Tipado como TablaFixtures (no inferido) a propósito: así un test puede
// pushear una fila con campos extra (ej. discipline_id, ver xp-sync.spec.ts)
// sin chocar contra el shape puntual de XP_EVENTS_BASE.
export function tablasBase(): TablaFixtures {
  return {
    xp_events: [...XP_EVENTS_BASE],
    disciplines: [DISCIPLINA_CROSSFIT, DISCIPLINA_APARATOS],
    user_credits: [],
    bookings: [],
    packs: [],
    classes: [],
  };
}

