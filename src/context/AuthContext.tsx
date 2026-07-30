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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Trae el profile (rol incluido) de la tabla `profiles` para un usuario ya autenticado.
// Sin esto tenemos sesión de Supabase pero no sabemos si es socio o admin.
async function fetchProfile(userId: string): Promise<User & { active: boolean }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, dni, phone, role, active')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('No se pudo cargar el perfil del usuario.');
  }

  return {
    id: data.id,
    name: data.full_name,
    dni: data.dni,
    phone: data.phone,
    role: data.role,
    active: data.active ?? true,
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

  return (
    <AuthContext.Provider value={{ user, isLoading, isBootstrapping, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
