import { supabase } from './supabase';
import { GymClass } from '../types';

// Ocurrencia puntual de una clase recurrente para un día específico —
// `startAt`/`endAt` combinan la fecha elegida con la hora de la plantilla,
// listos para pasarle a formatClassTime()/getCountdown() como siempre.
export type ClassWithBookings = GymClass & {
  bookedCount: number;
  occurrenceDate: string; // "YYYY-MM-DD"
  startAt: string; // ISO datetime de esta ocurrencia puntual
  endAt: string | null;
};

const CLASS_COLUMNS =
  'id, title, discipline_id, instructor, location, capacity, days_of_week, start_time, end_time, disciplines(is_active, show_in_agenda)';

function mapClass(c: {
  id: string;
  title: string;
  discipline_id: string;
  instructor: string | null;
  location: string | null;
  capacity: number;
  days_of_week: number[];
  start_time: string;
  end_time: string | null;
}): GymClass {
  return {
    id: c.id,
    title: c.title,
    disciplineId: c.discipline_id,
    instructor: c.instructor,
    location: c.location,
    capacity: c.capacity,
    daysOfWeek: c.days_of_week ?? [],
    startTime: c.start_time,
    endTime: c.end_time,
  };
}

export function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Combina una fecha ("YYYY-MM-DD") con una hora de plantilla ("HH:mm:ss") en
// el instante real de esa ocurrencia -- SIEMPRE en horario de Argentina
// (-03:00 fijo, sin horario de verano desde 2009 -- mismo criterio que ya
// usan las RPCs de SQL, ej. cancel_booking() con
// `at time zone 'America/Argentina/Mendoza'`), nunca según la zona
// horaria configurada en el dispositivo.
//
// Bug real reportado: la versión anterior armaba esto con
// `new Date(y, mo - 1, d, h, m, s)` -- componentes numéricos sueltos, que
// el motor de JS SIEMPRE interpreta según la zona horaria del dispositivo
// donde corre, nunca una zona fija. Si el celular del socio tenía la zona
// mal configurada (ej. UTC en vez de UTC-3 -- pasa en dispositivos sin
// auto-zona), CADA horario de clase se reconstruía corrido esa cantidad
// de horas, y el filtro de "¿ya pasó?" de loadClassesForDate() terminaba
// marcando el día entero como pasado -- Agenda vacía para cualquier
// disciplina, en cualquier dispositivo mal configurado, sin que la app
// dijera nada. Escribir el offset "-03:00" explícito en el string ISO
// antes de construir el Date lo vuelve inequívoco: el motor de JS ya no
// tiene ninguna zona que adivinar, sin necesidad de sumar una librería de
// fechas (day.js/luxon/date-fns-tz) que este repo no tiene instalada.
export function combineDateAndTime(dateStr: string, timeStr: string | null): string | null {
  if (!timeStr) return null;
  return new Date(`${dateStr}T${timeStr}-03:00`).toISOString();
}

