import { useEffect, useState } from 'react';

// Fuerza un re-render periódico (sin traer datos nuevos) para que las
// cuentas regresivas relativas ("Faltan 45 min") se actualicen solas.
export function useTicker(intervalMs = 30_000) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
