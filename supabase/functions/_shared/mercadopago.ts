// Helpers de Mercado Pago compartidos entre create-payment-preference y
// mp-webhook -- separados del `serve()` de cada función a propósito para
// que la parte que arma/interpreta datos (sin tocar red) se pueda testear
// con Jest en el resto del repo (Deno no corre en esa suite, pero estas
// funciones son TS puro, sin imports de Deno, así que sí).

// Un pack ahora puede ser un combo real de N disciplinas (ej. "8 créditos
// Boxeo + 8 créditos CrossFit") -- `creditos` reemplaza al viejo par
// discipline_id/credits (1 disciplina por pack). `incluyeAparatos` es un
// switch independiente: extiende 30 días fijos la membresía de Aparatos
// del socio sin importar qué otras disciplinas traiga el combo.
export interface CreditoPorDisciplina {
  disciplineId: string;
  credits: number;
}

export interface PackParaPreferencia {
  id: string;
  name: string;
  price: number;
  creditos: CreditoPorDisciplina[];
  incluyeAparatos: boolean;
  // Cantidad EXACTA de días a extender Aparatos -- configurable por pack
  // (30 = 1 mes, 60 = 2 meses, 90 = 3 meses, o cualquier valor que cargue
  // Seba), nunca un número fijo hardcodeado. null/ignorado si
  // incluyeAparatos es false.
  diasVigencia: number | null;
}

export interface ExternalReference {
  user_id: string;
  pack_id: string;
  creditos: { discipline_id: string; credits: number }[];
  incluye_aparatos: boolean;
  dias_vigencia: number | null;
  // La Edge Function ya resuelve esto contra `disciplines` (kind=
  // 'membership') al crear la preferencia -- el webhook nunca tiene que
  // adivinar cuál disciplina es "Aparatos" ni depender de un nombre
  // hardcodeado. null si incluye_aparatos es false.
  aparatos_discipline_id: string | null;
}

export interface MpPreferenceRequest {
  items: { title: string; quantity: number; unit_price: number; currency_id: string }[];
  external_reference: string;
  back_urls: { success: string; pending: string; failure: string };
  auto_return: string;
  notification_url: string;
  payer?: { email: string };
}

// URLs de esquema custom, para nativo (Expo Go / build instalada) -- ya las
// intercepta PaymentWebViewScreen.tsx (ver SUCCESS_MARKERS/PENDING_MARKERS/
// FAILURE_MARKERS en src/lib/paymentResult.ts) antes de que el WebView
// intente "navegar" de verdad a estas.
export const MP_BACK_URLS = {
  success: 'greenfit://payment-success',
  pending: 'greenfit://payment-pending',
  failure: 'greenfit://payment-failure',
};

// react-native-webview no soporta Web ("does not support this platform") --
// ahí el checkout se abre con una redirección de página completa
// (window.location.href, ver PaymentWebViewScreen.tsx), así que el back_url
// tiene que ser una URL real a la que el navegador pueda volver: el mismo
// origin desde el que se pidió la preferencia. Mercado Pago le agrega sus
// propios query params (status/collection_status) al redirigir para
// cualquier back_url, con lo cual no hace falta ninguna ruta especial --
// HomeScreen los detecta apenas la PWA vuelve a cargar ahí (ver su propio
// useEffect, mismos marcadores que usa PaymentWebViewScreen).
// `originHeader` sale del header `Origin` del request a
// create-payment-preference -- un fetch de navegador siempre lo manda; un
// fetch nativo (React Native/Hermes) no, así que su ausencia es la señal de
// que estamos en nativo y corresponde el custom scheme de arriba.
export function resolveBackUrls(originHeader: string | null | undefined): typeof MP_BACK_URLS {
  if (originHeader && /^https?:\/\//i.test(originHeader)) {
    return { success: originHeader, pending: originHeader, failure: originHeader };
  }
  return MP_BACK_URLS;
}

