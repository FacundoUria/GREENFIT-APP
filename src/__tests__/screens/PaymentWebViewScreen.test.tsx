import React from 'react';
import { Platform } from 'react-native';
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

// Bug crítico (2026-08-07): "React Native WebView does not support this
// platform" -- en Web no se debe renderizar react-native-webview en
// absoluto, la redirección al Checkout Pro es de página completa.
describe('PaymentWebViewScreen -- Web/PWA (react-native-webview no soporta este entorno)', () => {
  const originalWindow = (global as any).window;
  const originalPlatformOS = Platform.OS;

  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    (global as any).window = originalWindow;
    Platform.OS = originalPlatformOS;
  });

  it('con initPoint, NO renderiza el WebView y redirige la pestaña entera (window.location.href)', () => {
    Platform.OS = 'web';
    (global as any).window = { location: { href: '' } };

    const { queryByTestId, getByText } = render(
      <PaymentWebViewScreen route={{ params: { initPoint: 'https://mp.test/checkout' } }} navigation={navigation} />
    );

    expect(queryByTestId('mock-webview')).toBeNull();
    expect((global as any).window.location.href).toBe('https://mp.test/checkout');
    expect(getByText('Redirigiendo a Mercado Pago...')).toBeTruthy();
  });

  it('con webResultado ya resuelto (HomeScreen lo detectó al volver), muestra la tarjeta de resultado directo -- sin WebView ni redirección', () => {
    Platform.OS = 'web';
    (global as any).window = { location: { href: '' } };

    const { queryByTestId, getByText } = render(
      <PaymentWebViewScreen route={{ params: { webResultado: 'approved' } }} navigation={navigation} />
    );

    expect(queryByTestId('mock-webview')).toBeNull();
    expect(getByText('¡Pago acreditado!')).toBeTruthy();
    expect((global as any).window.location.href).toBe(''); // no redirigió a ningún lado
  });

  it('"Reintentar" en Web genera una preferencia nueva y redirige de nuevo -- sin recargar ningún WebView', async () => {
    Platform.OS = 'web';
    (global as any).window = { location: { href: '' } };
    mockCreatePaymentPreference.mockResolvedValue({ initPoint: 'https://mp.test/checkout-nuevo', preferenceId: 'pref-2' });

    const { getByText } = render(
      <PaymentWebViewScreen
        route={{ params: { webResultado: 'failure', packId: 'pack-1', userId: 'user-1' } }}
        navigation={navigation}
      />
    );
    expect(getByText('Reintentar')).toBeTruthy();

    fireEvent.press(getByText('Reintentar'));

    await waitFor(() => expect(mockCreatePaymentPreference).toHaveBeenCalledWith({ packId: 'pack-1', userId: 'user-1' }));
    await waitFor(() => expect((global as any).window.location.href).toBe('https://mp.test/checkout-nuevo'));
  });
});
