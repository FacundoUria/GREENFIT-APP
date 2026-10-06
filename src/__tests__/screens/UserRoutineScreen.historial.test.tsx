import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// Historial de rutina: "Finalizar Entrenamiento" guarda una foto de los
// ejercicios MARCADOS del día que se está viendo (con el peso de ese
// momento), bloquea con 0 marcados, muestra lo que responde el servidor
// (ventana de 10 s / tope diario), y la pestaña "Historial" muestra lo
// guardado, una tarjeta por sesión, con la opción de eliminar una sesión
// completa (con confirmación).

// Mismo objeto `user` en cada render, como en la app real (AuthContext lo
// guarda en estado) -- si no, `load` cambia de identidad en cada render y el
// useEffect vuelve a pedir la rutina, pisando los tildes recién hechos.
const mockAuth = { user: { id: 'user-1', name: 'Facundo Uria' } };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

// Mi Rutina carga con useFocusEffect -- sin un NavigationContainer real,
// se mockea para que dispare el callback al montar (mismo patrón que
// AgendaMobileView.render.test.tsx). Las recargas por foco / primer plano
// tienen su propio archivo: UserRoutineScreen.recarga.test.tsx.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactActual = require('react');
    ReactActual.useEffect(() => callback(), []);
  },
}));

// VideoModal trae react-native-webview (módulo nativo, no existe en Jest).
jest.mock('../../components/VideoModal', () => () => null);

// showAlert = Alert.alert en nativo / window.alert en web -- acá se espía.
jest.mock('../../lib/crossPlatformAlert', () => ({ showAlert: jest.fn() }));

jest.mock('../../lib/routinesApi', () => ({
  getUserRoutine: jest.fn(),
  getTodayCompletions: jest.fn(),
  markExerciseCompleted: jest.fn(),
  unmarkExerciseCompleted: jest.fn(),
  getUserExerciseWeights: jest.fn(),
  saveExerciseWeight: jest.fn(),
  finalizarEntrenamiento: jest.fn(),
  getRoutineHistory: jest.fn(),
  eliminarSesionHistorial: jest.fn(),
}));

import * as api from '../../lib/routinesApi';
import { showAlert } from '../../lib/crossPlatformAlert';

const mockShowAlert = showAlert as jest.Mock;
import UserRoutineScreen, {
  formatFechaHistorial,
  formatHoraArgentina,
  diaInicial,
  BLOQUEO_FINALIZAR_MS,
} from '../../screens/user/UserRoutineScreen';

const m = api as jest.Mocked<typeof api>;

function ejercicio(id: string, nombre: string, grupo: string, orden: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    exercise: { id: `ex-${id}`, name: nombre, muscleGroup: grupo, description: null, videoUrl: null },
    sets: 4,
    reps: '10-12',
    restSeconds: 60,
    weightSuggestion: null,
    notes: null,
    orderIndex: orden,
    ...extra,
  };
}

