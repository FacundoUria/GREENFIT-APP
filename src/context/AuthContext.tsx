import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;       // loading de login/register puntual
  isBootstrapping: boolean; // loading inicial: ¿ya había sesión guardada?
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Trae el profile (rol incluido) de la tabla `profiles` para un usuario ya autenticado.
// Sin esto tenemos sesión de Supabase pero no sabemos si es socio o admin.
async function fetchProfile(userId: string, email: string): Promise<User> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('No se pudo cargar el perfil del usuario.');
  }

  return {
    id: data.id,
    name: data.full_name,
    email,
    role: data.role,
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
          const profile = await fetchProfile(session.user.id, session.user.email!);
          setUser(profile);
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
      const profile = await fetchProfile(data.user.id, data.user.email!);
      setUser(profile);
    } finally {
      setIsLoading(false);
    }
  }

  async function register(email: string, password: string, fullName: string) {
    setIsLoading(true);
    try {
      // El trigger on_auth_user_created (definido en supabase-schema.sql) crea
      // el profile solo. Acá solo mandamos full_name como metadata para que el
      // trigger lo use en vez del default "Nuevo socio".
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw new Error(error.message);

      // Si el proyecto tiene confirmación de email activada, data.session viene null
      // acá y el usuario recién puede loguearse después de confirmar el mail.
      if (data.session && data.user) {
        const profile = await fetchProfile(data.user.id, data.user.email!);
        setUser(profile);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isBootstrapping, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
