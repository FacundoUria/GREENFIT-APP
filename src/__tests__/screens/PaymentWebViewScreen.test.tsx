import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// WebView es un componente nativo real -- se mockea por un stub inspeccionable
// que expone sus props (onShouldStartLoadWithRequest/onNavigationStateChange)
// para poder simular la navegación del checkout sin un WebView de verdad.
jest.mock('react-native-webview', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    WebView: (props: any) => ReactActual.createElement(View, { testID: 'mock-webview', ...props }),
  };
});

const mockCreatePaymentPreference = jest.fn();
jest.mock('../../lib/paymentsApi', () => ({
  createPaymentPreference: (...args: unknown[]) => mockCreatePaymentPreference(...args),
}));

import PaymentWebViewScreen from '../../screens/PaymentWebViewScreen';

const navigation = { goBack: jest.fn() };

function simularNavegacion(getByTestId: (id: string) => any, url: string) {
  const webview = getByTestId('mock-webview');
  act(() => {
    webview.props.onNavigationStateChange({ url });
  });
}

describe('PaymentWebViewScreen -- resultado del checkout de Mercado Pago', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin initPoint, muestra el estado de error sin reventar', () => {
    const { getByTestId } = render(<PaymentWebViewScreen route={{ params: {} }} navigation={navigation} />);
    expect(() => getByTestId('mock-webview')).toThrow();
  });

  it('detecta un pago aprobado (status=approved) y muestra la tarjeta de éxito', () => {
    const { getByTestId, getByText } = render(
      <PaymentWebViewScreen route={{ params: { initPoint: 'https://mp.test/checkout' } }} navigation={navigation} />
    );
    simularNavegacion(getByTestId, 'https://mp.test/return?status=approved');

    expect(getByText('¡Pago acreditado!')).toBeTruthy();
    expect(getByText(/Ya podés ver tus créditos actualizados/)).toBeTruthy();
  });

  it('detecta un pago pendiente y muestra EXACTO el texto pedido para verificación', () => {
    const { getByTestId, getByText } = render(
      <PaymentWebViewScreen route={{ params: { initPoint: 'https://mp.test/checkout' } }} navigation={navigation} />
    );
    simularNavegacion(getByTestId, 'https://mp.test/return?collection_status=in_process');

    expect(getByText('Pago en revisión')).toBeTruthy();
    expect(
      getByText('Tu pago está en proceso de verificación. Apenas se acredite verás tus créditos sumados.')
    ).toBeTruthy();
  });

  it('detecta un pago rechazado y ofrece Reintentar (no solo Cerrar)', () => {
    const { getByTestId, getByText } = render(
      <PaymentWebViewScreen route={{ params: { initPoint: 'https://mp.test/checkout' } }} navigation={navigation} />
    );
    simularNavegacion(getByTestId, 'https://mp.test/return?status=rejected');

    expect(getByText('No se pudo procesar el pago')).toBeTruthy();
    expect(getByText('Reintentar')).toBeTruthy();
    expect(getByText('Cancelar')).toBeTruthy();
  });

  it('"Reintentar" genera una preferencia NUEVA y vuelve a mostrar el WebView, sin salir de la pantalla', async () => {
    mockCreatePaymentPreference.mockResolvedValue({ initPoint: 'https://mp.test/checkout-nuevo', preferenceId: 'pref-2' });

    const { getByTestId, getByText, queryByText } = render(
      <PaymentWebViewScreen
        route={{ params: { initPoint: 'https://mp.test/checkout', packId: 'pack-1', userId: 'user-1' } }}
        navigation={navigation}
      />
    );
    simularNavegacion(getByTestId, 'https://mp.test/return?status=rejected');
    expect(getByText('Reintentar')).toBeTruthy();

    fireEvent.press(getByText('Reintentar'));

    await waitFor(() => expect(mockCreatePaymentPreference).toHaveBeenCalledWith({ packId: 'pack-1', userId: 'user-1' }));
    // Volvió a mostrar el WebView (con la preferencia nueva) en vez de quedarse en la tarjeta de error.
    await waitFor(() => expect(queryByText('No se pudo procesar el pago')).toBeNull());
    expect(getByTestId('mock-webview').props.source.uri).toBe('https://mp.test/checkout-nuevo');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('sin packId/userId disponibles (deep link viejo), "Reintentar" simplemente vuelve atrás', () => {
    const { getByTestId, getByText } = render(
      <PaymentWebViewScreen route={{ params: { initPoint: 'https://mp.test/checkout' } }} navigation={navigation} />
    );
    simularNavegacion(getByTestId, 'https://mp.test/return?status=rejected');

    fireEvent.press(getByText('Reintentar'));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(mockCreatePaymentPreference).not.toHaveBeenCalled();
  });

  it('"Listo"/"Cancelar" vuelve atrás', () => {
    const { getByTestId, getByText } = render(
      <PaymentWebViewScreen route={{ params: { initPoint: 'https://mp.test/checkout' } }} navigation={navigation} />
    );
    simularNavegacion(getByTestId, 'https://mp.test/return?status=approved');
    fireEvent.press(getByText('Listo'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
