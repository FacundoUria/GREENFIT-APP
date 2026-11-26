import {
  resumirSinVigente,
  textoPlanSinVigente,
  fechaCortaArgentina,
  DisciplinaSinVigente,
  FilaCreditoConDisciplina,
} from '../../lib/planSinVigente';

// "Renovar" de Inicio: qué tuvo el socio y hoy no tiene vigente, con el mismo
// criterio de "vigente" que fetchUserBalances (Aparatos con fecha futura;
// créditos con saldo y fecha futura). Hora inyectada: 25/11 al mediodía en
// Argentina.
const AHORA = new Date('2026-11-25T12:00:00-03:00');
const AHORA_MS = AHORA.getTime();
const FUTURO = '2026-12-20T23:59:59.999-03:00';
const PASADO = '2026-11-10T23:59:59.999-03:00';
const MAS_PASADO = '2026-09-30T23:59:59.999-03:00';

const CROSSFIT = { id: 'disc-crossfit', name: 'CrossFit', kind: 'credits' as const };
const BOXEO = { id: 'disc-boxeo', name: 'Boxeo', kind: 'credits' as const };
const SALA = { id: 'disc-sala', name: 'Sala', kind: 'membership' as const };

function fila(
  discipline: FilaCreditoConDisciplina['discipline'],
  remaining: number | null,
  expires: string | null
): FilaCreditoConDisciplina {
  return { remaining_credits: remaining, expires_at: expires, discipline };
}

describe('resumirSinVigente', () => {
  it('sin filas: nada', () => {
    expect(resumirSinVigente([], AHORA_MS)).toEqual([]);
  });

  it('lo vigente NO aparece: Aparatos con fecha futura, créditos con saldo y fecha futura', () => {
    const r = resumirSinVigente([fila(SALA, null, FUTURO), fila(CROSSFIT, 3, FUTURO)], AHORA_MS);
    expect(r).toEqual([]);
  });

  it('créditos en 0 con la fecha todavía vigente: "sin_creditos"', () => {
    expect(resumirSinVigente([fila(CROSSFIT, 0, FUTURO)], AHORA_MS)).toEqual([
      { disciplineId: 'disc-crossfit', name: 'CrossFit', kind: 'credits', ultimoVencimiento: FUTURO, motivo: 'sin_creditos' },
    ]);
  });

  it('créditos vencidos (con o sin saldo): "vencido", con el vencimiento más reciente', () => {
    const r = resumirSinVigente([fila(CROSSFIT, 5, MAS_PASADO), fila(CROSSFIT, 0, PASADO)], AHORA_MS);
    expect(r).toEqual([
      { disciplineId: 'disc-crossfit', name: 'CrossFit', kind: 'credits', ultimoVencimiento: PASADO, motivo: 'vencido' },
    ]);
  });

  it('Aparatos vencido: "vencido"', () => {
    expect(resumirSinVigente([fila(SALA, null, PASADO)], AHORA_MS)).toEqual([
      { disciplineId: 'disc-sala', name: 'Sala', kind: 'membership', ultimoVencimiento: PASADO, motivo: 'vencido' },
    ]);
  });

  it('un lote viejo vencido no cuenta si la disciplina tiene otro vigente con saldo', () => {
    expect(resumirSinVigente([fila(CROSSFIT, 2, MAS_PASADO), fila(CROSSFIT, 4, FUTURO)], AHORA_MS)).toEqual([]);
  });

  it('sin límite de antigüedad: un vencimiento de hace más de un año también aparece', () => {
    const r = resumirSinVigente([fila(BOXEO, 0, '2025-03-15T23:59:59.999-03:00')], AHORA_MS);
    expect(r.map((d) => [d.name, d.motivo])).toEqual([['Boxeo', 'vencido']]);
  });

  it('una disciplina desactivada del catálogo no aparece', () => {
    expect(resumirSinVigente([fila({ ...BOXEO, is_active: false }, 0, PASADO)], AHORA_MS)).toEqual([]);
  });

  it('la disciplina embebida como arreglo (forma de PostgREST) también se lee', () => {
    expect(resumirSinVigente([fila([CROSSFIT], 0, PASADO)], AHORA_MS).map((d) => d.name)).toEqual(['CrossFit']);
  });

  it('orden: el vencimiento más reciente primero; sin fecha, al final', () => {
    const r = resumirSinVigente(
      [fila(BOXEO, 0, MAS_PASADO), fila(SALA, null, null), fila(CROSSFIT, 0, PASADO)],
      AHORA_MS
    );
    expect(r.map((d) => d.name)).toEqual(['CrossFit', 'Boxeo', 'Sala']);
  });
});

