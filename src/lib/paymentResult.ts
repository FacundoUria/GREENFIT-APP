// Compartido entre PaymentWebViewScreen (WebView nativo) y HomeScreen (vuelta
// de la redirección Web -- ver Platform.OS === 'web' en PaymentWebViewScreen)
// para no duplicar la lógica de "qué URL significa qué resultado".
export type ResultadoPago = 'approved' | 'pending' | 'failure' | null;

// Cubre tanto el custom scheme que arma la Edge Function para nativo
// (greenfit://payment-..., interceptado por el WebView antes de navegar de
// verdad) como los query params que Mercado Pago agrega a sus propias
// páginas de resultado (status / collection_status) -- en Web, el back_url
// es el origin real de la PWA (ver resolveBackUrls en
// supabase/functions/_shared/mercadopago.ts), así que la vuelta llega con
// esos mismos query params pegados ahí.
const SUCCESS_MARKERS = ['greenfit://payment-success', 'status=approved', 'collection_status=approved'];
const FAILURE_MARKERS = ['greenfit://payment-failure', 'status=rejected', 'collection_status=rejected'];
const PENDING_MARKERS = ['greenfit://payment-pending', 'status=pending', 'collection_status=in_process'];

function matchesAny(url: string, markers: string[]): boolean {
  return markers.some((marker) => url.includes(marker));
}

export function resolvePaymentResultFromUrl(url: string | null | undefined): ResultadoPago {
  if (!url) return null;
  if (matchesAny(url, SUCCESS_MARKERS)) return 'approved';
  if (matchesAny(url, FAILURE_MARKERS)) return 'failure';
  if (matchesAny(url, PENDING_MARKERS)) return 'pending';
  return null;
}
