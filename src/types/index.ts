// Tipos base — reflejan 1:1 las tablas de backend/schema.sql
// Cuando conectes el backend real, estos son los shapes que va a devolver la API.

export type Role = 'socio' | 'admin';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Pack {
  id: number;
  name: string; // "Pack 12 clases Boxeo"
  totalCredits: number;
  validityDays: number;
}

export interface UserPack {
  id: number;
  userId: number;
  pack: Pack;
  creditsRemaining: number;
  expiresAt: string; // ISO date
  status: 'active' | 'expired';
}

export interface GymClass {
  id: number;
  name: string; // Boxeo, Cross, Funcional
  description?: string;
}

export interface Schedule {
  id: number;
  gymClass: GymClass;
  startTime: string; // ISO datetime
  capacity: number;
  bookedCount: number;
  status: 'open' | 'cancelled';
}

export type BookingStatus = 'confirmed' | 'cancelled' | 'attended' | 'no_show';

export interface Booking {
  id: number;
  userId: number;
  schedule: Schedule;
  status: BookingStatus;
  createdAt: string;
}

export interface AppNotification {
  id: number;
  userId: number | null; // null = masiva
  title: string;
  body: string;
  sentAt: string;
}
