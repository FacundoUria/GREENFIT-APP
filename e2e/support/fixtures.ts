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

// Franja horaria informativa de un pase libre (ej. Aparatos) -- checklist
// punto 2: show_in_agenda=false la saca de la Agenda de RESERVAS de la PWA
// (sigue mostrándose en la Landing, que filtra solo por is_active, columna
// aparte).
export const CLASE_APARATOS_HOY = {
  id: 'class-aparatos-hoy',
  title: 'Aparatos libre',
  discipline_id: DISCIPLINA_APARATOS.id,
  instructor: null,
  location: null,
  capacity: 30,
  days_of_week: [HOY.getDay()],
  start_time: '07:00:00',
  end_time: '22:00:00',
  disciplines: { is_active: true, show_in_agenda: false },
};

// 'v1' -- tiene que ser EXACTAMENTE la misma string que CONSENT_VERSION en
// greenfit-app/src/lib/consentApi.ts (duplicada a mano acá, no importada:
// esta suite E2E nunca importa de src/, mismo criterio que el resto de este
// archivo). Si CONSENT_VERSION sube en código, actualizar acá también, o
// el gate de consentimiento (agenda.spec.ts) empieza a pedir la pantalla
// completa en toda la suite que no lo espera.
const CONSENT_VERSION_E2E = 'v1';

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
    // Consentimiento informado (gate nuevo, aparte del de contacto de
    // emergencia de arriba) YA aceptado por defecto -- mismo criterio que
    // profiles/mockProfileRow: completo por defecto para no romper el resto
    // de la suite, a la que no le interesa este gate. Un spec que sí quiera
    // probar "sin consentimiento" pisa esta tabla a `[]` explícitamente
    // (ver agenda.spec.ts).
    consentimientos_socio: [
      {
        id: 'consent-e2e-1',
        user_id: SOCIO_DEMO.id,
        version: CONSENT_VERSION_E2E,
        nombre_declarado: SOCIO_DEMO.fullName,
        dni_declarado: SOCIO_DEMO.dni,
        fecha_aceptacion: '2025-01-15T00:00:00.000Z',
      },
    ],
  };
}

