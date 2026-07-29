// El socio usa su DNI como usuario; Supabase Auth sigue pidiendo un email
// por debajo, así que lo sintetizamos y lo ocultamos del usuario.
export function dniToEmail(dni: string): string {
  return `${dni.trim()}@greenfit.com`;
}

export function isValidDni(dni: string): boolean {
  return /^\d{6,10}$/.test(dni.trim());
}
