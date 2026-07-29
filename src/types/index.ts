// Tipos base — reflejan 1:1 las tablas reales de backend/supabase-schema.sql (Supabase).

export type Role = 'socio' | 'admin';

export interface User {
  id: string;
  name: string;
  dni: string | null;
  phone: string | null;
  role: Role;
}

export type DisciplineKind = 'credits' | 'membership';

export interface Discipline {
  id: string;
  name: string; // Boxeo, Kickboxing, CrossFit, Aparatos
  kind: DisciplineKind;
}

export interface Pack {
  id: string;
  name: string; // "Pack 12 clases Boxeo" / "Mes libre Aparatos"
  discipline: Discipline;
  credits: number | null;      // null si la disciplina es 'membership'
  durationDays: number | null; // null si la disciplina es 'credits'
  price: number;
  isActive: boolean;
}

// Balance de un socio para UNA disciplina puntual. Un socio tiene un
// UserCredit por cada disciplina en la que tenga algo cargado.
export interface UserCredit {
  id: string;
  userId: string;
  pack: Pack;
  discipline: Discipline;
  remainingCredits: number | null; // solo aplica si discipline.kind === 'credits'
  expiresAt: string | null;        // solo aplica si discipline.kind === 'membership'
  createdAt: string;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  pack: Pack;
  discipline: Discipline;
  creditsAdded: number | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

// Plantilla recurrente semanal — NO un turno puntual. `startTime`/`endTime`
// son horas del día ("HH:mm:ss", sin fecha); `daysOfWeek` dice qué días se
// repite (0=Dom...6=Sáb, mismo criterio que Date.getDay()).
export interface GymClass {
  id: string;
  title: string; // Boxeo, Kickboxing, CrossFit
  disciplineId: string;
  instructor: string | null;
  location: string | null;
  capacity: number;
  daysOfWeek: number[];
  startTime: string; // "HH:mm:ss"
  endTime: string | null; // "HH:mm:ss"
}

export interface Booking {
  id: string;
  userId: string;
  gymClass: GymClass;
  bookingDate: string; // "YYYY-MM-DD" — la ocurrencia puntual reservada
  attended: boolean | null; // null = todavía sin marcar por el admin
  createdAt: string;
}

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  description: string | null;
  videoUrl: string | null;
}

// Un ejercicio dentro de una rutina puntual, con sus series/reps/descanso.
export interface RoutineExercise {
  id: string;
  exercise: Exercise;
  sets: number;
  reps: string; // texto libre, ej. "10-12" o "AMRAP"
  restSeconds: number;
  orderIndex: number;
}

export interface Routine {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  createdAt: string;
  exercises: RoutineExercise[];
}

export type NotificationAudience = 'all' | 'class' | 'user' | 'debtors';

export interface AppNotification {
  id: string;
  senderId: string;
  audience: NotificationAudience;
  targetClassId: string | null;
  targetUserId: string | null;
  title: string;
  body: string;
  createdAt: string;
}