const ROUTINE = {
  id: 'r-1',
  userId: 'user-1',
  title: 'Rutina',
  coachName: 'Seba',
  notes: null,
  createdAt: '2026-08-01T00:00:00Z',
  days: [
    {
      id: 'd-1',
      title: 'Día 1 - Tren Inferior',
      orderIndex: 0,
      exercises: [
        ejercicio('re-1', 'Sentadilla', 'Piernas', 0, { weightSuggestion: '40kg' }),
        ejercicio('re-2', 'Estocadas', 'Piernas', 1),
        ejercicio('re-3', 'Gemelos', 'Piernas', 2),
      ],
    },
    {
      id: 'd-2',
      title: 'Día 2 - Tren Superior',
      orderIndex: 1,
      exercises: [ejercicio('re-4', 'Press de banca', 'Pecho', 0)],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  m.getUserRoutine.mockResolvedValue(ROUTINE as any);
  m.getTodayCompletions.mockResolvedValue(new Set());
  // Por exercise_id (Estocadas = ex-re-2), no por la fila de la rutina.
  m.getUserExerciseWeights.mockResolvedValue(new Map([['ex-re-2', '20kg']]));
  m.markExerciseCompleted.mockResolvedValue();
  m.getRoutineHistory.mockResolvedValue([]);
});

async function renderPantalla() {
  const utils = render(<UserRoutineScreen />);
  await waitFor(() => expect(utils.getByText('Sentadilla')).toBeTruthy());
  return utils;
}

describe('Mi Rutina -- Finalizar Entrenamiento (guarda en el historial)', () => {
  it('con 0 ejercicios marcados, bloquea sin llamar al servidor', async () => {
    const { getByText } = await renderPantalla();

    fireEvent.press(getByText('Finalizar Entrenamiento'));

    expect(getByText('Marcá al menos un ejercicio para finalizar el entrenamiento.')).toBeTruthy();
    expect(m.finalizarEntrenamiento).not.toHaveBeenCalled();
  });

  it('guarda solo lo marcado del día visible, con el peso actual (guardado o sugerencia) y el total del día', async () => {
    m.finalizarEntrenamiento.mockResolvedValue({ estado: 'registrado' });
    const { getByText, getByLabelText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByLabelText('Marcar Estocadas como completado'));
    fireEvent.press(getByText('Finalizar Entrenamiento'));

    await waitFor(() => expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(1));
    expect(m.finalizarEntrenamiento).toHaveBeenCalledWith('Día 1 - Tren Inferior', 3, [
      { nombre: 'Sentadilla', grupo: 'Piernas', series: 4, repeticiones: '10-12', peso: '40kg' },
      { nombre: 'Estocadas', grupo: 'Piernas', series: 4, repeticiones: '10-12', peso: '20kg' },
    ]);
    // Guardado parcial -> igual festeja, con el copy de progreso parcial.
    await waitFor(() => expect(getByText('¡Buen entrenamiento! 💪')).toBeTruthy());
  });

  it('si el servidor responde "reciente" (ventana de 10 s), avisa y NO muestra el festejo', async () => {
    m.finalizarEntrenamiento.mockResolvedValue({ estado: 'reciente' });
    const { getByText, getByLabelText, queryByText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByText('Finalizar Entrenamiento'));

    await waitFor(() => expect(getByText('Ya registraste este entrenamiento recién.')).toBeTruthy());
    expect(queryByText('¡Buen entrenamiento! 💪')).toBeNull();
    expect(queryByText('¡Rutina completa! 🔥')).toBeNull();
  });

  it('si el servidor responde "tope_diario", avisa del máximo de 20 por día y NO festeja', async () => {
    m.finalizarEntrenamiento.mockResolvedValue({ estado: 'tope_diario' });
    const { getByText, getByLabelText, queryByText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByText('Finalizar Entrenamiento'));

    await waitFor(() =>
      expect(getByText('Llegaste al máximo de 20 entrenamientos registrados por hoy.')).toBeTruthy()
    );
    expect(queryByText('¡Buen entrenamiento! 💪')).toBeNull();
  });

  it('si el guardado falla, avisa con el error real', async () => {
    m.finalizarEntrenamiento.mockRejectedValue(new Error('Network error'));
    const { getByText, getByLabelText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByText('Finalizar Entrenamiento'));

    await waitFor(() => expect(getByText('No se pudo guardar el entrenamiento: Network error')).toBeTruthy());
  });
});
describe('Mi Rutina -- estilo HUD de "Rutina de hoy" (misma lógica)', () => {
  it('header con el nombre real del socio, barra de sesión con el día y el contador X/Y', async () => {
    const { getByText, getAllByText, queryByText } = await renderPantalla();

    expect(queryByText('MODO ATLETA')).toBeNull(); // se sacó: header = avatar + nombre
    expect(getByText('Facundo')).toBeTruthy(); // primer nombre de useAuth, no escrito a mano
    expect(getByText('SESIÓN DE HOY')).toBeTruthy();
    // Título del día en la barra de sesión + en el selector de días.
    expect(getAllByText('Día 1 - Tren Inferior')).toHaveLength(2);
    expect(getByText('0/3')).toBeTruthy();
  });

  it('cada tarjeta lleva su número y grupo ("01 • PIERNAS"), y el contador sube al tildar', async () => {
    m.markExerciseCompleted.mockResolvedValue();
    const { getByText, getByLabelText } = await renderPantalla();

    expect(getByText('01 • PIERNAS')).toBeTruthy();
    expect(getByText('02 • PIERNAS')).toBeTruthy();
    expect(getByText('03 • PIERNAS')).toBeTruthy();

    fireEvent.press(getByLabelText('Marcar Estocadas como completado'));
    await waitFor(() => expect(getByText('1/3')).toBeTruthy());
    expect(getByLabelText('Estocadas, completado')).toBeTruthy();
    expect(m.markExerciseCompleted).toHaveBeenCalledWith('user-1', 're-2', expect.any(String));
  });

  it('las dos pestañas se llaman "Rutina de hoy" e "Historial" (no los nombres del mockup)', async () => {
    const { getByText, queryByText } = await renderPantalla();

    expect(getByText('Rutina de hoy')).toBeTruthy();
    expect(getByText('Historial')).toBeTruthy();
    expect(queryByText(/Entrenar Ahora/i)).toBeNull();
    expect(queryByText(/Rutinas Guardadas/i)).toBeNull();
    expect(queryByText(/Favorita/i)).toBeNull();
  });
});

describe('Mi Rutina -- pestaña Historial (una tarjeta por sesión)', () => {
  const HISTORIAL: api.DiaHistorial[] = [
    {
      fecha: '2026-09-26',
      sesiones: [
        {
          sesionId: 'tarde',
          creadoEn: '2026-09-26T21:30:00Z',
          tituloDia: 'Día 2 - Tren Superior',
          totalEjercicios: 1,
          completo: true,
          ejercicios: [{ id: 'h3', nombre: 'Press de banca', grupo: 'Pecho', series: 4, repeticiones: '8', peso: '50kg' }],
        },
        {
          sesionId: 'manana',
          creadoEn: '2026-09-26T11:15:00Z',
          tituloDia: 'Día 1 - Tren Inferior',
          totalEjercicios: 5,
          completo: false,
          ejercicios: [
            { id: 'h1', nombre: 'Sentadilla', grupo: 'Piernas', series: 4, repeticiones: '10', peso: '60kg' },
            { id: 'h2', nombre: 'Estocadas', grupo: 'Piernas', series: 3, repeticiones: '12', peso: null },
          ],
        },
      ],
    },
    {
      fecha: '2026-09-25',
      sesiones: [
        {
          sesionId: 'ayer',
          creadoEn: '2026-09-25T20:00:00Z',
          tituloDia: null,
          totalEjercicios: 1,
          completo: true,
          ejercicios: [{ id: 'h4', nombre: 'Gemelos', grupo: 'Piernas', series: 4, repeticiones: '15', peso: '30kg' }],
        },
      ],
    },
  ];

  async function abrirHistorial() {
    m.getRoutineHistory.mockResolvedValue(HISTORIAL);
    const utils = await renderPantalla();
    fireEvent.press(utils.getByText('Historial'));
    await waitFor(() => expect(utils.getByText('HISTORIAL DE ENTRENAMIENTOS')).toBeTruthy());
    return utils;
  }

  function hora(iso: string) {
    return `${formatHoraArgentina(iso)} hs`;
  }

  it('dos sesiones del mismo día = dos tarjetas separadas, cada una con su fecha, hora y título', async () => {
    const { getAllByText, getByText } = await abrirHistorial();

    expect(getByText('3 registrados')).toBeTruthy();
    // La fecha del 26 aparece una vez POR TARJETA (mañana y tarde), no mezcladas.
    expect(getAllByText(formatFechaHistorial('2026-09-26'))).toHaveLength(2);
    expect(getByText(hora('2026-09-26T21:30:00Z'))).toBeTruthy();
    expect(getByText(hora('2026-09-26T11:15:00Z'))).toBeTruthy();
    expect(getByText('Día 2 - Tren Superior')).toBeTruthy();
    expect(getByText('Día 1 - Tren Inferior')).toBeTruthy();
    // Sin título guardado -> "Entrenamiento".
    expect(getByText('Entrenamiento')).toBeTruthy();
  });

  it('las tarjetas van de la más reciente a la más vieja', async () => {
    const { getAllByText } = await abrirHistorial();

    const horas = getAllByText(/^\d{2}:\d{2} hs$/).map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c);
    });
    expect(horas).toEqual([hora('2026-09-26T21:30:00Z'), hora('2026-09-26T11:15:00Z'), hora('2026-09-25T20:00:00Z')]);
  });

  it('cada ejercicio muestra nombre, series × repeticiones Y peso (o "Sin carga")', async () => {
    const { getByText } = await abrirHistorial();

    expect(getByText('Sentadilla')).toBeTruthy();
    expect(getByText('4 × 10')).toBeTruthy();
    expect(getByText('60kg')).toBeTruthy();

    expect(getByText('Estocadas')).toBeTruthy();
    expect(getByText('3 × 12')).toBeTruthy();
    expect(getByText('Sin carga')).toBeTruthy();

    expect(getByText('Press de banca')).toBeTruthy();
    expect(getByText('4 × 8')).toBeTruthy();
    expect(getByText('50kg')).toBeTruthy();
  });

  it('una sesión incompleta muestra "N de M ejercicios"; una completa, "Completo"', async () => {
    const { getByText, getAllByText } = await abrirHistorial();

    expect(getByText('2 de 5 ejercicios')).toBeTruthy();
    expect(getAllByText('Completo')).toHaveLength(2);
  });

  it('no hay "Repetir" ni "Guardar como Rutina Favorita"; la única acción es "Eliminar" (una por tarjeta)', async () => {
    const { queryByText, getAllByText } = await abrirHistorial();

    expect(queryByText(/Repetir/i)).toBeNull();
    expect(queryByText(/Favorita/i)).toBeNull();
    expect(getAllByText('Eliminar')).toHaveLength(3);
  });

  const labelEliminarManana = () =>
    `Eliminar entrenamiento del ${formatFechaHistorial('2026-09-26')} a las ${formatHoraArgentina('2026-09-26T11:15:00Z')}`;

  it('"Eliminar" pide confirmación; "Cancelar" no borra nada', async () => {
    const { getByLabelText, getByText, queryByText } = await abrirHistorial();

    fireEvent.press(getByLabelText(labelEliminarManana()));
    expect(getByText('¿Eliminar este entrenamiento?')).toBeTruthy();
    expect(getByText(/Se borran los 2 ejercicios de esta sesión\. No se puede deshacer\./)).toBeTruthy();

    fireEvent.press(getByText('Cancelar'));
    expect(queryByText('¿Eliminar este entrenamiento?')).toBeNull();
    expect(m.eliminarSesionHistorial).not.toHaveBeenCalled();
  });

  it('confirmar borra la sesión COMPLETA (por sesion_id) y relee el historial del servidor', async () => {
    m.eliminarSesionHistorial.mockResolvedValue(2);
    const { getByLabelText, queryByText } = await abrirHistorial();
    // Lo que devuelve el servidor después del borrado: ya sin la sesión de la mañana.
    m.getRoutineHistory.mockResolvedValue([
      { fecha: '2026-09-26', sesiones: [HISTORIAL[0].sesiones[0]] },
      HISTORIAL[1],
    ]);

    fireEvent.press(getByLabelText(labelEliminarManana()));
    fireEvent.press(getByLabelText('Confirmar eliminar entrenamiento'));

    // Espera la relectura del historial y recién ahí verifica lo que se ve.
    await waitFor(() => expect(m.getRoutineHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryByText('2 de 5 ejercicios')).toBeNull());
    expect(m.eliminarSesionHistorial).toHaveBeenCalledTimes(1);
    expect(m.eliminarSesionHistorial).toHaveBeenCalledWith('manana');
    expect(queryByText('Sentadilla')).toBeNull();
    expect(queryByText('¿Eliminar este entrenamiento?')).toBeNull();
  });

  it('si el servidor no borra nada (0 filas), avisa que ya no estaba', async () => {
    m.eliminarSesionHistorial.mockResolvedValue(0);
    const { getByLabelText, getByText } = await abrirHistorial();

    fireEvent.press(getByLabelText(labelEliminarManana()));
    fireEvent.press(getByLabelText('Confirmar eliminar entrenamiento'));

    await waitFor(() => expect(getByText('Ese entrenamiento ya no estaba en tu historial.')).toBeTruthy());
  });

  it('si el borrado falla, avisa con el error real y la sesión sigue ahí', async () => {
    m.eliminarSesionHistorial.mockRejectedValue(new Error('Network error'));
    const { getByLabelText, getByText } = await abrirHistorial();

    fireEvent.press(getByLabelText(labelEliminarManana()));
    fireEvent.press(getByLabelText('Confirmar eliminar entrenamiento'));

    await waitFor(() => expect(getByText('No se pudo eliminar: Network error')).toBeTruthy());
    expect(getByText('2 de 5 ejercicios')).toBeTruthy();
  });

  it('sin entrenamientos guardados, muestra el estado vacío', async () => {
    const { getByText } = await renderPantalla();

    fireEvent.press(getByText('Historial'));

    await waitFor(() => expect(getByText('Todavía no hay entrenamientos')).toBeTruthy());
    expect(m.getRoutineHistory).toHaveBeenCalledWith('user-1');
  });

  it('volver a "Rutina de hoy" muestra la rutina de nuevo', async () => {
    const { getByText } = await renderPantalla();

    fireEvent.press(getByText('Historial'));
    await waitFor(() => expect(getByText('Todavía no hay entrenamientos')).toBeTruthy());
    fireEvent.press(getByText('Rutina de hoy'));

    expect(getByText('Sentadilla')).toBeTruthy();
  });
});

