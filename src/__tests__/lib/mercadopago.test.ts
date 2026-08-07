// Testea el módulo compartido REAL de las Edge Functions
// (supabase/functions/_shared/mercadopago.ts) -- es TS puro sin imports de
// Deno, así que Jest lo puede importar directo. El resto de cada función
// (`serve(...)`, Deno.env.get, createAdminClient) corre en el runtime de
// Supabase Edge Functions y queda fuera del alcance de esta suite (mismo
// límite ya documentado para RLS: no hay forma de correr eso acá).
import {
  buildPreferenceRequest,
  parseExternalReference,
  extractPaymentId,
  resolveBackUrls,
  MP_BACK_URLS,
} from '../../../supabase/functions/_shared/mercadopago';

describe('buildPreferenceRequest -- arma la preferencia SIEMPRE con datos server-side del pack', () => {
  const packCreditos = {
    id: 'pack-1',
    name: 'Pack 12 clases CrossFit',
    price: 30000,
    credits: 12,
    durationDays: null,
    disciplineId: 'disc-crossfit',
  };

  it('un pack de créditos arma el item con el precio/nombre reales y el external_reference correcto', () => {
    const req = buildPreferenceRequest({
      pack: packCreditos,
      userId: 'user-1',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
    });

    expect(req.items).toEqual([{ title: 'Pack 12 clases CrossFit', quantity: 1, unit_price: 30000, currency_id: 'ARS' }]);
    expect(JSON.parse(req.external_reference)).toEqual({
      user_id: 'user-1',
      pack_id: 'pack-1',
      discipline_id: 'disc-crossfit',
      credits: 12,
      duration_days: null,
    });
    expect(req.back_urls).toEqual(MP_BACK_URLS);
    expect(req.auto_return).toBe('approved');
    expect(req.notification_url).toBe('https://proyecto.supabase.co/functions/v1/mp-webhook');
  });

  it('un pack de membresía (Aparatos, duration_days) arma el external_reference con duration_days y credits null', () => {
    const packMembresia = {
      id: 'pack-aparatos',
      name: 'Mes libre Aparatos',
      price: 21000,
      credits: null,
      durationDays: 30,
      disciplineId: 'disc-aparatos',
    };
    const req = buildPreferenceRequest({
      pack: packMembresia,
      userId: 'user-2',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
    });

    expect(JSON.parse(req.external_reference)).toEqual({
      user_id: 'user-2',
      pack_id: 'pack-aparatos',
      discipline_id: 'disc-aparatos',
      credits: null,
      duration_days: 30,
    });
  });

  it('nunca depende de un precio/nombre mandado por el cliente -- solo usa lo que trae el objeto `pack`', () => {
    // No hay ningún parámetro de "precio del cliente" en la firma de la
    // función -- este test documenta esa garantía: si alguien agrega uno
    // por error en el futuro, este archivo es el lugar donde se nota.
    expect(buildPreferenceRequest.length).toBe(1); // un solo objeto de parámetros
  });

  it('con backUrls explícito (Web), lo usa en vez del custom scheme por defecto', () => {
    const backUrls = { success: 'https://app.greenfit.test/', pending: 'https://app.greenfit.test/', failure: 'https://app.greenfit.test/' };
    const req = buildPreferenceRequest({
      pack: packCreditos,
      userId: 'user-1',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
      backUrls,
    });
    expect(req.back_urls).toEqual(backUrls);
  });
});

describe('resolveBackUrls -- react-native-webview no soporta Web, ahí el back_url tiene que ser una URL real', () => {
  it('con un Origin de navegador (http/https), usa ese origin como back_url para los 3 estados', () => {
    expect(resolveBackUrls('https://app.greenfit.com.ar')).toEqual({
      success: 'https://app.greenfit.com.ar',
      pending: 'https://app.greenfit.com.ar',
      failure: 'https://app.greenfit.com.ar',
    });
  });

  it('con un Origin de localhost (desarrollo Web), también lo usa -- no depende de un dominio hardcodeado', () => {
    expect(resolveBackUrls('http://localhost:8081')).toEqual({
      success: 'http://localhost:8081',
      pending: 'http://localhost:8081',
      failure: 'http://localhost:8081',
    });
  });

  it('sin Origin (fetch nativo -- React Native/Hermes no lo manda), usa el custom scheme de siempre', () => {
    expect(resolveBackUrls(null)).toEqual(MP_BACK_URLS);
    expect(resolveBackUrls(undefined)).toEqual(MP_BACK_URLS);
  });

  it('un Origin que no es http/https (valor inesperado) tampoco se usa -- fallback al custom scheme', () => {
    expect(resolveBackUrls('null')).toEqual(MP_BACK_URLS);
    expect(resolveBackUrls('')).toEqual(MP_BACK_URLS);
  });
});

describe('parseExternalReference -- nunca confía ciegamente en el string que devuelve MP', () => {
  it('parsea un external_reference válido', () => {
    const raw = JSON.stringify({ user_id: 'u1', pack_id: 'p1', discipline_id: 'd1', credits: 6, duration_days: null });
    expect(parseExternalReference(raw)).toEqual({
      user_id: 'u1',
      pack_id: 'p1',
      discipline_id: 'd1',
      credits: 6,
      duration_days: null,
    });
  });

  it('null/vacío devuelve null sin romper', () => {
    expect(parseExternalReference(null)).toBeNull();
    expect(parseExternalReference(undefined)).toBeNull();
    expect(parseExternalReference('')).toBeNull();
  });

  it('JSON inválido devuelve null en vez de tirar una excepción', () => {
    expect(parseExternalReference('esto no es json')).toBeNull();
  });

  it('JSON válido pero sin los campos obligatorios devuelve null (no acredita a nadie con datos incompletos)', () => {
    expect(parseExternalReference(JSON.stringify({ algo: 'random' }))).toBeNull();
    expect(parseExternalReference(JSON.stringify({ user_id: 'u1' }))).toBeNull();
  });
});

describe('extractPaymentId -- soporta el formato nuevo (webhook) y el legado (IPN por query params)', () => {
  it('formato nuevo: { type: "payment", data: { id } } en el body', () => {
    const url = new URL('https://proyecto.supabase.co/functions/v1/mp-webhook');
    expect(extractPaymentId({ type: 'payment', data: { id: 123456 } }, url)).toBe('123456');
  });

  it('formato legado: ?topic=payment&id=... por query string, sin body', () => {
    const url = new URL('https://proyecto.supabase.co/functions/v1/mp-webhook?topic=payment&id=987654');
    expect(extractPaymentId(null, url)).toBe('987654');
  });

  it('un evento que no es de payment (ej. merchant_order) se ignora -- devuelve null', () => {
    const url = new URL('https://proyecto.supabase.co/functions/v1/mp-webhook');
    expect(extractPaymentId({ type: 'merchant_order', data: { id: 1 } }, url)).toBeNull();
  });

  it('sin body ni query params reconocibles, devuelve null', () => {
    const url = new URL('https://proyecto.supabase.co/functions/v1/mp-webhook');
    expect(extractPaymentId(null, url)).toBeNull();
  });
});
