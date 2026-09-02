import fs from 'fs';
import path from 'path';

// Alert.alert() de react-native es un no-op literal en Web
// (react-native-web) -- en la PWA no muestra NADA (ver crossPlatformAlert.ts
// para el detalle completo). Este repo no tenía ESLint configurado (sin
// .eslintrc/eslint.config, sin dependencia "eslint" en package.json) --
// esto cumple el mismo rol de "regla de lint" apoyado en lo que el repo SÍ
// tiene y ya corre siempre: la suite de Jest.
//
// Guarda de regresión: escanea TODO el código fuente (src/) y falla si
// aparece un Alert.alert( directo fuera de crossPlatformAlert.ts (el único
// lugar donde es intencional -- ahí ES el fallback nativo real). Nace de
// migrar 24 usos sueltos que se habían colado en 6 archivos sin que nadie
// se diera cuenta -- si un uso nuevo se cuela otra vez, este test lo corta
// en el próximo `npm test` en vez de quedar en silencio hasta que alguien
// lo reporte como bug de "no pasa nada al tocar el botón".
const SRC_DIR = path.join(__dirname, '..', '..');
const ARCHIVO_PERMITIDO = 'lib/crossPlatformAlert.ts';

// __tests__ queda afuera del escaneo a propósito: es donde vive ESTE mismo
// test (sus propios describe/it mencionan "Alert.alert(" como texto
// descriptivo, no como código real) y donde ya viven los tests que prueban
// MessageModal/crossPlatformAlert citando el nombre viejo en comentarios --
// nada de eso es código de la app que se empaqueta ni corre en el
// dispositivo del socio.
function listarArchivosFuente(dir: string): string[] {
  const resultado: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      resultado.push(...listarArchivosFuente(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      resultado.push(full);
    }
  }
  return resultado;
}

describe('Alert.alert() no puede vivir fuera de crossPlatformAlert.ts (es un no-op mudo en Web)', () => {
  it('ningún archivo de src/ llama a Alert.alert( directo -- todo pasa por showAlert()/MessageModal', () => {
    const infractores: string[] = [];

    for (const archivo of listarArchivosFuente(SRC_DIR)) {
      const rutaRelativa = path.relative(SRC_DIR, archivo).replace(/\\/g, '/');
      if (rutaRelativa === ARCHIVO_PERMITIDO) continue; // el propio wrapper -- ahí es intencional.

      const contenido = fs.readFileSync(archivo, 'utf-8');
      contenido.split('\n').forEach((lineaCruda, i) => {
        const linea = lineaCruda.split('//')[0]; // ignora comentarios de línea (el resto del código sí es real)
        if (/\bAlert\.alert\s*\(/.test(linea)) {
          infractores.push(`${rutaRelativa}:${i + 1}`);
        }
      });
    }

    expect(infractores).toEqual([]);
  });
});
