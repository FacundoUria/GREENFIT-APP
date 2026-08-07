import { resolvePaymentResultFromUrl } from '../../lib/paymentResult';

describe('resolvePaymentResultFromUrl -- compartido entre el WebView nativo y la vuelta Web de Mercado Pago', () => {
  it('detecta aprobado por status= o collection_status=', () => {
    expect(resolvePaymentResultFromUrl('https://mp.test/return?status=approved')).toBe('approved');
    expect(resolvePaymentResultFromUrl('https://app.greenfit.test/?collection_status=approved&payment_id=1')).toBe('approved');
  });

  it('detecta rechazado por status= o collection_status=', () => {
    expect(resolvePaymentResultFromUrl('https://mp.test/return?status=rejected')).toBe('failure');
    expect(resolvePaymentResultFromUrl('https://app.greenfit.test/?collection_status=rejected')).toBe('failure');
  });

  it('detecta pendiente por status= o collection_status=in_process', () => {
    expect(resolvePaymentResultFromUrl('https://mp.test/return?status=pending')).toBe('pending');
    expect(resolvePaymentResultFromUrl('https://app.greenfit.test/?collection_status=in_process')).toBe('pending');
  });

  it('detecta el custom scheme usado en nativo', () => {
    expect(resolvePaymentResultFromUrl('greenfit://payment-success')).toBe('approved');
    expect(resolvePaymentResultFromUrl('greenfit://payment-failure')).toBe('failure');
    expect(resolvePaymentResultFromUrl('greenfit://payment-pending')).toBe('pending');
  });

  it('una URL sin ningún marcador (ej. la propia página de checkout todavía cargando) devuelve null', () => {
    expect(resolvePaymentResultFromUrl('https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123')).toBeNull();
  });

  it('null/undefined/vacío devuelve null sin romper', () => {
    expect(resolvePaymentResultFromUrl(null)).toBeNull();
    expect(resolvePaymentResultFromUrl(undefined)).toBeNull();
    expect(resolvePaymentResultFromUrl('')).toBeNull();
  });
});
