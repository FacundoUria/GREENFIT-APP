import { useEffect, useState } from 'react';

// Fuerza un re-render periódico (sin traer datos nuevos) para que las
// cuentas regresivas relativas ("Faltan 45 min") se actualicen solas.
// Devuelve el número de tic: un componente memorizado que muestra una cuenta
// regresiva (la tarjeta de la Agenda) lo recibe como prop para redibujarse
// en cada tic.
export function useTicker(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return tick;
}
