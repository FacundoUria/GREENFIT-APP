import type { Page, Route } from '@playwright/test';

// Backend 100% mockeado a nivel de red -- ningún test E2E de esta suite
// toca la Supabase real de producción. EXPO_PUBLIC_SUPABASE_URL del build
// de e2e (ver package.json "build:e2e-web") apunta a este dominio FALSO a
// propósito: cualquier request que se escape sin interceptar falla por DNS
// en vez de pegarle en silencio a producción -- mismo criterio de
// seguridad que "fail closed, no fail open".
export const SUPABASE_URL = 'https://e2e-mock.supabase.co';
export const SUPABASE_ANON_KEY = 'e2e-anon-key';
const SUPABASE_HOST = new URL(SUPABASE_URL).hostname;

// PNG transparente de 1x1 -- placeholder mínimo válido para cualquier GET a
// Storage (avatares, fotos de posts), así el <Image>/<img> del lado del
// cliente carga de verdad en vez de fallar silenciosamente.
const PNG_1X1_TRANSPARENTE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

export interface MockSocio {
  id: string;
  email: string;
  dni: string;
  fullName: string;
  role: 'socio' | 'admin';
  avatarUrl?: string | null;
  createdAt?: string;
  // Teléfono/domicilio -- por defecto YA completos (junto con emergencia
  // abajo) para que el perfil quede "completo" y no dispare la redirección
  // obligatoria a "Mis datos" en el resto de la suite, a la que no le
  // interesa ese gate. Un spec que sí quiera probar el perfil incompleto
  // los pisa explícitamente a null (ver perfil-obligatorio.spec.ts).
  phone?: string | null;
  domicilio?: string | null;
  // Datos de emergencia (perfil obligatorio -- ver ProfileStack.tsx). Mismo
  // criterio que arriba: completos por defecto.
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  medicalNotes?: string | null;
}

export type TablaFixtures = Record<string, any[]>;
export type RpcFixtures = Record<string, any>;

function fakeSession(user: MockSocio) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    access_token: `e2e-access-token-${user.id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: nowSec + 3600,
    refresh_token: `e2e-refresh-token-${user.id}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: user.createdAt ?? '2025-01-15T00:00:00.000Z',
    },
  };
}

function mockProfileRow(user: MockSocio) {
  return {
    id: user.id,
    full_name: user.fullName,
    dni: user.dni,
    email: user.email,
    // Perfil obligatorio (Nombre/Apellido/DNI/Correo/Teléfono/Teléfono de
    // emergencia/Domicilio, ver AuthContext.tsx tienePerfilCompleto) --
    // todos completos por defecto (`undefined` en el fixture cae acá) para
    // no romper el resto de la suite E2E, a la que no le interesa este
    // gate; un spec que sí quiera probar el perfil incompleto pisa el campo
    // que le interesa explícitamente a null.
    phone: user.phone !== undefined ? user.phone : '1122334455',
    domicilio: user.domicilio !== undefined ? user.domicilio : 'Domicilio E2E 123',
    role: user.role,
    active: true,
    avatar_url: user.avatarUrl ?? null,
    emergency_contact_name: user.emergencyContactName !== undefined ? user.emergencyContactName : 'Contacto E2E',
    emergency_contact_phone: user.emergencyContactPhone !== undefined ? user.emergencyContactPhone : '1100000000',
    medical_notes: user.medicalNotes !== undefined ? user.medicalNotes : 'Sin observaciones (E2E).',
    created_at: user.createdAt ?? '2025-01-15T00:00:00.000Z',
  };
}

// Filtrado real y básico estilo PostgREST (?columna=operador.valor) -- NO
// es una reimplementación completa (no soporta OR compuesto, LIKE, etc.),
// pero cubre los operadores que de verdad usa esta app (eq/is.null/in/gte/
// lte), que son la enorme mayoría de las queries del código real. Sin
// esto, cosas como "¿ya hay un check-in HOY?" (.eq('event_date', hoy))
// siempre devolverían la primera fila del fixture entero, sin importar la
// fecha -- necesario para que HoyEntreneButton y el resto se comporten de
// forma realista en la suite E2E.
function aplicarFiltros(filas: any[], searchParams: URLSearchParams): any[] {
  let resultado = filas;
  for (const [columna, valorCrudo] of searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(columna)) continue;
    const separador = valorCrudo.indexOf('.');
    if (separador === -1) continue;
    const operador = valorCrudo.slice(0, separador);
    const valor = valorCrudo.slice(separador + 1);

    if (operador === 'eq') {
      resultado = resultado.filter((fila) => String(fila[columna]) === valor);
    } else if (operador === 'is' && valor === 'null') {
      resultado = resultado.filter((fila) => fila[columna] === null || fila[columna] === undefined);
    } else if (operador === 'in') {
      const valores = valor
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((v) => v.replace(/^"|"$/g, ''));
      resultado = resultado.filter((fila) => valores.includes(String(fila[columna])));
    } else if (operador === 'gte') {
      resultado = resultado.filter((fila) => fila[columna] >= valor);
    } else if (operador === 'lte') {
      resultado = resultado.filter((fila) => fila[columna] <= valor);
    }
    // Otros operadores (neq/gt/lt/like/...) no se filtran a propósito --
    // devuelven todas las filas tal cual, mismo criterio de "mock
    // simplificado" del resto de esta suite.
  }
  return resultado;
}

