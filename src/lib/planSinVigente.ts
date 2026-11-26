import { Discipline } from '../types';

// "Renovar" de Inicio. fetchUserBalances() solo devuelve lo VIGENTE (Aparatos
// con fecha futura; créditos con saldo y fecha futura), así que un socio con
// todo vencido se veía igual que uno nuevo ("Todavía no tenés ningún pack
// activo."). Esto resume lo que el socio TUVO y hoy no tiene vigente, para:
//   * todo vencido (no le queda nada vigente): "Tu plan venció el DD/MM." o
//     "Te quedaste sin créditos de X.", con "Renovar" y "Hablar con Seba";
//   * caso parcial (le queda algo vigente): la disciplina sin vigente se ve
//     como tarjeta gris "Sin créditos", solo informativa; sin "Renovar"
//     (una compra reemplaza todo el plan: R2), queda "Agregar otro pack".
// Sin límite de antigüedad: cuenta todo lo que el socio tuvo alguna vez.

export interface DisciplinaSinVigente {
  disciplineId: string;
  name: string;
  kind: Discipline['kind'];
  // El vencimiento más reciente de esa disciplina (null si ninguna fila tenía fecha).
  ultimoVencimiento: string | null;
  // 'sin_creditos': tiene un lote con fecha futura, pero en 0.
  // 'vencido': todo lo de esa disciplina ya venció.
  motivo: 'sin_creditos' | 'vencido';
}

interface DisciplinaEmbebida {
  id: string;
  name: string;
  kind: Discipline['kind'];
  is_active?: boolean | null;
}

// Una fila de user_credits con su disciplina embebida (como la devuelve
// PostgREST: objeto o arreglo de uno).
export interface FilaCreditoConDisciplina {
  remaining_credits: number | null;
  expires_at: string | null;
  discipline: DisciplinaEmbebida | DisciplinaEmbebida[] | null;
}

function msDe(fecha: string | null): number | null {
  if (!fecha) return null;
  const ms = Date.parse(fecha);
  return Number.isNaN(ms) ? null : ms;
}

// Mismo criterio de "vigente" que fetchUserBalances(): Aparatos con fecha
// futura; créditos con saldo y fecha futura. Las disciplinas desactivadas del
// catálogo no se muestran (ya no se pueden comprar).
export function resumirSinVigente(filas: FilaCreditoConDisciplina[], ahora: number = Date.now()): DisciplinaSinVigente[] {
  const porDisciplina = new Map<string, { disciplina: DisciplinaEmbebida; filas: FilaCreditoConDisciplina[] }>();
  for (const fila of filas) {
    const disciplina = Array.isArray(fila.discipline) ? fila.discipline[0] : fila.discipline;
    if (!disciplina) continue;
    const grupo = porDisciplina.get(disciplina.id) ?? { disciplina, filas: [] };
    grupo.filas.push(fila);
    porDisciplina.set(disciplina.id, grupo);
  }

  const resultado: DisciplinaSinVigente[] = [];
  for (const { disciplina, filas: filasDisciplina } of porDisciplina.values()) {
    if (disciplina.is_active === false) continue;
    const conFechaFutura = filasDisciplina.filter((f) => (msDe(f.expires_at) ?? -Infinity) > ahora);
    const vigente =
      disciplina.kind === 'membership'
        ? conFechaFutura.length > 0
        : conFechaFutura.some((f) => (f.remaining_credits ?? 0) > 0);
    if (vigente) continue;

    let ultimoVencimiento: string | null = null;
    for (const f of filasDisciplina) {
      const ms = msDe(f.expires_at);
      if (ms !== null && (ultimoVencimiento === null || ms > (msDe(ultimoVencimiento) as number))) {
        ultimoVencimiento = f.expires_at;
      }
    }
    resultado.push({
      disciplineId: disciplina.id,
      name: disciplina.name,
      kind: disciplina.kind,
      ultimoVencimiento,
      motivo: disciplina.kind === 'credits' && conFechaFutura.length > 0 ? 'sin_creditos' : 'vencido',
    });
  }

  // El vencimiento más reciente primero (sin fecha al final); a igual fecha, por nombre.
  return resultado.sort((a, b) => {
    const ma = msDe(a.ultimoVencimiento);
    const mb = msDe(b.ultimoVencimiento);
    if (ma !== mb) {
      if (ma === null) return 1;
      if (mb === null) return -1;
      return mb - ma;
    }
    return a.name.localeCompare(b.name, 'es');
  });
}

const formateadorDiaArgentina = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Mendoza',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// "DD/MM" del día en Argentina; con el año si no es el año en curso.
export function fechaCortaArgentina(fechaISO: string, ahora: Date = new Date()): string {
  const [anio, mes, dia] = formateadorDiaArgentina.format(new Date(fechaISO)).split('-');
  const anioActual = formateadorDiaArgentina.format(ahora).slice(0, 4);
  return anio === anioActual ? `${dia}/${mes}` : `${dia}/${mes}/${anio}`;
}

// "CrossFit" / "CrossFit y Boxeo" / "CrossFit, Boxeo y Yoga".
function listarNombres(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// Texto para el socio que no tiene NADA vigente:
//   * si alguna disciplina quedó en 0 con la fecha todavía vigente:
//     "Te quedaste sin créditos de X.";
//   * si no, "Tu plan venció el DD/MM." (el vencimiento más reciente), o
//     "Tu plan venció." si ninguna fila tenía fecha.
export function textoPlanSinVigente(sinVigente: DisciplinaSinVigente[], ahora: Date = new Date()): string {
  const sinCreditos = sinVigente.filter((d) => d.motivo === 'sin_creditos');
  if (sinCreditos.length > 0) {
    return `Te quedaste sin créditos de ${listarNombres(sinCreditos.map((d) => d.name))}.`;
  }
  let masReciente: string | null = null;
  for (const d of sinVigente) {
    const ms = msDe(d.ultimoVencimiento);
    if (ms !== null && (masReciente === null || ms > (msDe(masReciente) as number))) masReciente = d.ultimoVencimiento;
  }
  return masReciente ? `Tu plan venció el ${fechaCortaArgentina(masReciente, ahora)}.` : 'Tu plan venció.';
}
