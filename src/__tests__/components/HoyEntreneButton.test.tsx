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

  it('al tocarlo, otorga +100 XP y pasa al estado "registrado" (deshabilitado)', async () => {
    mockedCheck.mockResolvedValue(true);
    mockedFetch.mockResolvedValue(false);
    mockedOtorgar.mockResolvedValue('otorgado');
    const { getByText, queryByText } = render(<HoyEntreneButton userId="user-1" />);
    const boton = await waitFor(() => getByText('¡Hoy entrené! (+100 XP)'));

    fireEvent.press(boton);

    await waitFor(() => expect(getByText('¡Entrenamiento de hoy registrado! +100 XP')).toBeTruthy());
    expect(mockedOtorgar).toHaveBeenCalledWith('user-1', false);
    expect(queryByText('¡Hoy entrené! (+100 XP)')).toBeNull();

    // Deshabilitado: un segundo tap (ya no hay texto para tocar de nuevo,
    // pero confirmamos que no se disparó una segunda acreditación).
    expect(mockedOtorgar).toHaveBeenCalledTimes(1);
  });

  it('si ya estaba registrado al cargar la pantalla, arranca directo en el estado deshabilitado', async () => {
    mockedCheck.mockResolvedValue(true);
    mockedFetch.mockResolvedValue(true);
    const { getByText } = render(<HoyEntreneButton userId="user-1" />);
    await waitFor(() => expect(getByText('¡Entrenamiento de hoy registrado! +100 XP')).toBeTruthy());
    expect(mockedOtorgar).not.toHaveBeenCalled();
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
