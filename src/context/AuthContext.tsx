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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 42703 = undefined_column (Postgres) -- pasa si backend/supabase_migration_avatar.sql
// (columna profiles.avatar_url) todavía no se corrió en este ambiente.
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  return (error.message ?? '').toLowerCase().includes('column');
}

// Trae el profile (rol incluido) de la tabla `profiles` para un usuario ya autenticado.
// Sin esto tenemos sesión de Supabase pero no sabemos si es socio o admin.
//
// El login/bootstrap de TODA la app depende de que esto no rompa -- por eso
// pide avatar_url con un fallback defensivo: si esa columna todavía no
// existe (migración de avatar sin correr), reintenta sin ella en vez de
// tirar abajo el login entero por un campo que es puramente decorativo.
async function fetchProfile(userId: string): Promise<User & { active: boolean }> {
  let { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, dni, phone, role, active, avatar_url')
    .eq('id', userId)
    .single();

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from('profiles')
      .select('id, full_name, dni, phone, role, active')
      .eq('id', userId)
      .single());
  }

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
    avatarUrl: (data as any).avatar_url ?? null,
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

  return (
    <AuthContext.Provider value={{ user, isLoading, isBootstrapping, login, logout, updateAvatarUrl }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
