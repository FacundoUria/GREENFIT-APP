import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import HoyEntreneButton from '../../components/HoyEntreneButton';
import * as xpApi from '../../lib/xpApi';

jest.mock('../../lib/xpApi', () => ({
  checkXpDisponible: jest.fn(),
  fetchAsistenciaHoyRegistrada: jest.fn(),
  otorgarXpAsistenciaDiaria: jest.fn(),
}));

const mockedCheck = xpApi.checkXpDisponible as jest.Mock;
const mockedFetch = xpApi.fetchAsistenciaHoyRegistrada as jest.Mock;
const mockedOtorgar = xpApi.otorgarXpAsistenciaDiaria as jest.Mock;

const MENSAJE_YA_REGISTRADO = /ya fueron otorgados/;

describe('HoyEntreneButton (botón universal del Dashboard -- +100 XP diario)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('muestra el estado habilitado cuando todavía no se registró hoy', async () => {
    mockedCheck.mockResolvedValue(true);
    mockedFetch.mockResolvedValue(false);
    const { getByText } = render(<HoyEntreneButton userId="user-1" />);
    await waitFor(() => expect(getByText('¡Hoy entrené! (+100 XP)')).toBeTruthy());
  });

  it('al tocarlo, otorga +100 XP, pasa al estado "registrado" y llama a onClaimed (update optimista del contador)', async () => {
    mockedCheck.mockResolvedValue(true);
    mockedFetch.mockResolvedValue(false);
    mockedOtorgar.mockResolvedValue('otorgado');
    const onClaimed = jest.fn();
    const { getByText, queryByText } = render(<HoyEntreneButton userId="user-1" onClaimed={onClaimed} />);
    const boton = await waitFor(() => getByText('¡Hoy entrené! (+100 XP)'));

    fireEvent.press(boton);

    await waitFor(() => expect(getByText('Entrenamiento de hoy ya registrado')).toBeTruthy());
    expect(mockedOtorgar).toHaveBeenCalledWith('user-1', false);
    expect(queryByText('¡Hoy entrené! (+100 XP)')).toBeNull();
    expect(onClaimed).toHaveBeenCalledTimes(1);
    expect(queryByText(MENSAJE_YA_REGISTRADO)).toBeNull();

    // El botón sigue siendo tocable (no está `disabled`) a propósito -- un
    // segundo tap debe avisar (toast inline, no Alert.alert -- ver
    // comentario del componente: Alert.alert es un no-op mudo en
    // react-native-web) en vez de quedar mudo, y no debe volver a pegarle
    // al servidor ni volver a sumar XP.
    fireEvent.press(getByText('Entrenamiento de hoy ya registrado'));
    expect(mockedOtorgar).toHaveBeenCalledTimes(1);
    expect(onClaimed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByText(MENSAJE_YA_REGISTRADO)).toBeTruthy());
  });

  it('si ya estaba registrado al cargar la pantalla, arranca directo en el estado deshabilitado y avisa (toast) si se lo toca', async () => {
    mockedCheck.mockResolvedValue(true);
    mockedFetch.mockResolvedValue(true);
    const onClaimed = jest.fn();
    const { getByText } = render(<HoyEntreneButton userId="user-1" onClaimed={onClaimed} />);
    const boton = await waitFor(() => getByText('Entrenamiento de hoy ya registrado'));
    expect(mockedOtorgar).not.toHaveBeenCalled();

    fireEvent.press(boton);

    expect(mockedOtorgar).not.toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
    await waitFor(() => expect(getByText(MENSAJE_YA_REGISTRADO)).toBeTruthy());
  });

  it('si el servidor responde "ya_registrado_hoy" (carrera con una clase confirmada por el admin), muestra el toast y NO llama a onClaimed', async () => {
    mockedCheck.mockResolvedValue(true);
    mockedFetch.mockResolvedValue(false);
    mockedOtorgar.mockResolvedValue('ya_registrado_hoy');
    const onClaimed = jest.fn();
    const { getByText } = render(<HoyEntreneButton userId="user-1" onClaimed={onClaimed} />);
    const boton = await waitFor(() => getByText('¡Hoy entrené! (+100 XP)'));

    fireEvent.press(boton);

    await waitFor(() => expect(getByText('Entrenamiento de hoy ya registrado')).toBeTruthy());
    expect(onClaimed).not.toHaveBeenCalled();
    await waitFor(() => expect(getByText(MENSAJE_YA_REGISTRADO)).toBeTruthy());
  });

  it('en modo demo (xp_events sin desplegar) igual permite registrar localmente', async () => {
    mockedCheck.mockResolvedValue(false);
    mockedFetch.mockResolvedValue(false);
    mockedOtorgar.mockResolvedValue('otorgado');
    const { getByText } = render(<HoyEntreneButton userId="user-1" />);
    const boton = await waitFor(() => getByText('¡Hoy entrené! (+100 XP)'));

    fireEvent.press(boton);

    await waitFor(() => expect(mockedOtorgar).toHaveBeenCalledWith('user-1', true));
  });
});
