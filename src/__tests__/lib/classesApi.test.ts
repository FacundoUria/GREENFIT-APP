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

// Visibilidad de inscriptos (pedido del cliente): la Agenda de la PWA
// muestra "X/Y cupos" por tarjeta (ver AgendaMobileView.tsx) -- ese X sale
// de `bookedCount`, que acá se calcula contando filas de `bookings` por
// class_id para la fecha puntual. Estos tests cubren que el conteo sea
// exacto: sumado bien por clase, sin cruzarse entre clases distintas.
describe('loadClassesForDate -- bookedCount (cantidad de inscriptos por clase, para el indicador "X/Y cupos")', () => {
  beforeEach(() => jest.clearAllMocks());

  function claseDe(id: string, overrides = {}) {
    return {
      id,
      title: 'CrossFit',
      discipline_id: 'disc-crossfit',
      instructor: null,
      location: null,
      capacity: 15,
      days_of_week: [1],
      start_time: '08:00:00',
      end_time: '09:00:00',
      disciplines: { is_active: true, show_in_agenda: true },
      ...overrides,
    };
  }

  it('suma correctamente varias reservas activas de la MISMA clase', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') return makeChain({ data: [claseDe('clase-1')], error: null });
      if (tabla === 'bookings') {
        return makeChain({
          data: [{ class_id: 'clase-1' }, { class_id: 'clase-1' }, { class_id: 'clase-1' }],
          error: null,
        });
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    });

    const [resultado] = await loadClassesForDate(LUNES);
    expect(resultado.bookedCount).toBe(3);
    expect(resultado.capacity).toBe(15);
  });

  it('cuenta cada clase por separado -- las reservas de una clase no contaminan el bookedCount de otra', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') {
        return makeChain({
          data: [claseDe('clase-1', { title: 'CrossFit A', start_time: '08:00:00' }), claseDe('clase-2', { title: 'CrossFit B', start_time: '18:00:00' })],
          error: null,
        });
      }
      if (tabla === 'bookings') {
        return makeChain({
          data: [{ class_id: 'clase-1' }, { class_id: 'clase-1' }, { class_id: 'clase-2' }],
          error: null,
        });
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    });

    const resultado = await loadClassesForDate(LUNES);
    const porId = new Map(resultado.map((c) => [c.id, c.bookedCount]));
    expect(porId.get('clase-1')).toBe(2);
    expect(porId.get('clase-2')).toBe(1);
  });

  it('sin ninguna reserva, bookedCount es 0 (no rompe ni deja undefined)', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') return makeChain({ data: [claseDe('clase-1')], error: null });
      if (tabla === 'bookings') return makeChain({ data: [], error: null });
      throw new Error(`tabla inesperada: ${tabla}`);
    });

    const [resultado] = await loadClassesForDate(LUNES);
    expect(resultado.bookedCount).toBe(0);
  });
});
