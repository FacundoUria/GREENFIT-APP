import { Platform, Share } from 'react-native';

// Datos mínimos que necesita este módulo -- no dependemos de ClassWithBookings
// ni de ningún tipo de pantalla puntual para poder reusarlo desde cualquier
// lugar que confirme una reserva (Booking, Home, futura Agenda).
export interface ReservaCalendario {
  disciplina: string;
  startAt: string; // ISO
  endAt: string | null;
  location: string | null;
}

export type ReservaShare = Pick<ReservaCalendario, 'disciplina' | 'startAt' | 'location'>;

const UNA_HORA_MS = 60 * 60 * 1000;

// "YYYYMMDDTHHmmssZ" -- formato UTC que exigen tanto el .ics como el link de
// Google Calendar.
function toIcsDate(iso: string): string {
  return `${new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function resolveEnd(reserva: Pick<ReservaCalendario, 'startAt' | 'endAt'>): string {
  return reserva.endAt ?? new Date(new Date(reserva.startAt).getTime() + UNA_HORA_MS).toISOString();
}

function buildIcsContent(reserva: ReservaCalendario): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GreenFit//Reserva//ES',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@greenfit.app`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `DTSTART:${toIcsDate(reserva.startAt)}`,
    `DTEND:${toIcsDate(resolveEnd(reserva))}`,
    `SUMMARY:${reserva.disciplina} - GreenFit`,
    reserva.location ? `LOCATION:${reserva.location}` : '',
    'DESCRIPTION:¡Nos vemos en el box!',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.filter(Boolean).join('\r\n');
}

function buildGoogleCalendarUrl(reserva: ReservaCalendario): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${reserva.disciplina} - GreenFit`,
    dates: `${toIcsDate(reserva.startAt)}/${toIcsDate(resolveEnd(reserva))}`,
    details: '¡Nos vemos en el box!',
    location: reserva.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Web: descarga un .ics real (lo abre Google/Apple/Outlook, lo que tenga
// configurado el usuario). Nativo: abre Google Calendar precargado en el
// navegador externo -- evita sumar expo-calendar y sus permisos nuevos por
// una sola pantalla.
export async function addToCalendar(reserva: ReservaCalendario): Promise<void> {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([buildIcsContent(reserva)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `greenfit-${reserva.disciplina.toLowerCase().replace(/\s+/g, '-')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  const { Linking } = await import('react-native');
  await Linking.openURL(buildGoogleCalendarUrl(reserva));
}

function buildShareText(reserva: ReservaShare): string {
  const fecha = new Date(reserva.startAt).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
  const hora = new Date(reserva.startAt).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const lugar = reserva.location ? ` (${reserva.location})` : '';
  return `¡Me anoté a ${reserva.disciplina} el ${fecha} a las ${hora}hs en GreenFit!${lugar} 💪`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'unavailable';

// Web Share API cuando está disponible (mobile Chrome/Safari); si no,
// copiamos al portapapeles. Nativo usa el Share sheet propio de RN.
export async function shareReserva(reserva: ReservaShare): Promise<ShareResult> {
  const text = buildShareText(reserva);

  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined') return 'unavailable';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'GreenFit', text });
        return 'shared';
      } catch {
        // El usuario cerró el share sheet -- no es un error real.
        return 'cancelled';
      }
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
    return 'unavailable';
  }

  try {
    await Share.share({ message: text });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}