// Clases que se dictan el día de `date` (según days_of_week), con la
// cantidad de anotados de ESA ocurrencia puntual (class_id + booking_date).
export async function loadClassesForDate(date: Date): Promise<ClassWithBookings[]> {
  const weekday = date.getDay(); // 0=Dom...6=Sáb, mismo criterio que days_of_week
  const occurrenceDate = formatDateOnly(date);

  const { data: classes, error: classesError } = await supabase
    .from('classes')
    .select(CLASS_COLUMNS)
    .contains('days_of_week', [weekday])
    .order('start_time', { ascending: true });
  if (classesError) throw new Error(classesError.message);
  if (!classes || classes.length === 0) return [];

  // Una clase de una disciplina desactivada deja de ofrecerse para NUEVAS
  // reservas -- no se borra ni se toca su historial, solo desaparece acá.
  // `show_in_agenda === false` es distinto de is_active: la disciplina
  // sigue activa/vendible (Aparatos, packs, etc.), simplemente sus franjas
  // horarias son informativas (pase libre, sin turnos que reservar) y no
  // deben listarse acá como "clases para reservar" (ver checklist punto 2 /
  // supabase_migration_show_in_agenda.sql).
  const classesActivas = classes.filter((c) => {
    const disciplina = Array.isArray(c.disciplines) ? c.disciplines[0] : c.disciplines;
    return disciplina?.is_active !== false && disciplina?.show_in_agenda !== false;
  });
  if (classesActivas.length === 0) return [];

  const classIds = classesActivas.map((c) => c.id);

  // Cuenta real de inscriptos por clase para esta fecha puntual -- vía RPC
  // (SECURITY DEFINER), no con un SELECT directo a `bookings`. La policy
  // RLS de esa tabla es `auth.uid() = user_id or is_admin()` (ver
  // backend/supabase-schema.sql): un socio común que hiciera ese SELECT
  // directo solo podía leer SUS PROPIAS filas, así que `bookedCount` acá
  // daba como mucho 1 por clase (0 si el socio no se había anotado él
  // mismo) -- de ahí el bug real reportado ("0 de X cupos" en la PWA
  // mientras el Dashboard Admin, que sí bypasea esa policy vía is_admin(),
  // mostraba el número real de inscriptos para la MISMA clase). El RPC lee
  // la MISMA tabla con el MISMO filtro que ya usa el Admin (Clases.jsx:
  // `.from('bookings').eq('booking_date', fecha)`), solo que server-side
  // con privilegios elevados -- misma fuente de verdad para los dos, y
  // devuelve nada más que un COUNT (sin PII, no expone qué socios en
  // particular están anotados). Ver supabase_migration_bookings_count_rpc.sql.
  // Fail-open a propósito (mismo criterio que syncMyMembership/
  // fetchDisciplinasDelPlanActual en creditsApi.ts): si el RPC todavía no
  // existe en este ambiente (la migración no se corrió) no tiene sentido
  // tirar abajo TODA la Agenda -- mejor mostrar las clases con el cupo en 0
  // (mismo estado que había antes de este fix) que dejar al socio sin
  // poder ver ni reservar nada por un problema de conteo nada más.
  const { data: counts, error: bookingsError } = await supabase.rpc('get_bookings_count_por_clase', {
    p_class_ids: classIds,
    p_booking_date: occurrenceDate,
  });
  if (bookingsError) {
    console.warn(
      '[GreenFit] No se pudo leer el conteo real de inscriptos (¿falta correr supabase_migration_bookings_count_rpc.sql?):',
      bookingsError.message
    );
  }

  const countByClass = new Map<string, number>();
  for (const row of (counts ?? []) as { class_id: string; booked_count: number }[]) {
    countByClass.set(row.class_id, Number(row.booked_count));
  }

  const withBookings = classesActivas.map((c) => {
    const gymClass = mapClass(c);
    return {
      ...gymClass,
      bookedCount: countByClass.get(c.id) ?? 0,
      occurrenceDate,
      startAt: combineDateAndTime(occurrenceDate, gymClass.startTime)!,
      endAt: combineDateAndTime(occurrenceDate, gymClass.endTime),
    };
  });

  // Red de seguridad: si por lo que sea `classes` trae la misma fila (mismo
  // id) más de una vez, nos quedamos con una sola ocurrencia por tarjeta.
  const uniqueById = Array.from(new Map(withBookings.map((item) => [item.id, item])).values());

  // Segunda capa: clases con distinto id pero mismo título+horario (típico
  // de un alta duplicada por doble tap en "Crear clase") se muestran como
  // una sola tarjeta, priorizando la que ya tiene anotados.
  const byLogicalKey = new Map<string, (typeof uniqueById)[number]>();
  for (const item of uniqueById) {
    const key = `${item.title.trim().toLowerCase()}|${item.startTime}`;
    const existing = byLogicalKey.get(key);
    if (!existing || item.bookedCount > existing.bookedCount) {
      byLogicalKey.set(key, item);
    }
  }
  const resultado = Array.from(byLogicalKey.values());

  // Bug real reportado: la vista "HOY" de la Agenda seguía mostrando las
  // clases de la mañana aunque el socio entrara a la app a las 20:00 --
  // ensucia la pantalla con horarios a los que ya no puede anotarse. Ya
  // viene ordenado cronológicamente (el SELECT de `classes` pidió
  // `order('start_time', ascending)` y ningún paso de arriba reordena), así
  // que alcanza con filtrar las que ya arrancaron -- SOLO cuando `date` es
  // hoy: para cualquier otro día del selector ninguna ocurrencia "ya pasó"
  // todavía, así que el filtro no debe tocarlas.
  //
  // `item.startAt` ya es el instante real (fijo en -03:00, ver
  // combineDateAndTime) -- comparar contra Date.now() acá es seguro: a
  // diferencia de la construcción del instante de la clase, esta
  // comparación NO depende de ninguna zona horaria (dos instantes
  // absolutos se comparan igual sin importar cómo los muestre el
  // dispositivo), solo de que el reloj del dispositivo esté bien puesto en
  // términos absolutos -- un problema mucho más raro que una zona mal
  // configurada, y fuera del alcance de este fix.
  if (occurrenceDate === formatDateOnly(new Date())) {
    const ahora = Date.now();
    return resultado.filter((item) => new Date(item.startAt).getTime() >= ahora);
  }
  return resultado;
}

