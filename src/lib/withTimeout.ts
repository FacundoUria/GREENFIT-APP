// El cliente de Supabase no tiene timeout por defecto en el `fetch` de sus
// llamadas: si la conexión (wifi del gimnasio, datos móviles) se cuelga a
// mitad de una request, la promesa de esa llamada puede quedar pendiente
// para siempre -- ninguna de las dos ramas del try/catch de quien la llamó
// se ejecuta jamás, así que ningún estado de carga (spinner) se cierra.
// withTimeout() acota cualquier promesa a `ms` -- pasado ese tiempo,
// rechaza con un mensaje claro en vez de quedarse esperando, para que el
// spinner SIEMPRE termine (éxito, error real, o timeout) y nunca quede
// "pensando" indefinidamente.
// `PromiseLike`, no `Promise`: los builders de supabase-js (`.rpc(...)`,
// `.from(...).select(...)`) son "thenables" -- tienen `.then()` pero no son
// instancias reales de Promise (les falta `.catch()`/`.finally()`) hasta
// que se los await/envuelve. Pedir `Promise<T>` acá rechazaba esos
// builders en tiempo de compilación.
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