// El precio/cantidad de créditos/días SIEMPRE salen del pack real leído de
// la base (nunca de lo que mande el cliente) -- esto es lo único que se usa
// para armar la preferencia. `external_reference` viaja server-verificado:
// el webhook no necesita (ni debe) confiar en nada que el cliente haya
// mandado en el momento de comprar.
export function buildPreferenceRequest(params: {
  pack: PackParaPreferencia;
  userId: string;
  notificationUrl: string;
  backUrls?: { success: string; pending: string; failure: string };
  payerEmail?: string | null;
  // Id real de la disciplina "Aparatos" (kind='membership'), resuelto por
  // la Edge Function contra `disciplines` -- solo se usa (y solo hace
  // falta) si el pack incluye Aparatos.
  aparatosDisciplineId?: string | null;
}): MpPreferenceRequest {
  const { pack, userId, notificationUrl, backUrls, payerEmail, aparatosDisciplineId } = params;
  const externalReference: ExternalReference = {
    user_id: userId,
    pack_id: pack.id,
    creditos: pack.creditos.map((c) => ({ discipline_id: c.disciplineId, credits: c.credits })),
    incluye_aparatos: pack.incluyeAparatos,
    dias_vigencia: pack.incluyeAparatos ? pack.diasVigencia : null,
    aparatos_discipline_id: pack.incluyeAparatos ? (aparatosDisciplineId ?? null) : null,
  };

  return {
    items: [{ title: pack.name, quantity: 1, unit_price: pack.price, currency_id: 'ARS' }],
    external_reference: JSON.stringify(externalReference),
    back_urls: backUrls ?? MP_BACK_URLS,
    auto_return: 'approved',
    notification_url: notificationUrl,
    // Sin `payer`, Mercado Pago igual arma la preferencia pero el checkout
    // le pide el email al socio de cero -- mandarlo precargado (el email
    // real de la cuenta autenticada) es parte de los "requisitos mínimos"
    // de una preferencia bien formada, no solo comodidad.
    ...(payerEmail ? { payer: { email: payerEmail } } : {}),
  };
}

// Parseo defensivo de external_reference -- si viniera corrupto/ajeno
// (nunca debería, lo generamos nosotros mismos), el webhook lo descarta en
// vez de reventar o, peor, acreditarle algo a cualquiera.
export function parseExternalReference(raw: string | null | undefined): ExternalReference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.user_id !== 'string' || typeof parsed?.pack_id !== 'string' || !Array.isArray(parsed?.creditos)) {
      return null;
    }
    const creditos = parsed.creditos.filter(
      (c: unknown): c is { discipline_id: string; credits: number } =>
        typeof (c as any)?.discipline_id === 'string' && typeof (c as any)?.credits === 'number' && (c as any).credits > 0
    );
    return {
      user_id: parsed.user_id,
      pack_id: parsed.pack_id,
      creditos,
      incluye_aparatos: parsed.incluye_aparatos === true,
      dias_vigencia: typeof parsed.dias_vigencia === 'number' && parsed.dias_vigencia > 0 ? parsed.dias_vigencia : null,
      aparatos_discipline_id: typeof parsed.aparatos_discipline_id === 'string' ? parsed.aparatos_discipline_id : null,
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

// Error explícito de la API de Mercado Pago (no un fallo de red genérico)
// -- lleva el status HTTP y el body completo para poder loguearlos tal
// cual en create-payment-preference/index.ts ("capturar la respuesta
// exacta de Mercado Pago") y devolverle al cliente un mensaje real en vez
// de un init_point roto.
export class MpApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'MpApiError';
    this.status = status;
    this.body = body;
  }
}

export async function createMpPreference(
  accessToken: string,
  body: MpPreferenceRequest
): Promise<{ id: string; initPoint: string; sandboxInitPoint: string | null }> {
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  // Log de diagnóstico SIEMPRE (éxito o error) -- "Tuvimos un problema
  // (COW00...)" en el checkout no deja ningún rastro del lado de la PWA,
  // así que la única forma real de diagnosticarlo es viendo qué contestó
  // Mercado Pago en los logs de la Edge Function (Supabase Dashboard >
  // Edge Functions > create-payment-preference > Logs).
  console.log('[mercadopago] POST /checkout/preferences ->', res.status, JSON.stringify(data));
  if (!res.ok) {
    throw new MpApiError(
      data?.message ?? `Mercado Pago respondió ${res.status} al crear la preferencia.`,
      res.status,
      data
    );
  }
  return { id: data.id, initPoint: data.init_point, sandboxInitPoint: data.sandbox_init_point ?? null };
}

// Un access token de TEST- (cuenta de prueba) solo puede abrir
// sandbox_init_point -- usar init_point con un token de test es exactamente
// el síntoma reportado ("Tuvimos un problema", código COW00...: Mercado
// Pago rechaza el checkout de producción para una preferencia de prueba).
// Con un token real (APP_USR-) es al revés: corresponde init_point.
export function resolveInitPoint(
  accessToken: string,
  preference: { initPoint: string; sandboxInitPoint: string | null }
): string {
  if (accessToken.startsWith('TEST-')) {
    if (!preference.sandboxInitPoint) {
      throw new Error('Mercado Pago no devolvió sandbox_init_point para un access token de prueba (TEST-).');
    }
    return preference.sandboxInitPoint;
  }
  if (!preference.initPoint) {
    throw new Error('Mercado Pago no devolvió init_point.');
  }
  return preference.initPoint;
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
