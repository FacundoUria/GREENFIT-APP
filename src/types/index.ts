// Tipos base — reflejan 1:1 las tablas reales de backend/supabase-schema.sql (Supabase).

export type Role = 'socio' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Pack {
  id: string;
  name: string; // "Pack 12 clases Boxeo"
  credits: number;
  price: number;
}

export interface UserCredit {
  id: string;
  userId: string;
  pack: Pack;
  remainingCredits: number;
  createdAt: string; // ISO date
}

export interface GymClass {
  id: string;
  title: string; // Boxeo, Cross, Funcional
  capacity: number;
  startTime: string; // ISO datetime
}

export interface Booking {
  id: string;
  userId: string;
  gymClass: GymClass;
  createdAt: string;
}
