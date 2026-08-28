// Tipos base — reflejan 1:1 las tablas reales de backend/supabase-schema.sql (Supabase).

export type Role = 'socio' | 'admin';

export interface User {
  id: string;
  name: string;
  dni: string | null;
  phone: string | null;
  role: Role;
  avatarUrl: string | null;
  // true si tiene cargados los 7 campos obligatorios del perfil (pedido del
  // cliente): Nombre, Apellido (ambos salen de full_name), DNI, Correo,
  // Teléfono, Teléfono de emergencia y Domicilio -- ver
  // tienePerfilCompleto() en AuthContext.tsx. Mientras sea false,
  // MainTabs.tsx redirige al socio al tab Perfil (una sola vez al entrar,
  // sin tocar el resto de tabs) y ProfileStack.tsx expone SOLO "Mis datos"
  // dentro de esa pestaña hasta que complete y guarde.
  perfilCompleto: boolean;
}

export type DisciplineKind = 'credits' | 'membership';

export interface Discipline {
  id: string;
  name: string; // Boxeo, Kickstrike, CrossFit, Aparatos
  kind: DisciplineKind;
}

// Créditos que acredita un pack para UNA disciplina puntual -- un pack
// (combo) puede traer de 0 a N de estas.
export interface CreditoDePack {
  disciplineId: string;
  disciplineName: string;
  credits: number;
}

// Un pack ya no es "1 disciplina <-> 1 pack" -- ahora es un combo real:
// de 0 a N disciplinas de créditos (`creditos`) + opcionalmente Aparatos
// (`incluyeAparatos`, con `diasVigencia` configurable, NUNCA fijo).
// Ej: "Combo 8+8" = creditos: [Boxeo 8, CrossFit 8], incluyeAparatos: false.
// "Pase 2 Meses Aparatos" = creditos: [], incluyeAparatos: true, diasVigencia: 60.
export interface Pack {
  id: string;
  name: string; // "Combo 8+8" / "Pase 2 Meses Aparatos" / "Aparatos + 12 créditos CrossFit"
  creditos: CreditoDePack[];
  incluyeAparatos: boolean;
  diasVigencia: number | null; // solo aplica si incluyeAparatos es true
  price: number;
  isActive: boolean;
}

// Balance de un socio para UNA disciplina puntual. Un socio tiene un
// UserCredit por cada disciplina en la que tenga algo cargado.
export interface UserCredit {
  id: string;
  userId: string;
  // Créditos cargados a mano por el admin (fuera de la compra de un pack
  // puntual) no tienen pack asociado -- `pack_id` es nullable en la tabla.
  pack: Pack | null;
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
  title: string; // Boxeo, Kickstrike, CrossFit
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

// Un ejercicio dentro de un día puntual de la rutina, con sus series/reps/
// descanso/carga. `notes` es la instrucción de técnica de ESTE bloque
// (distinta de exercise.description, que es la ficha general reusable).
export interface RoutineExercise {
  id: string;
  exercise: Exercise;
  sets: number;
  reps: string; // texto libre, ej. "10-12" o "AMRAP"
  restSeconds: number;
  weightSuggestion: string | null;
  notes: string | null;
  orderIndex: number;
}

export interface RoutineDay {
  id: string;
  title: string;
  orderIndex: number;
  exercises: RoutineExercise[];
}

export interface Routine {
  id: string;
  userId: string | null;
  title: string;
  coachName: string | null;
  notes: string | null;
  createdAt: string;
  days: RoutineDay[];
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
