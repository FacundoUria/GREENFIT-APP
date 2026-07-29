import { supabase } from './supabase';

export interface ClosedDay {
  fecha: string; // "YYYY-MM-DD"
  motivo: string | null;
}

// Feriados / mantenimiento cargados por el admin. Se traen todos los que
// caen desde hoy en adelante -- son pocos por temporada, más simple que
// filtrar por rango cada vez que cambia el día seleccionado.
export async function fetchClosedDays(): Promise<ClosedDay[]> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('closed_days')
    .select('fecha, motivo')
    .gte('fecha', todayStr)
    .order('fecha', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({ fecha: row.fecha, motivo: row.motivo }));
}
