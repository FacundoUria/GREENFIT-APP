jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import { loadClassesForDate } from '../../lib/classesApi';

const mockedFrom = supabase.from as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'contains', 'order', 'eq', 'in'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

// Un lunes real, para que `days_of_week: [1]` siempre matchee sin importar
// cuándo corra la suite.
const LUNES = new Date('2026-08-10T12:00:00');

// Checklist punto 2: una clase de una disciplina con show_in_agenda=false
// (pases libres como Aparatos, sin turnos reales que reservar) no debe
// aparecer en la Agenda de reservas -- distinto de is_active, que ya se
// filtraba antes de este cambio.
describe('loadClassesForDate -- filtra por is_active Y por show_in_agenda de la disciplina', () => {
  beforeEach(() => jest.clearAllMocks());

  function claseDe(discipline: { is_active?: boolean; show_in_agenda?: boolean }, overrides = {}) {
    return {
      id: 'clase-1',
      title: 'Aparatos libre',
      discipline_id: 'disc-aparatos',
      instructor: null,
      location: null,
      capacity: 20,
      days_of_week: [1],
      start_time: '07:00:00',
      end_time: '22:00:00',
      disciplines: discipline,
      ...overrides,
    };
  }

  it('una clase de disciplina con show_in_agenda=false NO aparece en la Agenda', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') {
        return makeChain({ data: [claseDe({ is_active: true, show_in_agenda: false })], error: null });
      }
      throw new Error(`no debería consultar ${tabla} sin ninguna clase activa`);
    });

    expect(await loadClassesForDate(LUNES)).toEqual([]);
  });

  it('una clase de disciplina activa y show_in_agenda=true (o sin definir) SÍ aparece', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') {
        return makeChain({ data: [claseDe({ is_active: true, show_in_agenda: true })], error: null });
      }
      if (tabla === 'bookings') return makeChain({ data: [], error: null });
      throw new Error(`tabla inesperada: ${tabla}`);
    });

    const resultado = await loadClassesForDate(LUNES);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe('clase-1');
  });

  it('sigue respetando is_active=false igual que antes (no es un reemplazo, son dos filtros independientes)', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') {
        return makeChain({ data: [claseDe({ is_active: false, show_in_agenda: true })], error: null });
      }
      throw new Error(`no debería consultar ${tabla} sin ninguna clase activa`);
    });

    expect(await loadClassesForDate(LUNES)).toEqual([]);
  });

  it('sin ninguna disciplina embebida (dato legacy), no rompe y sigue mostrando la clase', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') {
        return makeChain({ data: [claseDe(undefined as any)], error: null });
      }
      if (tabla === 'bookings') return makeChain({ data: [], error: null });
      throw new Error(`tabla inesperada: ${tabla}`);
    });

    const resultado = await loadClassesForDate(LUNES);
    expect(resultado).toHaveLength(1);
  });
});
