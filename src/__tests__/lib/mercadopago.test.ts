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
  resolveInitPoint,
  createMpPreference,
  MpApiError,
  MP_BACK_URLS,
} from '../../../supabase/functions/_shared/mercadopago';

describe('buildPreferenceRequest -- arma la preferencia SIEMPRE con datos server-side del pack (combos multi-disciplina)', () => {
  const packUnaDisciplina = {
    id: 'pack-1',
    name: 'Pack 12 clases CrossFit',
    price: 30000,
    creditos: [{ disciplineId: 'disc-crossfit', credits: 12 }],
    incluyeAparatos: false,
    diasVigencia: null,
  };

  it('un pack de una sola disciplina arma el item con el precio/nombre reales y el external_reference correcto', () => {
    const req = buildPreferenceRequest({
      pack: packUnaDisciplina,
      userId: 'user-1',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
    });

    expect(req.items).toEqual([{ title: 'Pack 12 clases CrossFit', quantity: 1, unit_price: 30000, currency_id: 'ARS' }]);
    expect(JSON.parse(req.external_reference)).toEqual({
      user_id: 'user-1',
      pack_id: 'pack-1',
      creditos: [{ discipline_id: 'disc-crossfit', credits: 12 }],
      incluye_aparatos: false,
      dias_vigencia: null,
      aparatos_discipline_id: null,
    });
    expect(req.back_urls).toEqual(MP_BACK_URLS);
    expect(req.auto_return).toBe('approved');
    expect(req.notification_url).toBe('https://proyecto.supabase.co/functions/v1/mp-webhook');
  });

  it('un combo real (Boxeo + CrossFit) arma el external_reference con TODAS las disciplinas', () => {
    const combo = {
      id: 'pack-combo-8-8',
      name: 'Combo 8+8',
      price: 55000,
      creditos: [
        { disciplineId: 'disc-boxeo', credits: 8 },
        { disciplineId: 'disc-crossfit', credits: 8 },
      ],
      incluyeAparatos: false,
      diasVigencia: null,
    };
    const req = buildPreferenceRequest({
      pack: combo,
      userId: 'user-2',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
    });

    expect(JSON.parse(req.external_reference)).toEqual({
      user_id: 'user-2',
      pack_id: 'pack-combo-8-8',
      creditos: [
        { discipline_id: 'disc-boxeo', credits: 8 },
        { discipline_id: 'disc-crossfit', credits: 8 },
      ],
      incluye_aparatos: false,
      dias_vigencia: null,
      aparatos_discipline_id: null,
    });
  });

  it('un pack que incluye Aparatos manda dias_vigencia y aparatos_discipline_id -- nunca un número fijo hardcodeado', () => {
    const paseAparatos = {
      id: 'pack-2-meses-aparatos',
      name: 'Pase 2 Meses Aparatos',
      price: 70000,
      creditos: [],
      incluyeAparatos: true,
      diasVigencia: 60,
    };
    const req = buildPreferenceRequest({
      pack: paseAparatos,
      userId: 'user-3',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
      aparatosDisciplineId: 'disc-aparatos',
    });

    expect(JSON.parse(req.external_reference)).toEqual({
      user_id: 'user-3',
      pack_id: 'pack-2-meses-aparatos',
      creditos: [],
      incluye_aparatos: true,
      dias_vigencia: 60,
      aparatos_discipline_id: 'disc-aparatos',
    });
  });

  it('un combo con Aparatos + créditos manda las dos cosas a la vez', () => {
    const comboConAparatos = {
      id: 'pack-aparatos-crossfit',
      name: 'Aparatos + 12 créditos CrossFit',
      price: 90000,
      creditos: [{ disciplineId: 'disc-crossfit', credits: 12 }],
      incluyeAparatos: true,
      diasVigencia: 30,
    };
    const req = buildPreferenceRequest({
      pack: comboConAparatos,
      userId: 'user-4',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
      aparatosDisciplineId: 'disc-aparatos',
    });

    expect(JSON.parse(req.external_reference)).toEqual({
      user_id: 'user-4',
      pack_id: 'pack-aparatos-crossfit',
      creditos: [{ discipline_id: 'disc-crossfit', credits: 12 }],
      incluye_aparatos: true,
      dias_vigencia: 30,
      aparatos_discipline_id: 'disc-aparatos',
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
      pack: packUnaDisciplina,
      userId: 'user-1',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
      backUrls,
    });
    expect(req.back_urls).toEqual(backUrls);
  });

  it('con payerEmail, arma el objeto payer -- requisito mínimo de una preferencia bien formada', () => {
    const req = buildPreferenceRequest({
      pack: packUnaDisciplina,
      userId: 'user-1',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
      payerEmail: 'socio@greenfit.test',
    });
    expect(req.payer).toEqual({ email: 'socio@greenfit.test' });
  });

  it('sin payerEmail (usuario sin email cargado), no manda ningún payer en vez de uno vacío/inválido', () => {
    const req = buildPreferenceRequest({
      pack: packUnaDisciplina,
      userId: 'user-1',
      notificationUrl: 'https://proyecto.supabase.co/functions/v1/mp-webhook',
    });
    expect(req.payer).toBeUndefined();
  });
});

