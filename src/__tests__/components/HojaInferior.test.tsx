import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import HojaInferior from '../../components/HojaInferior';

// HojaInferior: la hoja que reemplaza a los modales de confirmación e
// información. La animación (sube en 600 ms, baja en 200) y el arrastre para
// cerrar son de web y los cubre e2e/hojas.spec.ts en un navegador real. Acá:
// que se muestre y se oculte con `visible`, que tocar afuera pida cerrar, y
// que con una acción en curso (`cerrable={false}`) no se pueda.

describe('HojaInferior', () => {
  it('oculta: no dibuja nada', () => {
    const { queryByText, queryByTestId } = render(
      <HojaInferior visible={false} onClose={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>
    );
    expect(queryByText('Contenido')).toBeNull();
    expect(queryByTestId('hoja-inferior')).toBeNull();
  });

  it('visible: muestra el contenido, con sus testID por defecto', () => {
    const { getByText, getByTestId } = render(
      <HojaInferior visible onClose={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>
    );
    expect(getByText('Contenido')).toBeTruthy();
    expect(getByTestId('hoja-inferior')).toBeTruthy();
    expect(getByTestId('hoja-inferior-fondo')).toBeTruthy();
  });

  it('acepta testID propios (para no romper los que ya usaban los tests)', () => {
    const { getByTestId } = render(
      <HojaInferior visible onClose={jest.fn()} testID="mi-hoja" testIDFondo="mi-fondo">
        <Text>Contenido</Text>
      </HojaInferior>
    );
    expect(getByTestId('mi-hoja')).toBeTruthy();
    expect(getByTestId('mi-fondo')).toBeTruthy();
  });

  it('tocar afuera pide cerrar', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <HojaInferior visible onClose={onClose}>
        <Text>Contenido</Text>
      </HojaInferior>
    );
    fireEvent.press(getByTestId('hoja-inferior-fondo'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('con una acción en curso (cerrable={false}), tocar afuera no la cierra', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <HojaInferior visible onClose={onClose} cerrable={false}>
        <Text>Contenido</Text>
      </HojaInferior>
    );
    fireEvent.press(getByTestId('hoja-inferior-fondo'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('al pasar a visible={false} se oculta', () => {
    const { rerender, queryByText } = render(
      <HojaInferior visible onClose={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>
    );
    rerender(
      <HojaInferior visible={false} onClose={jest.fn()}>
        <Text>Contenido</Text>
      </HojaInferior>
    );
    expect(queryByText('Contenido')).toBeNull();
  });
});