export interface MockSupabaseOptions {
  user: MockSocio;
  /** table name (snake_case, como en la URL de PostgREST) -> filas */
  tables?: TablaFixtures;
  /** nombre de función -> lo que debe devolver el RPC */
  rpc?: RpcFixtures;
}

async function responderJson(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

// Intercepta TODO lo que el cliente supabase-js puede llamar (auth, REST,
// RPC) y responde con fixtures en memoria -- no hay base de datos real
// detrás. UN SOLO page.route() con un matcher de FUNCIÓN (no un string
// glob) que despacha por pathname adentro: los patrones glob tipo
// "**/auth/v1/token**" resultaron poco confiables acá (el de REST
// matcheaba, el de auth con la MISMA sintaxis no, sin una causa obvia) --
// un matcher de función sobre `url.hostname` es inequívoco y de paso evita
// pelear con el orden de prioridad de Playwright cuando dos patrones se
// solapan (según la doc, el ÚLTIMO route registrado gana, algo que ya
// afectaba a /rest/v1/rpc/** vs /rest/v1/** acá mismo). `tables`/`rpc`
// quedan MUTABLES (se devuelve la referencia) para que un test pueda
// simular "otorgar XP" agregando una fila a mitad de camino y volviendo a
// consultar.
export async function mockSupabase(page: Page, options: MockSupabaseOptions) {
  const { user, tables = {}, rpc = {} } = options;
  tables.profiles = [mockProfileRow(user)];

  await page.route(
    (url) => url.hostname === SUPABASE_HOST,
    async (route) => {
      const request = route.request();
      const reqUrl = new URL(request.url());
      const method = request.method();
      const pathname = reqUrl.pathname;

      if (pathname === '/auth/v1/token') {
        await responderJson(route, 200, fakeSession(user));
        return;
      }
      if (pathname === '/auth/v1/user') {
        await responderJson(route, 200, fakeSession(user).user);
        return;
      }
      if (pathname === '/auth/v1/logout') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      // Simula la Edge Function real (supabase/functions/create-payment-
      // preference) -- devuelve un initPoint real y determinístico. Antes
      // de esto, esta ruta caía al 404 genérico de "sin fixture" de más
      // abajo y paymentsApi.ts lo interpretaba como "función no
      // desplegada" (caía a su propio mock interno) -- deployado significa
      // "la función SÍ contesta", así que emularlo acá con un 404 genérico
      // ya no es correcto: paymentsApi.ts ahora distingue ese caso de un
      // error real y lo muestra en pantalla en vez de redirigir.
      if (pathname === '/functions/v1/create-payment-preference') {
        const payload = request.postDataJSON() as { packId?: string } | null;
        await responderJson(route, 200, {
          initPoint: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=E2E-MOCK-${payload?.packId ?? 'sin-pack'}`,
          preferenceId: `e2e-pref-${payload?.packId ?? 'sin-pack'}`,
        });
        return;
      }

      if (pathname.startsWith('/rest/v1/rpc/')) {
        const fnName = pathname.replace('/rest/v1/rpc/', '');

        // get_bookings_count_por_clase (ver supabase_migration_bookings_
        // count_rpc.sql -- fix del bug real "0 de X cupos" en la PWA, ver
        // classesApi.ts): si el test no lo pisa explícitamente en `rpc`, se
        // calcula solo a partir del fixture de `bookings` -- el mismo
        // COUNT real que hace el RPC de verdad -- así cualquier test que ya
        // sembraba `bookings` (el patrón de siempre en esta suite) sigue
        // funcionando tal cual, sin tener que agregar un fixture de RPC a
        // mano en cada uno.
        if (fnName === 'get_bookings_count_por_clase' && !(fnName in rpc)) {
          let params: { p_class_ids?: string[]; p_booking_date?: string } = {};
          try {
            params = request.postDataJSON() ?? {};
          } catch {
            // sin body parseable -- se responde con 0 filas.
          }
          const classIds = params.p_class_ids ?? [];
          const filas = (tables.bookings ?? []).filter(
            (b) => b.booking_date === params.p_booking_date && classIds.includes(b.class_id)
          );
          const counts = new Map<string, number>();
          for (const b of filas) counts.set(b.class_id, (counts.get(b.class_id) ?? 0) + 1);
          await responderJson(
            route,
            200,
            Array.from(counts, ([class_id, booked_count]) => ({ class_id, booked_count }))
          );
          return;
        }

        if (fnName in rpc) {
          const value = typeof rpc[fnName] === 'function' ? rpc[fnName](request) : rpc[fnName];
          await responderJson(route, 200, value);
        } else {
          // PGRST202 = función no encontrada -- el mismo código que la app
          // ya sabe interpretar como "esa migración todavía no corrió" y
          // cae a su modo demo, así que un RPC no configurado en el
          // fixture no rompe el test, solo activa el fallback ya probado
          // en la suite Jest.
          await responderJson(route, 404, { code: 'PGRST202', message: 'function not found in schema cache' });
        }
        return;
      }

      if (pathname.startsWith('/rest/v1/')) {
        const table = pathname.replace('/rest/v1/', '');

        if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
          const filas = tables[table] ?? [];
          // Efecto mínimo: un insert agrega la fila enviada al fixture en
          // memoria, así una consulta posterior en el MISMO test ya la ve.
          if (method === 'POST') {
            try {
              const payload = request.postDataJSON();
              const nuevas = Array.isArray(payload) ? payload : [payload];
              for (const fila of nuevas) filas.push({ id: `e2e-${table}-${filas.length + 1}`, ...fila });
            } catch {
              // sin body parseable -- no hay nada que agregar al fixture.
            }
          }
          // Un PATCH real persiste -- sin esto, un `.from(x).update(...)`
          // seguido de un re-fetch en el MISMO test (ej. ProfileScreen
          // vuelve a pedir `profiles` porque cambió `user` en AuthContext)
          // pisaba el guardado con los datos viejos del fixture, algo que
          // NUNCA pasaría contra la Supabase real. Aplica los mismos
          // filtros que ya usa el GET (?columna=eq.valor) para saber a qué
          // filas les pega el UPDATE, y mergea el payload adentro (misma
          // referencia de objeto que vive en `tables[table]`).
          if (method === 'PATCH') {
            try {
              const payload = request.postDataJSON();
              const objetivo = aplicarFiltros(filas, reqUrl.searchParams);
              for (const fila of objetivo) Object.assign(fila, payload);
            } catch {
              // sin body parseable -- no hay nada que mergear.
            }
          }
          await responderJson(route, 201, filas);
          return;
        }

        const filas = aplicarFiltros(tables[table] ?? [], reqUrl.searchParams);
        const acceptHeader = request.headers()['accept'] ?? '';
        const esperaUnaSola = acceptHeader.includes('vnd.pgrst.object');
        const preferCount = request.headers()['prefer'] ?? '';

        const headers: Record<string, string> = {};
        if (preferCount.includes('count=exact')) {
          headers['content-range'] = `0-${Math.max(filas.length - 1, 0)}/${filas.length}`;
        }

        if (method === 'HEAD') {
          await route.fulfill({ status: 200, headers });
          return;
        }

        const body = esperaUnaSola ? (filas[0] ?? null) : filas;
        await responderJson(route, 200, body, headers);
        return;
      }

      if (pathname.startsWith('/storage/v1/object')) {
        if (method === 'GET') {
          // Un GET de storage es la carga de una FOTO real (avatar, post de
          // Comunidad) -- hay que devolver bytes de imagen de verdad, no
          // JSON, para que el <img>/<Image> del lado del cliente cargue en
          // vez de quedar en estado de error silencioso (invisible en
          // pantalla, rompía el assert de "avatar visible").
          await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1_TRANSPARENTE });
          return;
        }
        await responderJson(route, 200, { Key: pathname });
        return;
      }

      // Cualquier otra cosa (no debería pasar en esta suite) -- 404 en vez
      // de dejar pasar a la red real.
      await responderJson(route, 404, { message: `[e2e mock] sin fixture para ${method} ${pathname}` });
    }
  );
}
