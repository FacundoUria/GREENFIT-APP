import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Configuracion {
  precioCrossfit: number;
  precioBoxeo: number;
  precioKickboxing: number;
  precioAparatos: number;
  diasTolerancia: number;
  limiteCancelacionMinutos: number;
  aliasCvu: string;
  titularCuenta: string;
}

const CONFIGURACION_POR_DEFECTO: Configuracion = {
  precioCrossfit: 0,
  precioBoxeo: 0,
  precioKickboxing: 0,
  precioAparatos: 0,
  diasTolerancia: 5,
  limiteCancelacionMinutos: 120,
  aliasCvu: '',
  titularCuenta: '',
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
    supabase
      .from('configuracion')
      .select(
        'precio_crossfit, precio_boxeo, precio_kickboxing, precio_aparatos, dias_tolerancia, limite_cancelacion_minutos, alias_cvu, titular_cuenta'
      )
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('No se pudo cargar la configuración del gimnasio:', error.message);
        } else if (data) {
          setConfiguracion({
            precioCrossfit: data.precio_crossfit ?? 0,
            precioBoxeo: data.precio_boxeo ?? 0,
            precioKickboxing: data.precio_kickboxing ?? 0,
            precioAparatos: data.precio_aparatos ?? 0,
            diasTolerancia: data.dias_tolerancia ?? 5,
            limiteCancelacionMinutos: data.limite_cancelacion_minutos ?? 120,
            aliasCvu: data.alias_cvu ?? '',
            titularCuenta: data.titular_cuenta ?? '',
          });
        }
        setLoading(false);
      });
  }, []);

  return (
    <ConfiguracionContext.Provider value={{ configuracion, loading }}>{children}</ConfiguracionContext.Provider>
  );
}

export function useConfiguracion() {
  return useContext(ConfiguracionContext);
}
