import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'socio-1', name: 'Facundo Uria' } }),
}));
jest.mock('../../context/ConfiguracionContext', () => ({
  useConfiguracion: () => ({
    configuracion: { aliasCvu: 'greenfit.transferencias', titularCuenta: 'Sebastián Green' },
  }),
}));
jest.mock('../../lib/crossPlatformAlert', () => ({ showAlert: jest.fn() }));
jest.mock('../../lib/clipboard', () => ({ copyToClipboard: jest.fn() }));
jest.mock('../../lib/comprobanteApi', () => ({
  subirComprobantePago: jest.fn(),
  crearPagoPendiente: jest.fn(),
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/camara.jpg' }] }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/galeria.jpg' }] }),
}));

import * as ImagePicker from 'expo-image-picker';
import { showAlert } from '../../lib/crossPlatformAlert';
import { copyToClipboard } from '../../lib/clipboard';
import { subirComprobantePago, crearPagoPendiente } from '../../lib/comprobanteApi';
import TransferReceiptScreen from '../../screens/user/TransferReceiptScreen';

const route = { params: { packId: 'pack-1', packName: 'Combo 8+8', monto: 15000 } };

function renderScreen(navigationOverrides: Partial<{ navigate: jest.Mock; goBack: jest.Mock }> = {}) {
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), ...navigationOverrides };
  const utils = render(<TransferReceiptScreen navigation={navigation} route={route} />);
  return { ...utils, navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TransferReceiptScreen (pago por transferencia con comprobante -- Fase 2)', () => {
  it('muestra el pack, el monto y los datos reales de transferencia (alias/titular de configuracion)', () => {
    const { getByText } = renderScreen();
    expect(getByText('Combo 8+8')).toBeTruthy();
    expect(getByText('greenfit.transferencias')).toBeTruthy();
    expect(getByText('Sebastián Green')).toBeTruthy();
  });

  it('copiar el alias: llama a copyToClipboard y muestra el feedback visual "¡Copiado!"', async () => {
    (copyToClipboard as jest.Mock).mockResolvedValue(true);
    const { getByText } = renderScreen();

    fireEvent.press(getByText('Copiar'));

    await waitFor(() => expect(getByText('¡Copiado!')).toBeTruthy());
    expect(copyToClipboard).toHaveBeenCalledWith('greenfit.transferencias');
  });

  it('si el navegador no puede copiar (copyToClipboard devuelve false), avisa en vez de fingir éxito', async () => {
    (copyToClipboard as jest.Mock).mockResolvedValue(false);
    const { getByText, queryByText } = renderScreen();

    fireEvent.press(getByText('Copiar'));

    await waitFor(() => expect(showAlert).toHaveBeenCalledWith('No se pudo copiar', expect.any(String)));
    expect(queryByText('¡Copiado!')).toBeNull();
  });

  it('sin ninguna foto elegida, "Enviar comprobante" está deshabilitado (no dispara la subida al tocarlo)', () => {
    const { getByText } = renderScreen();

    fireEvent.press(getByText('Enviar comprobante'));

    expect(subirComprobantePago).not.toHaveBeenCalled();
  });

  it('elegir de galería carga la preview y habilita "Enviar comprobante"', async () => {
    (subirComprobantePago as jest.Mock).mockResolvedValue('socio-1/123.jpg');
    (crearPagoPendiente as jest.Mock).mockResolvedValue('pago-1');
    const { getByText } = renderScreen();

    fireEvent.press(getByText('Elegir de galería'));
    await waitFor(() => expect(getByText('Cambiar foto')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Enviar comprobante'));
    });
    expect(subirComprobantePago).toHaveBeenCalled();
  });

  it('sacar foto con la cámara también carga la preview', async () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Sacar foto'));
    await waitFor(() => expect(getByText('Cambiar foto')).toBeTruthy());
  });

  it('sin permiso de cámara, avisa y no rompe (no abre ningún picker)', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });

    const { getByText, queryByText } = renderScreen();
    fireEvent.press(getByText('Sacar foto'));

    await waitFor(() => expect(showAlert).toHaveBeenCalledWith('Permiso necesario', expect.any(String)));
    expect(queryByText('Cambiar foto')).toBeNull();
  });

  it('envío exitoso: sube el comprobante, lo acredita automático (Fase 3, ya no queda "pendiente"), confirma SIN prometer un tiempo, y vuelve atrás', async () => {
    (subirComprobantePago as jest.Mock).mockResolvedValue('socio-1/123.jpg');
    (crearPagoPendiente as jest.Mock).mockResolvedValue('pago-1');

    const { getByText, navigation } = renderScreen();
    fireEvent.press(getByText('Elegir de galería'));
    await waitFor(() => expect(getByText('Cambiar foto')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Enviar comprobante'));
    });

    expect(subirComprobantePago).toHaveBeenCalledWith('socio-1', 'file:///tmp/galeria.jpg');
    expect(crearPagoPendiente).toHaveBeenCalledWith({
      packId: 'pack-1',
      comprobantePath: 'socio-1/123.jpg',
      monto: 15000,
    });

    await waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith(
        '¡Comprobante recibido!',
        'Ya acreditamos tu pago -- revisá tu saldo actualizado en Inicio.'
      )
    );
    // Ninguna de las dos llamadas de showAlert de este flujo promete un
    // plazo concreto -- pedido explícito del ticket.
    const mensajes = (showAlert as jest.Mock).mock.calls.map((c) => `${c[0]} ${c[1] ?? ''}`).join(' ');
    expect(mensajes).not.toMatch(/\d+\s*(hora|día|minuto)/i);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  // Criterio "spinner infinito" -- si la subida o el RPC fallan, el error
  // tiene que ser VISIBLE (showAlert) y el botón tiene que volver a estar
  // disponible, nunca quedar trabado en "Enviando...".
  it('envío fallido: muestra el error de forma visible y el botón vuelve a estar disponible (no queda colgado)', async () => {
    (subirComprobantePago as jest.Mock).mockRejectedValue(new Error('La operación tardó demasiado.'));

    const { getByText, queryByText } = renderScreen();
    fireEvent.press(getByText('Elegir de galería'));
    await waitFor(() => expect(getByText('Cambiar foto')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Enviar comprobante'));
    });

    await waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith('No se pudo enviar el comprobante', 'La operación tardó demasiado.')
    );
    expect(crearPagoPendiente).not.toHaveBeenCalled();
    // El botón sigue en pantalla con su texto normal -- no quedó un
    // spinner infinito ni la pantalla se trabó.
    expect(queryByText('Enviar comprobante')).toBeTruthy();
    expect(getByText('Enviar comprobante')).toBeTruthy();
  });
});
