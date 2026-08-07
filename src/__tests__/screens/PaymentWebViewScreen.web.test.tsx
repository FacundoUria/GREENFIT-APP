import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// A propósito, NO hay ningún jest.mock('react-native-webview', ...) acá --
// PaymentWebViewScreen.web.tsx no debe importarlo bajo ninguna
// circunstancia (bug crítico 2026-08-07: "React Native WebView does not
// support this platform"). Si alguien reintroduce ese import ahí, este
// archivo reventaría al requerir el módulo real, exactamente el mismo
// síntoma que el bug original -- es la protección más directa posible.

const mockCreatePaymentPreference = jest.fn();
jest.mock('../../lib/paymentsApi', () => ({
  createPaymentPreference: (...args: unknown[]) => mockCreatePaymentPreference(...args),
}));

// Import explícito por archivo -- se prueba la variante WEB puntual, sin
// depender de qué plataforma haya elegido el resolver de Jest para un
// import sin sufijo.
import PaymentWebViewScreen from '../../screens/PaymentWebViewScreen.web';

const navigation = { goBack: jest.fn() };

describe('PaymentWebViewScreen.web -- redirección de página completa (sin WebView)', () => {
  const originalWindow = (global as any).window;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    (global as any).window = originalWindow;
  });

  it('con initPoint, redirige la pestaña entera (window.location.href) mientras muestra un loader', () => {
    (global as any).window = { location: { href: '' } };

    const { getByText } = render(
      <PaymentWebViewScreen route={{ params: { initPoint: 'https://mp.test/checkout' } }} navigation={navigation} />
    );

    expect((global as any).window.location.href).toBe('https://mp.test/checkout');
    expect(getByText('Redirigiendo a Mercado Pago...')).toBeTruthy();
  });

  it('sin initPoint, muestra el estado de error sin reventar', () => {
    (global as any).window = { location: { href: '' } };

    const { getByText } = render(<PaymentWebViewScreen route={{ params: {} }} navigation={navigation} />);
    expect(() => getByText('Redirigiendo a Mercado Pago...')).toThrow();
    expect((global as any).window.location.href).toBe('');
  });

  it('con webResultado ya resuelto (HomeScreen lo detectó al volver), muestra la tarjeta de resultado directo -- sin redirigir', () => {
    (global as any).window = { location: { href: '' } };

    const { getByText } = render(
      <PaymentWebViewScreen route={{ params: { webResultado: 'approved' } }} navigation={navigation} />
    );

    expect(getByText('¡Pago acreditado!')).toBeTruthy();
    expect((global as any).window.location.href).toBe(''); // no redirigió a ningún lado
  });

  it('webResultado="pending" muestra EXACTO el texto pedido para verificación', () => {
    (global as any).window = { location: { href: '' } };

    const { getByText } = render(
      <PaymentWebViewScreen route={{ params: { webResultado: 'pending' } }} navigation={navigation} />
    );

    expect(getByText('Pago en revisión')).toBeTruthy();
    expect(
      getByText('Tu pago está en proceso de verificación. Apenas se acredite verás tus créditos sumados.')
    ).toBeTruthy();
  });

  it('webResultado="failure" ofrece Reintentar, que genera una preferencia nueva y redirige de nuevo', async () => {
    (global as any).window = { location: { href: '' } };
    mockCreatePaymentPreference.mockResolvedValue({ initPoint: 'https://mp.test/checkout-nuevo', preferenceId: 'pref-2' });

    const { getByText } = render(
      <PaymentWebViewScreen
        route={{ params: { webResultado: 'failure', packId: 'pack-1', userId: 'user-1' } }}
        navigation={navigation}
      />
    );
    expect(getByText('Reintentar')).toBeTruthy();
    expect(getByText('Cancelar')).toBeTruthy();

    fireEvent.press(getByText('Reintentar'));

    await waitFor(() => expect(mockCreatePaymentPreference).toHaveBeenCalledWith({ packId: 'pack-1', userId: 'user-1' }));
    await waitFor(() => expect((global as any).window.location.href).toBe('https://mp.test/checkout-nuevo'));
  });

  it('sin packId/userId disponibles (deep link viejo), "Reintentar" simplemente vuelve atrás sin generar nada', () => {
    (global as any).window = { location: { href: '' } };

    const { getByText } = render(
      <PaymentWebViewScreen route={{ params: { webResultado: 'failure' } }} navigation={navigation} />
    );

    fireEvent.press(getByText('Reintentar'));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(mockCreatePaymentPreference).not.toHaveBeenCalled();
  });

  it('"Listo" vuelve atrás', () => {
    (global as any).window = { location: { href: '' } };

    const { getByText } = render(
      <PaymentWebViewScreen route={{ params: { webResultado: 'approved' } }} navigation={navigation} />
    );
    fireEvent.press(getByText('Listo'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
