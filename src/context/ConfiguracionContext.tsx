import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Configuracion {
  precioCrossfit: number;
  precioBoxeo: number;
  precioKickstrike: number;
  precioAparatos: number;
  diasTolerancia: number;
  limiteCancelacionMinutos: number;
  aliasCvu: string;
  titularCuenta: string;
  alertaActiva: boolean;
  alertaMensaje: string;
}

const CONFIGURACION_POR_DEFECTO: Configuracion = {
  precioCrossfit: 0,
  precioBoxeo: 0,
  precioKickstrike: 0,
  precioAparatos: 0,
  diasTolerancia: 5,
  limiteCancelacionMinutos: 120,
  aliasCvu: '',
  titularCuenta: '',
  alertaActiva: false,
  alertaMensaje: '',
};

interface ConfiguracionContextValue {
  configuracion: Configuracion;
  loading: boolean;
}

const ConfiguracionContext = createContext<ConfiguracionContextValue>({
  configuracion: CONFIGURACION_POR_DEFECTO,
  loading: true,
});

// Única fuente de verdad para precios y reglas de negocio (límite de
// cancelación, tolerancia, datos de cobro): la misma fila `configuracion`
// que edita el admin desde el panel. Sin esto cada pantalla terminaba con
// su propia constante hardcodeada, silenciosamente desincronizada apenas
// Seba cambiaba un valor desde Configuración.
export function ConfiguracionProvider({ children }: { children: React.ReactNode }) {
  const [configuracion, setConfiguracion] = useState<Configuracion>(CONFIGURACION_POR_DEFECTO);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;

    function cargarConfiguracion() {
      supabase
        .from('configuracion')
        .select(
          'precio_crossfit, precio_boxeo, precio_kickstrike, precio_aparatos, dias_tolerancia, limite_cancelacion_minutos, alias_cvu, titular_cuenta'
        )
        .eq('id', 1)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!activo) return;
          if (error) {
            console.error('No se pudo cargar la configuración del gimnasio:', error.message);
          } else if (data) {
            setConfiguracion((prev) => ({
              ...prev,
              precioCrossfit: data.precio_crossfit ?? 0,
              precioBoxeo: data.precio_boxeo ?? 0,
              precioKickstrike: data.precio_kickstrike ?? 0,
              precioAparatos: data.precio_aparatos ?? 0,
              diasTolerancia: data.dias_tolerancia ?? 5,
              limiteCancelacionMinutos: data.limite_cancelacion_minutos ?? 120,
              aliasCvu: data.alias_cvu ?? '',
              titularCuenta: data.titular_cuenta ?? '',
            }));
          }
          setLoading(false);
        });

      // Consulta APARTE (no fusionada arriba): si `alerta_app_activa`/
      // `alerta_app_mensaje` todavía no existen en este ambiente (migración
      // supabase_migration_alerta_app.sql sin correr todavía), esto falla
      // solo, sin tirar abajo precios/reglas de negocio de arriba -- la
      // alerta global simplemente no se activa hasta que se despliegue.
      supabase
        .from('configuracion')
        .select('alerta_app_activa, alerta_app_mensaje')
        .eq('id', 1)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!activo || error || !data) return;
          setConfiguracion((prev) => ({
            ...prev,
            alertaActiva: data.alerta_app_activa ?? false,
            alertaMensaje: data.alerta_app_mensaje ?? '',
          }));
        });
    }

    cargarConfiguracion();

    // Suscripción en vivo -- antes, si Seba cambiaba el Alias/CVU o el
    // Titular desde el panel Admin mientras un socio ya tenía la Home
    // abierta, esa pantalla seguía mostrando el dato viejo hasta que la app
    // se cerraba y se volvía a abrir (esto solo se pedía UNA vez, al montar
    // el Provider). Mismo patrón que la suscripción de user_credits en
    // HomeScreen.tsx: el evento de Realtime no valida RLS por sí solo, así
    // que no se confía en el payload crudo -- se usa solo como disparador
    // para volver a pedir la fila real vía `cargarConfiguracion()`.
    const channel = supabase
      .channel('configuracion-gimnasio')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion', filter: 'id=eq.1' }, () => {
        cargarConfiguracion();
      })
      .subscribe();

    return () => {
      activo = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <ConfiguracionContext.Provider value={{ configuracion, loading }}>{children}</ConfiguracionContext.Provider>
  );
}

export function useConfiguracion() {
  return useContext(ConfiguracionContext);
}
