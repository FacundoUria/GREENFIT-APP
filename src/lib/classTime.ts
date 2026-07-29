// Formato de hora 24hs explícito — no confiar en que el locale del
// dispositivo respete es-AR (algunos motores JS igual devuelven AM/PM).
export function formatClassTime(startTime: string): string {
  return new Date(startTime).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// "Hoy" / "Mañana" / abreviatura de fecha, para anteponer a la hora.
export function formatDayLabel(startTime: string): string {
  const start = new Date(startTime);
  const now = new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Mañana';
  return start.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export interface Countdown {
  label: string;
  isSoon: boolean; // arranca en menos de 1 hora (y todavía no arrancó)
  isPast: boolean;
}

// Cuenta regresiva relativa al ahora. `label` va SIN paréntesis — quien
// renderiza decide el formato ("Hoy 19:00 hs (Faltan 45 min)", etc).
export function getCountdown(startTime: string): Countdown {
  const diffMs = new Date(startTime).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMin <= 0) {
    return { label: 'En curso', isSoon: false, isPast: true };
  }
  if (diffMin < 60) {
    return { label: `Faltan ${diffMin} min`, isSoon: true, isPast: false };
  }
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) {
    return { label: `En ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`, isSoon: false, isPast: false };
  }
  const diffDays = Math.round(diffHours / 24);
  return { label: `En ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`, isSoon: false, isPast: false };
}
