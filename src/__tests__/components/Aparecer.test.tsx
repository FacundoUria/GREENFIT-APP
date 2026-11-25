import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import Aparecer, { retrasosPorPosicion } from '../../components/Aparecer';
import { APARICION } from '../../theme/motion';

// Aparecer: la aparición de la tanda visual (fade + 24 px, una vez, en
// cascada). La animación es CSS y solo existe en web: la cubre
// e2e/apariciones.spec.ts en un navegador real. Acá, el orden de la cascada
// y que en nativo no cambie nada.

describe('retrasosPorPosicion (la cascada sale de la posición en pantalla)', () => {
  it('de arriba abajo: 0, 60, 120 ms, devueltos en el mismo orden en que llegan las cajas', () => {
    const cajas = [
      { top: 300, left: 0 },
      { top: 100, left: 0 },
      { top: 200, left: 0 },
    ];
    expect(retrasosPorPosicion(cajas)).toEqual([120, 0, 60]);
  });

  it('misma fila (un carrusel): de izquierda a derecha, aunque el top difiera por decimales', () => {
    const cajas = [
      { top: 50.4, left: 254 },
      { top: 50.2, left: 20 },
      { top: 50.0, left: 137 },
    ];
    expect(retrasosPorPosicion(cajas)).toEqual([120, 0, 60]);
  });

  it('tope de la cascada: del 7.º en adelante, todos esperan lo mismo (una lista larga no se hace esperar)', () => {
    const cajas = Array.from({ length: 10 }, (_, i) => ({ top: i * 100, left: 0 }));
    const tope = APARICION.topeCascada * APARICION.cascada;
    expect(retrasosPorPosicion(cajas)).toEqual([0, 60, 120, 180, 240, 300, tope, tope, tope, tope]);
  });

  it('sin cajas, sin retrasos', () => {
    expect(retrasosPorPosicion([])).toEqual([]);
  });
});

describe('Aparecer en nativo', () => {
  it('muestra el contenido tal cual, con el estilo y el testID que se le pasen y sin animación', () => {
    const { getByText, getByTestId } = render(
      <Aparecer style={{ flex: 1 }} testID="seccion">
        <Text>Créditos</Text>
      </Aparecer>
    );
    expect(getByText('Créditos')).toBeTruthy();
    const estilo = StyleSheet.flatten(getByTestId('seccion').props.style) ?? {};
    expect(estilo).toEqual({ flex: 1 });
  });
});
