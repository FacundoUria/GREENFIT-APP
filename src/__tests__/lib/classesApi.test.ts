jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { supabase } from '../../lib/supabase';
import { loadClassesForDate } from '../../lib/classesApi';

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

// El conteo de inscriptos ya NO sale de un SELECT directo a `bookings`
// (ver el bug real documentado en classesApi.ts y en
// supabase_migration_bookings_count_rpc.sql) sino del RPC
// get_bookings_count_por_clase -- este helper mockea esa respuesta.
function mockBookingsCount(rows: { class_id: string; booked_count: number }[]) {
  mockedRpc.mockImplementation((fn: string) =>
    fn === 'get_bookings_count_por_clase' ? Promise.resolve({ data: rows, error: null }) : Promise.resolve({ data: null, error: null })
  );
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
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([]);

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
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([]);

    const resultado = await loadClassesForDate(LUNES);
    expect(resultado).toHaveLength(1);
  });
});

// Visibilidad de inscriptos (pedido del cliente): la Agenda de la PWA
// muestra "X/Y cupos" por tarjeta (ver AgendaMobileView.tsx) -- ese X sale
// de `bookedCount`, que acá se calcula vía el RPC get_bookings_count_por_clase
// (no un SELECT directo a `bookings` -- ver el bug real reportado, "0 de X
// cupos" en la PWA con inscriptos reales en el Admin, documentado en
// classesApi.ts y supabase_migration_bookings_count_rpc.sql). Estos tests
// cubren que el conteo sea exacto: sumado bien por clase, sin cruzarse
// entre clases distintas.
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
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([{ class_id: 'clase-1', booked_count: 3 }]);

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
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([
      { class_id: 'clase-1', booked_count: 2 },
      { class_id: 'clase-2', booked_count: 1 },
    ]);

    const resultado = await loadClassesForDate(LUNES);
    const porId = new Map(resultado.map((c) => [c.id, c.bookedCount]));
    expect(porId.get('clase-1')).toBe(2);
    expect(porId.get('clase-2')).toBe(1);
  });

  it('sin ninguna reserva, bookedCount es 0 (no rompe ni deja undefined)', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') return makeChain({ data: [claseDe('clase-1')], error: null });
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([]);

    const [resultado] = await loadClassesForDate(LUNES);
    expect(resultado.bookedCount).toBe(0);
  });

  // El bug real reportado ("0 de X cupos" en la PWA con inscriptos reales
  // en el Admin): antes, `bookedCount` salía de un SELECT directo a
  // `bookings`, restringido por RLS a `auth.uid() = user_id or is_admin()`
  // -- un socio común solo veía SUS PROPIAS filas. Este test prueba
  // justamente el escenario reportado: el RPC (que sí ve todas las filas,
  // vía SECURITY DEFINER) devuelve un conteo alto aunque la query directa
  // a `bookings` esté mockeada para no devolver nada -- si el código
  // volviera a leer `bookings` directo por error, este test rompería.
  it('lee el conteo real vía RPC aunque un SELECT directo a bookings esté vacío (el escenario del bug real: PWA veía 0, Admin veía 15)', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') return makeChain({ data: [claseDe('clase-1')], error: null });
      // Simula la RLS: un SELECT directo a `bookings` de un socio común no
      // vería las reservas de otros socios.
      if (tabla === 'bookings') return makeChain({ data: [], error: null });
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([{ class_id: 'clase-1', booked_count: 15 }]);

    const [resultado] = await loadClassesForDate(LUNES);
    expect(resultado.bookedCount).toBe(15);
    expect(mockedRpc).toHaveBeenCalledWith('get_bookings_count_por_clase', {
      p_class_ids: ['clase-1'],
      p_booking_date: '2026-08-10',
    });
  });

  // Fail-open a propósito (mismo criterio que syncMyMembership/
  // fetchDisciplinasDelPlanActual en creditsApi.ts): si el RPC todavía no
  // existe en este ambiente (falta correr la migración), la Agenda entera
  // no debe caerse -- las clases se siguen mostrando, solo con el cupo en
  // 0 hasta que se corra supabase_migration_bookings_count_rpc.sql.
  it('si el RPC de conteo falla (ej. migración no corrida), no rompe la Agenda -- solo deja bookedCount en 0', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') return makeChain({ data: [claseDe('clase-1')], error: null });
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockedRpc.mockResolvedValue({ data: null, error: { message: 'function not found in schema cache' } });

    const resultado = await loadClassesForDate(LUNES);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].bookedCount).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// Item 4 del ticket: la vista "HOY" seguía mostrando clases cuyo horario de
