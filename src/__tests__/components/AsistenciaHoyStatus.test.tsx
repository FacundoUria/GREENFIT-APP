import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsistenciaHoyStatus from '../../components/AsistenciaHoyStatus';
import * as xpApi from '../../lib/xpApi';

jest.mock('../../lib/xpApi', () => ({
  fetchAsistenciaHoyRegistrada: jest.fn(),
}));

const mockedFetch = xpApi.fetchAsistenciaHoyRegistrada as jest.Mock;

// Reemplaza a HoyEntreneButton -- ya no es un botón de autoreporte, es un
// estado de SOLO LECTURA: los +100 XP diarios solo los acredita el Admin.
describe('AsistenciaHoyStatus (solo lectura -- ya no hay autoreporte del socio)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('muestra el estado neutro (no acreditado) cuando el Admin todavía no dio el check-in de hoy', async () => {
    mockedFetch.mockResolvedValue(false);
    const { getByText } = render(<AsistenciaHoyStatus userId="user-1" />);
    await waitFor(() => expect(getByText('Esperando check-in en el gimnasio...')).toBeTruthy());
  });

  it('muestra el estado en verde cuando el Admin ya acreditó la asistencia de hoy', async () => {
    mockedFetch.mockResolvedValue(true);
    const { getByText } = render(<AsistenciaHoyStatus userId="user-1" />);
    await waitFor(() => expect(getByText('¡Seba registró tu asistencia! Sumaste +100 XP hoy')).toBeTruthy());
  });

  it('no tiene ninguna acción tocable -- tocar el estado no dispara ningún otorgamiento de XP', async () => {
    mockedFetch.mockResolvedValue(false);
    const { getByText, getByLabelText } = render(<AsistenciaHoyStatus userId="user-1" />);
    await waitFor(() => expect(getByText('Esperando check-in en el gimnasio...')).toBeTruthy());

    // Es un <View>, no un <TouchableOpacity> -- fireEvent.press no debería
    // ni encontrar un handler que ejecutar. Confirmamos que fetch (la única
    // llamada real a la red) se llamó UNA sola vez (la carga inicial), sin
    // que "tocar" el elemento dispare una segunda petición.
    fireEvent.press(getByLabelText('Esperando check-in en el gimnasio...'));
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('se pide una sola vez por userId, sin reintentos silenciosos', async () => {
    mockedFetch.mockResolvedValue(true);
    render(<AsistenciaHoyStatus userId="user-42" />);
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('user-42'));
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