describe('textoPlanSinVigente', () => {
  const d = (name: string, motivo: DisciplinaSinVigente['motivo'], ultimoVencimiento: string | null): DisciplinaSinVigente => ({
    disciplineId: `disc-${name}`,
    name,
    kind: 'credits',
    ultimoVencimiento,
    motivo,
  });

  it('plan vencido: "Tu plan venció el DD/MM." con el día en Argentina', () => {
    expect(textoPlanSinVigente([d('CrossFit', 'vencido', PASADO)], AHORA)).toBe('Tu plan venció el 10/11.');
  });

  it('usa el vencimiento más reciente', () => {
    expect(textoPlanSinVigente([d('Boxeo', 'vencido', MAS_PASADO), d('CrossFit', 'vencido', PASADO)], AHORA)).toBe(
      'Tu plan venció el 10/11.'
    );
  });

  it('un corte a fin del día (23:59 en Argentina, ya el día siguiente en UTC) muestra el día de Argentina', () => {
    expect(textoPlanSinVigente([d('CrossFit', 'vencido', '2026-11-10T02:59:59.999Z')], AHORA)).toBe(
      'Tu plan venció el 09/11.'
    );
  });

  it('de otro año: suma el año', () => {
    expect(textoPlanSinVigente([d('Boxeo', 'vencido', '2025-03-15T23:59:59.999-03:00')], AHORA)).toBe(
      'Tu plan venció el 15/03/2025.'
    );
  });

  it('sin ninguna fecha: "Tu plan venció."', () => {
    expect(textoPlanSinVigente([d('CrossFit', 'vencido', null)], AHORA)).toBe('Tu plan venció.');
  });

  it('en 0 con la fecha vigente: "Te quedaste sin créditos de X." (una, dos o tres disciplinas)', () => {
    expect(textoPlanSinVigente([d('CrossFit', 'sin_creditos', FUTURO)], AHORA)).toBe('Te quedaste sin créditos de CrossFit.');
    expect(textoPlanSinVigente([d('CrossFit', 'sin_creditos', FUTURO), d('Boxeo', 'sin_creditos', FUTURO)], AHORA)).toBe(
      'Te quedaste sin créditos de CrossFit y Boxeo.'
    );
    expect(
      textoPlanSinVigente(
        [d('CrossFit', 'sin_creditos', FUTURO), d('Boxeo', 'sin_creditos', FUTURO), d('Yoga', 'sin_creditos', FUTURO)],
        AHORA
      )
    ).toBe('Te quedaste sin créditos de CrossFit, Boxeo y Yoga.');
  });

  it('si hay alguna "sin créditos", manda ese texto aunque otra esté vencida', () => {
    expect(textoPlanSinVigente([d('Boxeo', 'vencido', PASADO), d('CrossFit', 'sin_creditos', FUTURO)], AHORA)).toBe(
      'Te quedaste sin créditos de CrossFit.'
    );
  });
});

describe('fechaCortaArgentina', () => {
  it('mismo año: DD/MM; otro año: DD/MM/AAAA', () => {
    expect(fechaCortaArgentina('2026-01-05T15:00:00-03:00', AHORA)).toBe('05/01');
    expect(fechaCortaArgentina('2024-12-31T15:00:00-03:00', AHORA)).toBe('31/12/2024');
  });
});
