import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RoutineCompleteModal from '../../components/RoutineCompleteModal';

describe('RoutineCompleteModal (rediseño Mi Rutina -- cierre gratificante)', () => {
  it('cuando se completaron todos los ejercicios, muestra el copy de rutina completa', () => {
    const { getByText } = render(<RoutineCompleteModal visible completos={3} total={3} onClose={jest.fn()} />);
    expect(getByText('¡Rutina completa! 🔥')).toBeTruthy();
    expect(getByText('Marcaste todos los ejercicios de hoy. ¡Constancia que suma!')).toBeTruthy();
  });

  it('con progreso parcial, muestra el copy de aliento en vez de "completa"', () => {
    const { getByText, queryByText } = render(<RoutineCompleteModal visible completos={1} total={3} onClose={jest.fn()} />);
    expect(getByText('¡Buen entrenamiento! 💪')).toBeTruthy();
    expect(getByText('Llevás 1 de 3 ejercicios de hoy -- lo que sumaste ya cuenta.')).toBeTruthy();
    expect(queryByText('¡Rutina completa! 🔥')).toBeNull();
  });

  it('llama a onClose al tocar "Genial"', () => {
    const onClose = jest.fn();
    const { getByText } = render(<RoutineCompleteModal visible completos={2} total={2} onClose={onClose} />);
    fireEvent.press(getByText('Genial'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
