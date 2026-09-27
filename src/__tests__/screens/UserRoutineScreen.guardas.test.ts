import fs from 'fs';
import path from 'path';

// Guardas del rediseño de Mi Rutina (mockup HTML "Mi Rutina HUD"): lee el
// CÓDIGO FUENTE de la pantalla y falla si aparece algún dato de ejemplo del
// mockup escrito a mano, alguna de las funciones que quedaron FUERA de
// alcance (Repetir / Rutina Favorita), los nombres de pestañas del mockup, o
// un color hex suelto en vez de los tokens de theme/colors.ts. Mismo criterio
// que HomeRediseno.guardas.test.tsx.

const ARCHIVO = path.resolve(__dirname, '../../screens/user/UserRoutineScreen.tsx');

function codigoSinComentarios(): string {
  const codigo = fs.readFileSync(ARCHIVO, 'utf8');
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PROHIBIDOS: [string, RegExp][] = [
  // Datos de ejemplo del mockup
  ['nombre de usuario de ejemplo', /Facundo/],
  ['URL de avatar del mockup', /googleusercontent/],
  ['rutina de ejemplo "Espalda & Tríceps"', /Espalda/],
  ['ejercicio de ejemplo "Dominadas"', /Dominadas/],
  ['ejercicio de ejemplo "Remo"', /Remo /],
  ['ejercicio de ejemplo "Fondos en paralelas"', /Fondos en paralelas/],
  ['carga de ejemplo "Corporal"', /Corporal/],
  ['carga de ejemplo en KG', /\b\d+\s?KG\b/],
  ['fecha de ejemplo del mockup', /\b(19|15|13) Feb\b/],
  // Fuera de alcance
  ['botón "Repetir"', /Repetir/i],
  ['"Guardar como Rutina Favorita"', /Favorit/i],
  // Nombres de pestañas del mockup (se usan "Rutina de hoy" / "Historial")
  ['pestaña "Entrenar Ahora"', /Entrenar Ahora/i],
  ['pestaña "Rutinas Guardadas"', /Rutinas Guardadas/i],
  ['botón "Terminar y Registrar"', /Terminar y Registrar/i],
];

// Único hex permitido: el verde oficial de WhatsApp del botón "Contactar a mi
// entrenador" (color de marca de un tercero, ya estaba antes del rediseño).
const HEX_PERMITIDOS = new Set(['#25D366']);

describe('rediseño de Mi Rutina -- guardas', () => {
  it.each(PROHIBIDOS)('no contiene %s', (_descripcion, regex) => {
    expect(regex.test(codigoSinComentarios())).toBe(false);
  });

  it('no usa colores hex sueltos (todo sale de theme/colors.ts)', () => {
    const hexes: string[] = codigoSinComentarios().match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes.filter((h) => !HEX_PERMITIDOS.has(h.toUpperCase()))).toEqual([]);
  });

  it('usa los nombres de pestañas acordados', () => {
    const codigo = codigoSinComentarios();
    expect(codigo).toContain("'Rutina de hoy'");
    expect(codigo).toContain("'Historial'");
  });
});