describe('Mi Rutina -- guardado de la carga nunca en silencio', () => {
  // Regresión real (2026-09-29): en producción la tabla de cargas no existía y
  // el socio escribía su peso, lo veía en pantalla y nunca se guardaba.
  it('si guardar la carga falla, el socio ve el aviso y el campo vuelve al valor anterior', async () => {
    m.saveExerciseWeight.mockRejectedValue(
      new Error('El guardado de cargas todavía no está activado en el servidor. Avisale al gimnasio.')
    );
    const { getAllByLabelText } = await renderPantalla();

    const carga = getAllByLabelText('Carga (kg) usada en este ejercicio')[0]; // Sentadilla, sugerencia 40kg
    expect(carga.props.value).toBe('40kg');
    fireEvent.changeText(carga, '45kg');
    fireEvent(carga, 'blur');

    await waitFor(() =>
      expect(mockShowAlert).toHaveBeenCalledWith(
        'No se pudo guardar la carga',
        'El guardado de cargas todavía no está activado en el servidor. Avisale al gimnasio.'
      )
    );
    expect(m.saveExerciseWeight).toHaveBeenCalledWith('user-1', 'ex-re-1', '45kg');
    await waitFor(() => expect(getAllByLabelText('Carga (kg) usada en este ejercicio')[0].props.value).toBe('40kg'));
  });

  it('la carga está atada al EJERCICIO: si Seba re-guarda la rutina (filas con ids nuevos, mismo ejercicio), se sigue viendo', async () => {
    // Mismo ejercicio (ex-re-2 = Estocadas) pero la fila de la rutina es otra,
    // como queda después de que el panel borra y recrea los días.
    const reGuardada = {
      ...ROUTINE,
      days: [
        {
          ...ROUTINE.days[0],
          id: 'd-1-nuevo',
          exercises: ROUTINE.days[0].exercises.map((e) => ({ ...e, id: `${e.id}-nuevo` })),
        },
      ],
    };
    m.getUserRoutine.mockResolvedValue(reGuardada as any);
    const { getAllByLabelText } = await renderPantalla();

    const cargas = getAllByLabelText('Carga (kg) usada en este ejercicio');
    expect(cargas[1].props.value).toBe('20kg'); // Estocadas: su carga guardada, no la sugerencia
    expect(cargas[0].props.value).toBe('40kg'); // Sentadilla: sin carga propia -> sugerencia
  });

  it('un ejercicio repetido en la rutina comparte la carga: se guarda UNA vez por exercise_id y se ve en los dos', async () => {
    m.saveExerciseWeight.mockResolvedValue();
    const conRepetido = {
      ...ROUTINE,
      days: [
        {
          ...ROUTINE.days[0],
          exercises: [
            ...ROUTINE.days[0].exercises,
            // Otra fila con el MISMO ejercicio que Sentadilla (ex-re-1).
            { ...ROUTINE.days[0].exercises[0], id: 're-1-bis', orderIndex: 3 },
          ],
        },
      ],
    };
    m.getUserRoutine.mockResolvedValue(conRepetido as any);
    // (Sentadilla aparece dos veces: no sirve el getByText de renderPantalla.)
    const { getAllByLabelText, getAllByText } = render(<UserRoutineScreen />);
    await waitFor(() => expect(getAllByText('Sentadilla')).toHaveLength(2));

    fireEvent.changeText(getAllByLabelText('Carga (kg) usada en este ejercicio')[0], '50kg');
    fireEvent(getAllByLabelText('Carga (kg) usada en este ejercicio')[0], 'blur');

    await waitFor(() => expect(m.saveExerciseWeight).toHaveBeenCalledWith('user-1', 'ex-re-1', '50kg'));
    expect(m.saveExerciseWeight).toHaveBeenCalledTimes(1);
    const cargas = getAllByLabelText('Carga (kg) usada en este ejercicio');
    expect(cargas[0].props.value).toBe('50kg');
    expect(cargas[3].props.value).toBe('50kg'); // la fila repetida muestra la misma carga
  });

  it('si guardar la carga anda, no hay ningún aviso y el valor queda', async () => {
    m.saveExerciseWeight.mockResolvedValue();
    const { getAllByLabelText } = await renderPantalla();

    const carga = getAllByLabelText('Carga (kg) usada en este ejercicio')[0];
    fireEvent.changeText(carga, '45kg');
    fireEvent(carga, 'blur');

    await waitFor(() => expect(m.saveExerciseWeight).toHaveBeenCalledWith('user-1', 'ex-re-1', '45kg'));
    expect(mockShowAlert).not.toHaveBeenCalled();
    expect(getAllByLabelText('Carga (kg) usada en este ejercicio')[0].props.value).toBe('45kg');
  });

  it('si Finalizar falla porque falta el historial en el servidor, avisa y NO festeja', async () => {
    m.finalizarEntrenamiento.mockRejectedValue(
      new Error('El historial de entrenamientos todavía no está activado en el servidor. Avisale al gimnasio.')
    );
    const { getByText, getByLabelText, queryByText } = await renderPantalla();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByText('Finalizar Entrenamiento'));

    await waitFor(() =>
      expect(
        getByText(
          'No se pudo guardar el entrenamiento: El historial de entrenamientos todavía no está activado en el servidor. Avisale al gimnasio.'
        )
      ).toBeTruthy()
    );
    expect(queryByText('¡Buen entrenamiento! 💪')).toBeNull();
  });
});