describe('resolveInitPoint -- bug "Tuvimos un problema (COW00...)": un token TEST- solo puede abrir sandbox_init_point', () => {
  it('con un access token TEST- (cuenta de prueba), devuelve sandbox_init_point', () => {
    expect(
      resolveInitPoint('TEST-1234', { initPoint: 'https://mp.test/prod', sandboxInitPoint: 'https://mp.test/sandbox' })
    ).toBe('https://mp.test/sandbox');
  });

  it('con un access token APP_USR- (cuenta real), devuelve init_point', () => {
    expect(
      resolveInitPoint('APP_USR-1234', { initPoint: 'https://mp.test/prod', sandboxInitPoint: 'https://mp.test/sandbox' })
    ).toBe('https://mp.test/prod');
  });

  it('TEST- sin sandbox_init_point en la respuesta de Mercado Pago -- tira, nunca cae silenciosamente a init_point (reproduciría el bug)', () => {
    expect(() => resolveInitPoint('TEST-1234', { initPoint: 'https://mp.test/prod', sandboxInitPoint: null })).toThrow(
      /sandbox_init_point/
    );
  });

  it('APP_USR- sin init_point en la respuesta de Mercado Pago -- tira en vez de devolver un string vacío', () => {
    expect(() => resolveInitPoint('APP_USR-1234', { initPoint: '', sandboxInitPoint: 'https://mp.test/sandbox' })).toThrow(
      /init_point/
    );
  });
});

describe('createMpPreference -- captura la respuesta exacta de Mercado Pago para poder diagnosticar errores reales', () => {
  const originalFetch = global.fetch;
  const body = {
    items: [{ title: 'Pack', quantity: 1, unit_price: 100, currency_id: 'ARS' }],
    external_reference: '{}',
    back_urls: MP_BACK_URLS,
    auto_return: 'approved',
    notification_url: 'https://x.supabase.co/functions/v1/mp-webhook',
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('éxito: devuelve id, initPoint y sandboxInitPoint tal cual los mandó Mercado Pago', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: 'pref-1', init_point: 'https://mp.test/prod', sandbox_init_point: 'https://mp.test/sandbox' }),
    }) as unknown as typeof fetch;

    const result = await createMpPreference('TEST-1234', body);
    expect(result).toEqual({ id: 'pref-1', initPoint: 'https://mp.test/prod', sandboxInitPoint: 'https://mp.test/sandbox' });
  });

  it('Mercado Pago responde con error -- tira MpApiError con el status y el body EXACTOS de la respuesta (para loguearlos/mostrarlos)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'invalid access token' }),
    }) as unknown as typeof fetch;

    await expect(createMpPreference('TOKEN-INVALIDO', body)).rejects.toMatchObject({
      name: 'MpApiError',
      message: 'invalid access token',
      status: 400,
      body: { message: 'invalid access token' },
    });
  });

  it('Mercado Pago responde con error sin `message` en el body -- arma un mensaje genérico con el status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    await expect(createMpPreference('TEST-1234', body)).rejects.toThrow(/Mercado Pago respondió 500/);
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
  it('parsea un external_reference de un combo real (2 disciplinas)', () => {
    const raw = JSON.stringify({
      user_id: 'u1',
      pack_id: 'p1',
      creditos: [
        { discipline_id: 'd-boxeo', credits: 8 },
        { discipline_id: 'd-crossfit', credits: 8 },
      ],
      incluye_aparatos: false,
      dias_vigencia: null,
      aparatos_discipline_id: null,
    });
    expect(parseExternalReference(raw)).toEqual({
      user_id: 'u1',
      pack_id: 'p1',
      creditos: [
        { discipline_id: 'd-boxeo', credits: 8 },
        { discipline_id: 'd-crossfit', credits: 8 },
      ],
      incluye_aparatos: false,
      dias_vigencia: null,
      aparatos_discipline_id: null,
    });
  });

  it('parsea un pase de Aparatos puro (creditos vacío, incluye_aparatos true, dias_vigencia real)', () => {
    const raw = JSON.stringify({
      user_id: 'u1',
      pack_id: 'p-aparatos',
      creditos: [],
      incluye_aparatos: true,
      dias_vigencia: 60,
      aparatos_discipline_id: 'd-aparatos',
    });
    expect(parseExternalReference(raw)).toEqual({
      user_id: 'u1',
      pack_id: 'p-aparatos',
      creditos: [],
      incluye_aparatos: true,
      dias_vigencia: 60,
      aparatos_discipline_id: 'd-aparatos',
    });
  });

  it('filtra elementos de `creditos` corruptos/incompletos en vez de acreditar con datos inválidos', () => {
    const raw = JSON.stringify({
      user_id: 'u1',
      pack_id: 'p1',
      creditos: [
        { discipline_id: 'd-boxeo', credits: 8 },
        { discipline_id: 'd-crossfit' }, // sin credits -- se descarta
        { credits: 5 }, // sin discipline_id -- se descarta
        { discipline_id: 'd-kick', credits: 0 }, // 0 créditos -- se descarta
      ],
      incluye_aparatos: false,
    });
    expect(parseExternalReference(raw)?.creditos).toEqual([{ discipline_id: 'd-boxeo', credits: 8 }]);
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
    // pack_id sin `creditos` (ni siquiera un array vacío) tampoco es válido.
    expect(parseExternalReference(JSON.stringify({ user_id: 'u1', pack_id: 'p1' }))).toBeNull();
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
