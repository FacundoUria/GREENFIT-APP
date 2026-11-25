import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import Esqueleto from '../../components/Esqueleto';
import { EsqueletoAgenda, EsqueletoCreditos, EsqueletoEntrenamientos, EsqueletoRutina, EsqueletoTarjetas } from '../../components/Esqueletos';
import { __resetReducirMovimientoParaTests } from '../../hooks/useReducirMovimiento';

// Esqueletos: en vez de la ruedita, la forma de lo que va a aparecer. Para
// lectores de pantalla siguen siendo una barra de progreso "Cargando" (como
// la ruedita). El pulso es CSS y solo existe en web (e2e/apariciones.spec.ts).

beforeEach(() => {
  __resetReducirMovimientoParaTests();
  jest.restoreAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});

describe('Esqueleto', () => {
  it('es una barra de progreso "Cargando" con su contenido adentro', () => {
    const { getByLabelText, getByText } = render(
      <Esqueleto testID="e">
        <Text>bloque</Text>
      </Esqueleto>
    );
    expect(getByLabelText('Cargando').props.accessibilityRole).toBe('progressbar');
    expect(getByText('bloque')).toBeTruthy();
  });

  it('con "reducir movimiento" también se muestra (quieto)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { getByTestId } = render(<Esqueleto testID="e" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getByTestId('e')).toBeTruthy();
  });
});

describe('esqueletos de cada pantalla', () => {
  it.each([
    ['Agenda', <EsqueletoAgenda key="a" />, 'agenda-esqueleto'],
    ['créditos de Inicio', <EsqueletoCreditos key="c" />, 'creditos-esqueleto'],
    ['Rutina de hoy', <EsqueletoRutina key="r" />, 'rutina-esqueleto'],
    ['Entrenamientos', <EsqueletoEntrenamientos key="e" />, 'entrenamientos-esqueleto'],
    ['Mis rutinas', <EsqueletoTarjetas key="t" testID="mis-rutinas-esqueleto" />, 'mis-rutinas-esqueleto'],
  ])('%s: se dibuja con su testID y como "Cargando"', (_nombre, elemento, testID) => {
    const { getByTestId } = render(elemento);
    const esqueleto = getByTestId(testID);
    expect(esqueleto.props.accessibilityRole).toBe('progressbar');
    expect(esqueleto.props.accessibilityLabel).toBe('Cargando');
  });

  it('la cantidad de tarjetas se puede elegir', () => {
    const { getByTestId } = render(<EsqueletoTarjetas cantidad={2} testID="t" />);
    expect(getByTestId('t').props.children).toHaveLength(2);
  });
});
