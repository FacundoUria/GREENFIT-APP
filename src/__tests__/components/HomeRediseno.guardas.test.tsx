import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import Svg, { Circle } from 'react-native-svg';
import XpProgressRing from '../../components/XpProgressRing';

// Guardas del rediseño de Inicio (mockup HTML): el componente NUNCA puede
// llevar datos de ejemplo del mockup escritos a mano -- todo sale de
// user_credits / disciplines / xp_events / notifications. Este test lee el
// CÓDIGO FUENTE de los archivos del rediseño y falla si aparece alguno de los
// valores de ejemplo (nombres de disciplina, números, fecha, % fijo del
// anillo, URL de avatar, nombre de usuario).

const RAIZ = path.resolve(__dirname, '../..');
const ARCHIVOS = [
  'screens/user/HomeScreen.tsx',
  'components/CreditosCarousel.tsx',
  'components/VencimientoCard.tsx',
  'components/XpProgressRing.tsx',
  'components/HoyEntreneButton.tsx',
];

// Valores de ejemplo que trae el mockup y que NO pueden estar en el código.
const VALORES_DE_EJEMPLO: [string, RegExp][] = [
  ['nombre de usuario de ejemplo', /Facundo/],
  ['disciplina de ejemplo "Crossfit"', /['">]\s*Crossfit\s*['"<]/i],
  ['disciplina de ejemplo "Boxeo"', /['">]\s*Boxeo\s*['"<]/],
  ['disciplina de ejemplo "Funcional"', /['">]\s*Funcional\s*['"<]/],
  ['disciplina de ejemplo "Kickstrike"', /['">]\s*Kickstrike\s*['"<]/i],
  ['disciplina de ejemplo "Aparatos"', /['">]\s*Aparatos\s*['"<]/],
  ['fecha de ejemplo "24 de Octubre"', /24 de Octubre/i],
  ['año de ejemplo 2026 escrito a mano', /\b2026\b/],
  ['racha de ejemplo "5 días"', /5 días/],
  ['progreso fijo 65%', /\b65\s*%|0\.65\b/],
  ['dashoffset fijo del mockup (197.9)', /197\.9/],
  ['circunferencia fija del mockup (565.48)', /565\.48/],
  ['URL de avatar del mockup', /googleusercontent/],
  ['nivel de ejemplo "NIVEL 2" fijo', /['">]\s*2\s*['"<]/],
];

describe('rediseño de Inicio -- ningún valor de ejemplo del mockup escrito a mano', () => {
  it.each(ARCHIVOS)('%s no contiene valores de ejemplo del mockup', (archivo) => {
    const codigo = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
    // Se ignoran los comentarios: los tests/explicaciones pueden nombrar
    // ejemplos, el código que se ejecuta no.
    const sinComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const [descripcion, regex] of VALORES_DE_EJEMPLO) {
      expect({ archivo, descripcion, hallado: regex.test(sinComentarios) }).toEqual({
        archivo,
        descripcion,
        hallado: false,
      });
    }
  });
});

describe('XpProgressRing -- arco dinámico y bordes', () => {
  const RADIO = (200 - 7 * 4) / 2;
  const CIRC = 2 * Math.PI * RADIO;
  const arco = () => Number(screen.getByTestId('nivel-ring-arco').props.strokeDashoffset);

  it('sin XP en el nivel: el arco está vacío (offset = circunferencia completa)', () => {
    render(<XpProgressRing xpEnNivel={0} xpParaNivel={500} nivel={1} />);
    expect(arco()).toBeCloseTo(CIRC, 3);
  });

  it('a mitad del nivel: el arco queda a la mitad', () => {
    render(<XpProgressRing xpEnNivel={250} xpParaNivel={500} nivel={4} />);
    expect(arco()).toBeCloseTo(CIRC / 2, 3);
  });

  it('un xpEnNivel fuera de rango se acota a [0, 100%] (nunca un arco negativo ni mayor al círculo)', () => {
    const { unmount } = render(<XpProgressRing xpEnNivel={9999} xpParaNivel={500} nivel={2} />);
    expect(arco()).toBeCloseTo(0, 3);
    unmount();
    render(<XpProgressRing xpEnNivel={-30} xpParaNivel={500} nivel={2} />);
    expect(arco()).toBeCloseTo(CIRC, 3);
  });

  it('xpParaNivel = 0 no divide por cero: arco vacío', () => {
    render(<XpProgressRing xpEnNivel={10} xpParaNivel={0} nivel={2} />);
    expect(arco()).toBeCloseTo(CIRC, 3);
  });

  it('el centro muestra el número de nivel que recibe (no uno fijo) y NO escribe el XP como texto', () => {
    render(<XpProgressRing xpEnNivel={137} xpParaNivel={500} nivel={17} />);
    expect(screen.getByTestId('nivel-numero').props.children).toBe(17);
    expect(screen.queryByText(/137/)).toBeNull();
    expect(screen.queryByText(/500/)).toBeNull();
    expect(screen.getByLabelText('Nivel 17')).toBeTruthy();
  });

  it('sigue siendo react-native-svg real (Circle de riel + arcos)', () => {
    const { UNSAFE_getAllByType } = render(<XpProgressRing xpEnNivel={10} xpParaNivel={500} nivel={1} />);
    expect(UNSAFE_getAllByType(Svg)).toHaveLength(1);
    expect(UNSAFE_getAllByType(Circle).length).toBeGreaterThanOrEqual(2);
  });
});