describe('Mi Rutina -- día que arranca seleccionado', () => {
  it('sin tildes hoy, arranca en el primer día (order_index)', async () => {
    const { getByText } = await renderPantalla();
    expect(getByText('0/3')).toBeTruthy(); // Día 1 tiene 3 ejercicios
  });

  it('si hoy ya hay ejercicios tildados en otro día, arranca en ese día', async () => {
    m.getTodayCompletions.mockResolvedValue(new Set(['re-4'])); // re-4 = Press de banca, Día 2
    const { getByText, getByLabelText, queryByText } = await render(<UserRoutineScreen />);

    await waitFor(() => expect(getByText('Press de banca')).toBeTruthy());
    expect(getByText('1/1')).toBeTruthy();
    expect(getByLabelText('Press de banca, completado')).toBeTruthy();
    expect(queryByText('Sentadilla')).toBeNull();
  });

  it('diaInicial: primer día con tildes; si el socio ya eligió uno a mano, se respeta', () => {
    const r = ROUTINE as any;
    expect(diaInicial(r, new Set(), null)).toBe(0);
    expect(diaInicial(r, new Set(['re-4']), null)).toBe(1);
    // Tildes en los dos días -> el primero en el orden del entrenador.
    expect(diaInicial(r, new Set(['re-4', 're-2']), null)).toBe(0);
    // Ya eligió el Día 2 a mano: al refrescar no se lo cambia por los tildes.
    expect(diaInicial(r, new Set(['re-2']), 1)).toBe(1);
    // Eligió un día que ya no existe (el entrenador sacó días) -> el primero.
    expect(diaInicial(r, new Set(), 5)).toBe(0);
    expect(diaInicial(null, new Set(), null)).toBe(0);
  });
});

