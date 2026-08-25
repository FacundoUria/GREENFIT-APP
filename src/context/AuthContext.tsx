import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { syncMyMembership } from '../lib/creditsApi';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;       // loading de login puntual
  isBootstrapping: boolean; // loading inicial: ¿ya había sesión guardada?
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Actualiza SOLO el avatar en memoria tras una subida exitosa -- evita un
  // roundtrip completo a fetchProfile() y hace que el nuevo avatar se vea al
  // instante en cualquier pantalla que lea useAuth().user.avatarUrl (Perfil,
  // Feed/Ranking de Comunidad vía el propio post/mensaje que se acaba de
  // crear, etc.) sin esperar a la próxima carga.
  updateAvatarUrl: (avatarUrl: string) => void;
  // Se llama desde ProfileScreen justo después de guardar "Mis datos" con
  // éxito -- actualiza el flag en memoria al instante (sin esto, el banner
  // de aviso/la redirección seguirían activos hasta la próxima apertura de
  // la app, porque `user` en memoria seguiría con el flag viejo).
  marcarPerfilCompleto: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Campos obligatorios del perfil (pedido del cliente, reemplaza al set
// anterior de "solo datos de emergencia"): Nombre y Apellido salen del
// mismo full_name de siempre (ver ProfileScreen.tsx, que lo separa solo
// para mostrarlo), DNI/Correo ya eran not-null en la tabla, Teléfono y
// Teléfono de emergencia ya existían -- Domicilio es el único campo
// realmente nuevo. Contacto de emergencia (nombre) y Ficha médica quedaron
// afuera del set obligatorio a pedido explícito del cliente.
function tienePerfilCompleto(data: {
  full_name?: string | null;
  dni?: string | null;
  email?: string | null;
  phone?: string | null;
  emergency_contact_phone?: string | null;
  domicilio?: string | null;
}): boolean {
  return (
    !!data.full_name?.trim() &&
    !!data.dni?.trim() &&
    !!data.email?.trim() &&
    !!data.phone?.trim() &&
    !!data.emergency_contact_phone?.trim() &&
    !!data.domicilio?.trim()
  );
}

// avatar_url y domicilio son las 2 columnas "más nuevas" de profiles (cada
// una con su propia migración, corridas en momentos distintos) -- se piden
// SUELTAS y con error tolerado en vez de en el select principal, para que
// si UNA de las 2 todavía no existe en este ambiente no tire abajo la otra
// ni, sobre todo, el login entero (que depende de fetchProfile).
async function fetchColumnaOpcional(userId: string, columna: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select(columna).eq('id', userId).single();
  if (error || !data) return null;
  return (data as any)[columna] ?? null;
}

// Trae el profile (rol incluido) de la tabla `profiles` para un usuario ya autenticado.
// Sin esto tenemos sesión de Supabase pero no sabemos si es socio o admin.
async function fetchProfile(userId: string): Promise<User & { active: boolean }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, dni, phone, role, active, email, emergency_contact_name, emergency_contact_phone, medical_notes')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('No se pudo cargar el perfil del usuario.');
  }

  const [avatarUrl, domicilio] = await Promise.all([
    fetchColumnaOpcional(userId, 'avatar_url'),
    fetchColumnaOpcional(userId, 'domicilio'),
  ]);

  return {
    id: data.id,
    name: data.full_name,
    dni: data.dni,
    phone: data.phone,
    role: data.role,
    active: data.active ?? true,
    avatarUrl,
    perfilCompleto: tienePerfilCompleto({ ...(data as any), domicilio }),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  // Al abrir la app: ¿ya hay una sesión guardada por el AsyncStorage de Supabase?
  useEffect(() => {
    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        try {
          const profile = await fetchProfile(session.user.id);
          // Re-chequea en cada apertura de la app -- si te dieron de baja
          // mientras tenías la sesión guardada, no hay que esperar a que
          // expire el token para cortarte el acceso.
          if (profile.role !== 'socio' || !profile.active) {
            await supabase.auth.signOut();
            setUser(null);
          } else {
            setUser(profile);
            syncMyMembership();
          }
        } catch {
          setUser(null);
        }
      }
      setIsBootstrapping(false);
    }
    bootstrap();

    // Reacciona también a cambios de sesión en caliente (logout desde otra pantalla, token vencido, etc.)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (!session?.user) setUser(null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function login(email: string, password: string) {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const profile = await fetchProfile(data.user.id);
      // Esta app es exclusiva para socios — el panel de administración vive
      // en el dashboard web aparte, así que una cuenta admin no debe poder
      // "entrar" acá (evita confusión y evita exponer el resto de la UI a
      // rutas de socio que no le aplican).
      if (profile.role !== 'socio') {
        await supabase.auth.signOut();
        throw new Error('Esta app es exclusiva para socios. Ingresá al panel web para administrar el gimnasio.');
      }
      if (!profile.active) {
        await supabase.auth.signOut();
        throw new Error('Tu cuenta está inactiva. Contactá al gimnasio para más información.');
      }
      setUser(profile);
      syncMyMembership();
    } finally {
      setIsLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  function updateAvatarUrl(avatarUrl: string) {
    setUser((prev) => (prev ? { ...prev, avatarUrl } : prev));
  }

  function marcarPerfilCompleto() {
    setUser((prev) => (prev ? { ...prev, perfilCompleto: true } : prev));
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isBootstrapping, login, logout, updateAvatarUrl, marcarPerfilCompleto }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
