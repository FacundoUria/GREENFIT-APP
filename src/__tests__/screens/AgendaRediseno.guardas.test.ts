import fs from 'fs';
import path from 'path';

// Guardas del rediseño visual de Agenda (mockup "Agenda - GreenFit"): lee el
// CÓDIGO FUENTE y falla si aparece un dato de ejemplo del mockup, el total de
// créditos del header (no existe: los créditos son por disciplina y sumarlos
// engañaría al socio), un color hex suelto (la paleta del mockup vive SOLO en
// theme/agendaMockup.ts, copiada tal cual a pedido del cliente), o si el
// selector deja de mostrar 10 días. Mismo criterio que HomeRediseno y
// UserRoutineScreen.guardas.

const RAIZ = path.resolve(__dirname, '../..');
const ARCHIVOS = ['screens/user/AgendaMobileView.tsx', 'components/DaySelector.tsx'];

function codigoSinComentarios(archivo: string): string {
  const codigo = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PROHIBIDOS: [string, RegExp][] = [
  ['total de créditos del mockup ("15 créditos")', /\d+\s*créditos/i],
  ['ícono "bolt" del pill de créditos del mockup', /['"]bolt['"]/],
  ['nombre de usuario de ejemplo', /Facundo/],
  ['URL de avatar del mockup', /googleusercontent/],
  ['fecha de ejemplo del mockup', /24 de Septiembre/i],
  ['hex suelto (la paleta va en theme/agendaMockup.ts)', /#[0-9a-fA-F]{3,8}\b/],
];

describe('rediseño de Agenda -- guardas', () => {
  for (const archivo of ARCHIVOS) {
    it.each(PROHIBIDOS)(`${archivo}: no contiene %s`, (_descripcion, regex) => {
      expect(regex.test(codigoSinComentarios(archivo))).toBe(false);
    });
  }

  it('el selector sigue mostrando 10 días por defecto (hoy + 9)', () => {
    expect(codigoSinComentarios('components/DaySelector.tsx')).toMatch(/daysAhead\s*=\s*10\b/);
  });

  it('la tarjeta sigue siendo UN solo elemento tocable: un único onPress en renderItem', () => {
    const codigo = codigoSinComentarios('screens/user/AgendaMobileView.tsx');
    const renderItem = codigo.slice(codigo.indexOf('function renderItem'), codigo.indexOf('\n  return (\n    <View style={styles.container}>'));
    expect(renderItem.match(/onPress=/g)).toHaveLength(1);
    expect(renderItem).toContain('onPress={() => handlePress(item)}');
    expect(renderItem).toContain('pointerEvents="none"');
  });
});
