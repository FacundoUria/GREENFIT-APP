import { supabase } from './supabase';
import { Pack, UserCredit } from '../types';

// Un pack sin discipline_id (ej. cargado a mano por SQL sin completar ese
// campo) no se puede asignar a nadie — se descarta acá en vez de romper
// toda la lista para los packs que sí están bien cargados.
//
// `activeOnly` filtra los pases dados de baja (is_active = false) — se usa
// en el modal de compra del socio; el panel de gestión del admin trae todos
// (activos e inactivos) para poder reactivarlos.
export async function fetchPacks(options?: { activeOnly?: boolean }): Promise<Pack[]> {
  let query = supabase
    .from('packs')
    .select('id, name, credits, duration_days, price, is_active, discipline:disciplines(id, name, kind)')
    .order('name');
  if (options?.activeOnly) {
    query = query.eq('is_active', true);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const packs: Pack[] = [];
  for (const p of data ?? []) {
    const discipline = Array.isArray(p.discipline) ? p.discipline[0] : p.discipline;
    if (!discipline) continue;
    packs.push({
      id: p.id,
      name: p.name,
      credits: p.credits,
      durationDays: p.duration_days,
      price: p.price,
      isActive: p.is_active,
      discipline: { id: discipline.id, name: discipline.name, kind: discipline.kind },
    });
  }
  return packs;
}

// El balance más reciente del socio para CADA disciplina en la que tenga
// algo cargado (una fila por disciplina, no una sola global).
export async function fetchUserBalances(userId: string): Promise<UserCredit[]> {
  const { data, error } = await supabase
    .from('user_credits')
    .select(
      'id, user_id, remaining_credits, expires_at, created_at, discipline:disciplines(id, name, kind), pack:packs(id, name, credits, duration_days, price, is_active)'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const latestByDiscipline = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    const discipline = Array.isArray(row.discipline) ? row.discipline[0] : row.discipline;
    if (!latestByDiscipline.has(discipline.id)) latestByDiscipline.set(discipline.id, row);
  }

  return Array.from(latestByDiscipline.values()).map((row) => {
    const discipline = Array.isArray(row.discipline) ? row.discipline[0] : row.discipline;
    const pack = Array.isArray(row.pack) ? row.pack[0] : row.pack;
    return {
      id: row.id,
      userId: row.user_id,
      remainingCredits: row.remaining_credits,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      discipline: { id: discipline.id, name: discipline.name, kind: discipline.kind },
      pack: {
        id: pack.id,
        name: pack.name,
        credits: pack.credits,
        durationDays: pack.duration_days,
        price: pack.price,
        isActive: pack.is_active,
        discipline: { id: discipline.id, name: discipline.name, kind: discipline.kind },
      },
    };
  });
}
