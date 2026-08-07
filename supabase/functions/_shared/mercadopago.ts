// Helpers de Mercado Pago compartidos entre create-payment-preference y
// mp-webhook -- separados del `serve()` de cada función a propósito para
// que la parte que arma/interpreta datos (sin tocar red) se pueda testear
// con Jest en el resto del repo (Deno no corre en esa suite, pero estas
// funciones son TS puro, sin imports de Deno, así que sí).

export interface PackParaPreferencia {
  id: string;
  name: string;
  price: number;
  credits: number | null;
  durationDays: number | null;
  disciplineId: string;
}

export interface ExternalReference {
  user_id: string;
  pack_id: string;
  discipline_id: string;
  credits: number | null;
  duration_days: number | null;
}

export interface MpPreferenceRequest {
  items: { title: string; quantity: number; unit_price: number; currency_id: string }[];
  external_reference: string;
  back_urls: { success: string; pending: string; failure: string };
  auto_return: string;
  notification_url: string;
}

// URLs de esquema custom que ya intercepta PaymentWebViewScreen.tsx (ver
// SUCCESS_MARKERS/PENDING_MARKERS/FAILURE_MARKERS ahí) -- MP nunca llega a
// "navegar" de verdad a estas, el WebView las corta antes.
export const MP_BACK_URLS = {
  success: 'greenfit://payment-success',
  pending: 'greenfit://payment-pending',
  failure: 'greenfit://payment-failure',
};

// El precio/cantidad de créditos/días SIEMPRE salen del pack real leído de
// la base (nunca de lo que mande el cliente) -- esto es lo único que se usa
// para armar la preferencia. `external_reference` viaja server-verificado:
// el webhook no necesita (ni debe) confiar en nada que el cliente haya
// mandado en el momento de comprar.
export function buildPreferenceRequest(params: {
  pack: PackParaPreferencia;
  userId: string;
  notificationUrl: string;
}): MpPreferenceRequest {
  const { pack, userId, notificationUrl } = params;
  const externalReference: ExternalReference = {
    user_id: userId,
    pack_id: pack.id,
    discipline_id: pack.disciplineId,
    credits: pack.credits,
    duration_days: pack.durationDays,
  };

  return {
    items: [{ title: pack.name, quantity: 1, unit_price: pack.price, currency_id: 'ARS' }],
    external_reference: JSON.stringify(externalReference),
    back_urls: MP_BACK_URLS,
    auto_return: 'approved',
    notification_url: notificationUrl,
  };
}

// Parseo defensivo de external_reference -- si viniera corrupto/ajeno
// (nunca debería, lo generamos nosotros mismos), el webhook lo descarta en
// vez de reventar o, peor, acreditarle algo a cualquiera.
export function parseExternalReference(raw: string | null | undefined): ExternalReference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.user_id !== 'string' || typeof parsed?.pack_id !== 'string' || typeof parsed?.discipline_id !== 'string') {
      return null;
    }
    return {
      user_id: parsed.user_id,
      pack_id: parsed.pack_id,
      discipline_id: parsed.discipline_id,
      credits: typeof parsed.credits === 'number' ? parsed.credits : null,
      duration_days: typeof parsed.duration_days === 'number' ? parsed.duration_days : null,
    };
  } catch {
    return null;
  }
}

export interface MpPayment {
  id: number | string;
  status: string;
  transaction_amount: number;
  external_reference: string | null;
}

export async function createMpPreference(
  accessToken: string,
  body: MpPreferenceRequest
): Promise<{ id: string; initPoint: string }> {
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message ?? `Mercado Pago respondió ${res.status} al crear la preferencia.`);
  }
  return { id: data.id, initPoint: data.init_point };
}

export async function fetchMpPayment(accessToken: string, paymentId: string): Promise<MpPayment> {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message ?? `Mercado Pago respondió ${res.status} al consultar el pago ${paymentId}.`);
  }
  return {
    id: data.id,
    status: data.status,
    transaction_amount: data.transaction_amount,
    external_reference: data.external_reference ?? null,
  };
}

// El body de la notificación de MP tiene DOS formatos posibles según el
// tipo de webhook configurado -- `{ type: 'payment', data: { id } }` (el
// actual, "Webhooks") o los query params viejos (`topic=payment&id=...`,
// "IPN" legado). Se soportan los dos para no depender de cuál eligió Seba
// al configurar la integración en su cuenta de MP.
export function extractPaymentId(body: unknown, url: URL): string | null {
  const b = body as { type?: string; action?: string; data?: { id?: string | number } } | null;
  if (b?.data?.id != null && (b.type === 'payment' || b.action?.startsWith('payment'))) {
    return String(b.data.id);
  }
  const topic = url.searchParams.get('topic') ?? url.searchParams.get('type');
  const id = url.searchParams.get('id') ?? url.searchParams.get('data.id');
  if (topic === 'payment' && id) return id;
  return null;
}