// inicio ya pasó -- ensucia la pantalla si el socio entra a la tarde/noche.
describe('loadClassesForDate -- oculta clases de HOY cuyo horario de inicio ya pasó', () => {
  beforeEach(() => jest.clearAllMocks());

  function claseDe(id: string, startTime: string) {
    return {
      id,
      title: 'CrossFit',
      discipline_id: 'disc-crossfit',
      instructor: null,
      location: null,
      capacity: 15,
      days_of_week: [0, 1, 2, 3, 4, 5, 6], // cualquier día, no es el foco del test
      start_time: startTime,
      end_time: null,
      disciplines: { is_active: true, show_in_agenda: true },
    };
  }

  it('para HOY, esconde las clases cuyo horario de inicio ya pasó y deja las que faltan (en orden cronológico)', async () => {
    // Hora fija (con fake timers) en vez de `new Date()` real -- de lo
    // contrario el test es flaky cerca de la medianoche: "una hora
    // después" de las 23:30 cae al día siguiente, y la clase "futura"
    // terminaría comparándose como si ya hubiera pasado. Mismo escenario
    // que describe el ticket: el socio entra a las 20:00 y la clase de
    // 07:00 (mañana) ya pasó, pero la de 21:00 (noche) todavía no.
    const ahora = new Date(2026, 7, 31, 20, 0, 0); // 31/ago/2026 20:00 local
    jest.useFakeTimers().setSystemTime(ahora);

    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') {
        return makeChain({
          data: [claseDe('clase-pasada', '07:00:00'), claseDe('clase-futura', '21:00:00')],
          error: null,
        });
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([]);

    const resultado = await loadClassesForDate(ahora);
    expect(resultado.map((c) => c.id)).toEqual(['clase-futura']);

    jest.useRealTimers();
  });

  // Bug real reportado (regresión del fix de arriba): combineDateAndTime()
  // armaba el instante de cada clase con `new Date(y, mo-1, d, h, m, s)`
  // (componentes numéricos sueltos) -- el motor de JS SIEMPRE interpreta
  // eso según la zona horaria CONFIGURADA EN EL DISPOSITIVO, nunca según
  // Argentina fija. Con el celular del socio en UTC en vez de UTC-3 (zona
  // mal configurada, sin auto-zona), cada horario de clase se corría 3
  // horas -- suficiente para que TODA la Agenda del día se calculara como
  // "ya pasada" al mismo tiempo, en cualquier disciplina. Este test simula
  // exactamente ese dispositivo (process.env.TZ = 'UTC') y confirma que
  // una clase de la noche (21:00, hora de pared de Argentina) sigue
  // apareciendo como pendiente cuando en términos reales todavía faltan
  // horas para que arranque -- fallaba con la implementación vieja de
  // combineDateAndTime(), pasa con el offset -03:00 fijo.
  it('con el dispositivo en UTC (zona mal configurada, no Argentina), las clases de la noche siguen apareciendo como pendientes', async () => {
    const tzOriginal = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // 20:00 hora real de Argentina = 23:00 UTC -- mismo instante real
      // que "las 20:00" del resto de esta suite, solo que ahora el reloj
      // del dispositivo lo muestra en UTC en vez de en hora de Argentina.
      const ahora = new Date('2026-08-31T23:00:00Z');
      jest.useFakeTimers().setSystemTime(ahora);

      mockedFrom.mockImplementation((tabla: string) => {
        if (tabla === 'classes') {
          return makeChain({
            data: [claseDe('clase-pasada', '07:00:00'), claseDe('clase-futura', '21:00:00')],
            error: null,
          });
        }
        throw new Error(`tabla inesperada: ${tabla}`);
      });
      mockBookingsCount([]);

      const resultado = await loadClassesForDate(ahora);
      // La de 07:00 (hora de pared ARG) ya pasó de sobra a las 20:00 ARG
      // reales -- se sigue ocultando. La de 21:00 (hora de pared ARG)
      // todavía no arrancó a las 20:00 ARG reales -- tiene que seguir
      // apareciendo, sin importar que el reloj del dispositivo diga
      // "23:00" en vez de "20:00".
      expect(resultado.map((c) => c.id)).toEqual(['clase-futura']);

      jest.useRealTimers();
    } finally {
      process.env.TZ = tzOriginal;
    }
  });

  it('para un día que NO es hoy, no filtra nada aunque el horario "ya haya pasado" en términos de reloj', async () => {
    mockedFrom.mockImplementation((tabla: string) => {
      if (tabla === 'classes') {
        return makeChain({ data: [claseDe('clase-1', '07:00:00')], error: null });
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    });
    mockBookingsCount([]);

    const resultado = await loadClassesForDate(LUNES);
    expect(resultado).toHaveLength(1);
  });
});
