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
// un ISO datetime local, para poder usar formatClassTime()/getCountdown().
export function combineDateAndTime(dateStr: string, timeStr: string | null): string | null {
  if (!timeStr) return null;
  const [h, m, s] = timeStr.split(':').map(Number);
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, s ?? 0).toISOString();
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
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('class_id')
    .eq('booking_date', occurrenceDate)
    .in('class_id', classIds);
  if (bookingsError) throw new Error(bookingsError.message);

  const countByClass = new Map<string, number>();
  for (const b of bookings ?? []) {
    countByClass.set(b.class_id, (countByClass.get(b.class_id) ?? 0) + 1);
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
  return Array.from(byLogicalKey.values());
}

