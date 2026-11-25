import React from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import Tocable from '../../components/Tocable';
import { __resetReducirMovimientoParaTests } from '../../hooks/useReducirMovimiento';
import { TOQUE } from '../../theme/motion';

// Tocable: el toque de la tanda visual. Con el dedo apoyado se achica a 0.96
// en vez de parpadear con opacidad, pero recién después de TOQUE.retardo (80
// ms): si en ese tiempo arranca un scroll, no se achica (en web, un scroll lo
// cancela -- eso lo cubre e2e/rendimiento.spec.ts). Un toque completado más
// corto se ve como un pulso; uno cancelado (el scroll se llevó el dedo), no.
// Con "reducir movimiento", fade en vez de escala.

function estilo(el: any) {
  return StyleSheet.flatten(el.props.style) ?? {};
}

beforeEach(() => {
  __resetReducirMovimientoParaTests();
  jest.restoreAllMocks();
  // isReduceMotionEnabled ya es un jest.fn en el mock de RN: spyOn devuelve el
  // mismo, y el `true` de un test quedaría puesto para el siguiente.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Tocable', () => {
  it('toca: llama a onPress (y a los onPressIn/onPressOut que se le pasen) y muestra su contenido', () => {
    const onPress = jest.fn();
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    const { getByText } = render(
      <Tocable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        <Text>Reservar</Text>
      </Tocable>
    );
    fireEvent(getByText('Reservar'), 'pressIn');
    fireEvent(getByText('Reservar'), 'pressOut');
    fireEvent.press(getByText('Reservar'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPressIn).toHaveBeenCalled();
    expect(onPressOut).toHaveBeenCalled();
  });

  it('con el dedo apoyado: nada antes del retardo, escala 0.96 después; al soltar vuelve', () => {
    const { getByTestId } = render(
      <Tocable testID="t" style={{ padding: 4 }}>
        <Text>Hola</Text>
      </Tocable>
    );
    fireEvent(getByTestId('t'), 'pressIn');
    act(() => jest.advanceTimersByTime(TOQUE.retardo - 1));
    expect(estilo(getByTestId('t')).transform).toBeUndefined();

    act(() => jest.advanceTimersByTime(1));
    expect(estilo(getByTestId('t'))).toMatchObject({ padding: 4, transform: [{ scale: 0.96 }] });

    fireEvent(getByTestId('t'), 'pressOut');
    expect(estilo(getByTestId('t')).transform).toBeUndefined();
  });

  it('toque rápido (más corto que el retardo): pulso breve al completarse', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Tocable testID="t" onPress={onPress}>
        <Text>Hola</Text>
      </Tocable>
    );
    fireEvent(getByTestId('t'), 'pressIn');
    act(() => jest.advanceTimersByTime(30));
    fireEvent(getByTestId('t'), 'pressOut');
    fireEvent.press(getByTestId('t'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(estilo(getByTestId('t')).transform).toEqual([{ scale: 0.96 }]);

    act(() => jest.advanceTimersByTime(TOQUE.pulso));
    expect(estilo(getByTestId('t')).transform).toBeUndefined();
  });

  it('toque cancelado antes del retardo (el scroll se llevó el dedo): ni achique ni pulso', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Tocable testID="t" onPress={onPress}>
        <Text>Hola</Text>
      </Tocable>
    );
    fireEvent(getByTestId('t'), 'pressIn');
    act(() => jest.advanceTimersByTime(20));
    fireEvent(getByTestId('t'), 'pressOut'); // sin onPress: cancelado
    expect(estilo(getByTestId('t')).transform).toBeUndefined();
    act(() => jest.advanceTimersByTime(TOQUE.retardo + TOQUE.pulso));
    expect(estilo(getByTestId('t')).transform).toBeUndefined();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('deshabilitado: no se achica ni llama a onPress', () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = render(
      <Tocable testID="t" disabled onPress={onPress}>
        <Text>Hola</Text>
      </Tocable>
    );
    fireEvent(getByTestId('t'), 'pressIn');
    act(() => jest.advanceTimersByTime(TOQUE.retardo + 10));
    expect(estilo(getByTestId('t')).transform).toBeUndefined();
    fireEvent.press(getByText('Hola'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('con "reducir movimiento": fade (opacidad) en vez de escala', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { getByTestId } = render(
      <Tocable testID="t">
        <Text>Hola</Text>
      </Tocable>
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent(getByTestId('t'), 'pressIn');
    act(() => jest.advanceTimersByTime(TOQUE.retardo));
    await waitFor(() => expect(estilo(getByTestId('t')).opacity).toBe(TOQUE.opacidadReducida));
    expect(estilo(getByTestId('t')).transform).toBeUndefined();
  });

  it('conserva la accesibilidad que se le pasa (rol, estado y etiqueta)', () => {
    const { getByLabelText } = render(
      <Tocable accessibilityRole="checkbox" accessibilityState={{ checked: true }} accessibilityLabel="Sentadilla, completado">
        <Text>✓</Text>
      </Tocable>
    );
    const el = getByLabelText('Sentadilla, completado');
    expect(el.props.accessibilityRole).toBe('checkbox');
    expect(el.props.accessibilityState).toMatchObject({ checked: true });
  });
});
