jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { supabase } from '../../lib/supabase';
import { loadClassesForDate, seDictaEnFecha } from '../../lib/classesApi';

// Pedido de Seba: una clase especial de un día se repetía todas las semanas en
// la Agenda. Con classes.fecha_unica, aparece SOLO su fecha.

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

function makeChain(result: any) {
  const chain: any = {};
  const self = () => chain;
  ['select', 'contains', 'order', 'eq', 'in'].forEach((m) => {
    chain[m] = jest.fn(self);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

// Lunes 10/08/2026 y el lunes siguiente.
const LUNES = new Date('2026-08-10T12:00:00');
const OTRO_LUNES = new Date('2026-08-17T12:00:00');

function clase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'CrossFit',
    discipline_id: 'disc-1',
    instructor: 'Seba',
    location: null,
    capacity: 20,
    days_of_week: [1],
    start_time: '19:00:00',
    end_time: '20:00:00',
    fecha_unica: null,
    disciplines: { is_active: true, show_in_agenda: true },
    ...overrides,
  };
}

// `.contains('days_of_week', [1])` trae la clase de una sola vez TODOS los
// lunes (su days_of_week es {1}): el mock simula eso devolviéndola siempre.
function mockear(filas: unknown[], conteos: { class_id: string; booked_count: number }[] = []) {
  mockedFrom.mockImplementation((tabla: string) => {
    if (tabla === 'classes') return makeChain({ data: filas, error: null });
    if (tabla === 'class_occurrence_cancellations') return makeChain({ data: [], error: null });
    throw new Error(`tabla inesperada: ${tabla}`);
  });
  mockedRpc.mockImplementation((fn: string) =>
    fn === 'get_bookings_count_por_clase' ? Promise.resolve({ data: conteos, error: null }) : Promise.resolve({ data: null, error: null })
  );
}

describe('loadClassesForDate -- clases de una sola vez (fecha_unica)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pide la columna fecha_unica', async () => {
    mockear([clase('semanal')]);
    await loadClassesForDate(LUNES);
    const chain = mockedFrom.mock.results[0].value;
    expect(chain.select.mock.calls[0][0]).toContain('fecha_unica');
  });

  it('en su fecha aparece, con fechaUnica en la clase', async () => {
    mockear([clase('especial', { title: 'Especial', fecha_unica: '2026-08-10' })]);
    const res = await loadClassesForDate(LUNES);
    expect(res.map((c) => c.id)).toEqual(['especial']);
    expect(res[0].fechaUnica).toBe('2026-08-10');
    expect(res[0].occurrenceDate).toBe('2026-08-10');
  });

  it('el lunes siguiente NO aparece (el bug de Seba); la semanal sí', async () => {
    mockear([clase('semanal'), clase('especial', { title: 'Especial', fecha_unica: '2026-08-10' })]);
    const res = await loadClassesForDate(OTRO_LUNES);
    expect(res.map((c) => c.id)).toEqual(['semanal']);
    expect(res[0].fechaUnica).toBeNull();
  });

  it('si ningún lunes coincide, no pide conteos ni cancelaciones de nada', async () => {
    mockear([clase('especial', { fecha_unica: '2026-08-03' })]);
    expect(await loadClassesForDate(LUNES)).toEqual([]);
    expect(mockedRpc).not.toHaveBeenCalled();
  });

  it('una de una sola vez con el MISMO título y hora que una semanal no se esconde: son 2 tarjetas', async () => {
    mockear(
      [clase('semanal'), clase('especial', { fecha_unica: '2026-08-10' })],
      [{ class_id: 'semanal', booked_count: 5 }]
    );
    const res = await loadClassesForDate(LUNES);
    expect(res.map((c) => c.id).sort()).toEqual(['especial', 'semanal']);
  });

  it('el agrupado por título y hora sigue juntando duplicados de verdad (dos semanales iguales)', async () => {
    mockear([clase('dup-1'), clase('dup-2')], [{ class_id: 'dup-2', booked_count: 3 }]);
    const res = await loadClassesForDate(LUNES);
    expect(res.map((c) => c.id)).toEqual(['dup-2']);
  });

  it('una fila sin la columna (antes de migrar / fixtures viejos) es semanal', async () => {
    const sinColumna: Record<string, unknown> = clase('vieja');
    delete sinColumna.fecha_unica;
    mockear([sinColumna]);
    const res = await loadClassesForDate(OTRO_LUNES);
    expect(res.map((c) => c.id)).toEqual(['vieja']);
    expect(res[0].fechaUnica).toBeNull();
  });
});

describe('seDictaEnFecha', () => {
  it('semanal: cualquier fecha (el día de semana ya lo filtró la consulta)', () => {
    expect(seDictaEnFecha({ fecha_unica: null }, '2026-08-17')).toBe(true);
    expect(seDictaEnFecha({}, '2026-08-17')).toBe(true);
  });
  it('una sola vez: solo su fecha', () => {
    expect(seDictaEnFecha({ fecha_unica: '2026-08-10' }, '2026-08-10')).toBe(true);
    expect(seDictaEnFecha({ fecha_unica: '2026-08-10' }, '2026-08-17')).toBe(false);
  });
});