describe('Mi Rutina -- bloqueo de Finalizar contra el doble toque', () => {
  afterEach(() => jest.useRealTimers());

  async function tildarYFinalizar() {
    const utils = await renderPantalla();
    fireEvent.press(utils.getByLabelText('Marcar Sentadilla como completado'));
    return utils;
  }

  it(`un segundo toque dentro de los ${BLOQUEO_FINALIZAR_MS / 1000}s no vuelve a llamar al servidor; pasado el bloqueo, sí`, async () => {
    m.finalizarEntrenamiento.mockResolvedValue({ estado: 'registrado' });
    const { getByText } = await tildarYFinalizar();
    jest.useFakeTimers();

    fireEvent.press(getByText('Finalizar Entrenamiento'));
    await waitFor(() => expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(1));
    fireEvent.press(getByText('Genial')); // cierra el festejo

    // Ya respondió el servidor, pero todavía no pasó la ventana: sigue bloqueado.
    fireEvent.press(getByText('Finalizar Entrenamiento'));
    expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(BLOQUEO_FINALIZAR_MS);
    });
    fireEvent.press(getByText('Finalizar Entrenamiento'));
    await waitFor(() => expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(2));
  });

  it('si el servidor tarda MÁS que la ventana, el botón sigue bloqueado hasta que responde', async () => {
    let responder: (v: api.ResultadoFinalizar) => void = () => {};
    m.finalizarEntrenamiento.mockImplementation(() => new Promise((res) => (responder = res)));
    const { getByText, queryByText } = await tildarYFinalizar();
    jest.useFakeTimers();

    fireEvent.press(getByText('Finalizar Entrenamiento'));
    await act(async () => {
      jest.advanceTimersByTime(BLOQUEO_FINALIZAR_MS + 5000);
    });
    // Sigue esperando (spinner, sin texto) y un toque no dispara otra llamada.
    expect(queryByText('Finalizar Entrenamiento')).toBeNull();
    expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(1);

    await act(async () => {
      responder({ estado: 'registrado' });
    });
    // Respondió después de la ventana -> se habilita enseguida.
    fireEvent.press(getByText('Genial'));
    fireEvent.press(getByText('Finalizar Entrenamiento'));
    await waitFor(() => expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(2));
  });

  it('el toque con 0 marcados NO bloquea el botón (no hubo ningún envío)', async () => {
    m.finalizarEntrenamiento.mockResolvedValue({ estado: 'registrado' });
    const { getByText, getByLabelText } = await renderPantalla();

    fireEvent.press(getByText('Finalizar Entrenamiento'));
    expect(getByText('Marcá al menos un ejercicio para finalizar el entrenamiento.')).toBeTruthy();

    fireEvent.press(getByLabelText('Marcar Sentadilla como completado'));
    fireEvent.press(getByText('Finalizar Entrenamiento'));
    await waitFor(() => expect(m.finalizarEntrenamiento).toHaveBeenCalledTimes(1));
  });
});

describe('formatos de fecha/hora del historial', () => {
  it('fecha: "Sábado 26 de septiembre", con año solo si no es el año en curso', () => {
    const hoy = new Date('2026-09-27T15:00:00Z');
    expect(formatFechaHistorial('2026-09-26', hoy)).toBe('Sábado 26 de septiembre');
    expect(formatFechaHistorial('2026-09-21', hoy)).toBe('Lunes 21 de septiembre');
    expect(formatFechaHistorial('2025-12-31', hoy)).toBe('Miércoles 31 de diciembre de 2025');
  });

  it('hora: siempre en horario de Argentina (UTC-3), formato 24 hs', () => {
    expect(formatHoraArgentina('2026-09-26T21:30:00Z')).toBe('18:30');
    expect(formatHoraArgentina('2026-09-26T02:05:00Z')).toBe('23:05');
  });
});
