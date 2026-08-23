import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../lib/xpApi', () => ({ registrarHoyEntrene: jest.fn() }));

import { registrarHoyEntrene } from '../../lib/xpApi';
import HoyEntreneButton from '../../components/HoyEntreneButton';

const mockedRegistrar = registrarHoyEntrene as jest.Mock;

describe('HoyEntreneButton (autoreporte de XP con tope diario = disciplinas activas)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin ninguna disciplina activa, no renderiza nada (no hay ningún entrenamiento que registrar)', () => {
    const { toJSON } = render(
      <HoyEntreneButton disciplinasActivas={0} entrenamientosHoy={0} onRegistrado={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  it('con cupo disponible, muestra el botón activo', () => {
    const { getByText } = render(
      <HoyEntreneButton disciplinasActivas={1} entrenamientosHoy={0} onRegistrado={jest.fn()} />
    );
    expect(getByText('💪 Hoy Entrené')).toBeTruthy();
  });

  it('ya usado todas las veces posibles (entrenamientosHoy = disciplinasActivas), muestra el botón deshabilitado con el mensaje de tope', () => {
    const { getByText, queryByText } = render(
      <HoyEntreneButton disciplinasActivas={1} entrenamientosHoy={1} onRegistrado={jest.fn()} />
    );
    expect(getByText('Ya registraste todos tus entrenamientos de hoy')).toBeTruthy();
    expect(queryByText('💪 Hoy Entrené')).toBeNull();
  });

  it('al tocarlo y el RPC otorga los 100 XP, avisa cuántos entrenamientos quedan y notifica al padre', async () => {
    mockedRegistrar.mockResolvedValue({ otorgado: true, xpOtorgado: 100, entrenamientosHoy: 1, entrenamientosMaximos: 2 });
    const onRegistrado = jest.fn();

    const { getByText } = render(
      <HoyEntreneButton disciplinasActivas={2} entrenamientosHoy={0} onRegistrado={onRegistrado} />
    );
    fireEvent.press(getByText('💪 Hoy Entrené'));

    await waitFor(() => expect(getByText('¡Bien! Te queda 1 entrenamiento disponible hoy')).toBeTruthy());
    expect(onRegistrado).toHaveBeenCalledWith(100, 1);
  });

  it('al tocar el último disponible, el feedback usa singular correctamente y avisa 0 disponibles', async () => {
    mockedRegistrar.mockResolvedValue({ otorgado: true, xpOtorgado: 100, entrenamientosHoy: 1, entrenamientosMaximos: 1 });
    const { getByText } = render(
      <HoyEntreneButton disciplinasActivas={1} entrenamientosHoy={0} onRegistrado={jest.fn()} />
    );
    fireEvent.press(getByText('💪 Hoy Entrené'));

    await waitFor(() => expect(getByText('¡Bien! Ya registraste todos tus entrenamientos de hoy')).toBeTruthy());
  });

  it('si el RPC responde otorgado=false (el servidor detectó que ya no hay cupo), avisa sin sumar XP', async () => {
    mockedRegistrar.mockResolvedValue({ otorgado: false, xpOtorgado: 0, entrenamientosHoy: 1, entrenamientosMaximos: 1 });
    const onRegistrado = jest.fn();
    const { getByText } = render(
      <HoyEntreneButton disciplinasActivas={1} entrenamientosHoy={0} onRegistrado={onRegistrado} />
    );
    fireEvent.press(getByText('💪 Hoy Entrené'));

    await waitFor(() => expect(getByText('Ya registraste todos tus entrenamientos de hoy')).toBeTruthy());
    expect(onRegistrado).toHaveBeenCalledWith(0, 1);
  });

  it('si el RPC tira (ej. sin sesión), muestra el mensaje de error real como feedback', async () => {
    mockedRegistrar.mockRejectedValue(new Error('No autenticado'));
    const { getByText } = render(
      <HoyEntreneButton disciplinasActivas={1} entrenamientosHoy={0} onRegistrado={jest.fn()} />
    );
    fireEvent.press(getByText('💪 Hoy Entrené'));

    await waitFor(() => expect(getByText('No autenticado')).toBeTruthy());
  });
});
