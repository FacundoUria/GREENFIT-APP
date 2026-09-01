import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import BookingConfirmModal from '../../components/BookingConfirmModal';

const TARGET = {
  title: 'CrossFit',
  startLabel: '19:00',
  endLabel: '20:00',
  instructor: 'Seba',
  location: 'Box 1',
};

// Paso de confirmación antes de reservar (evita el one-tap accidental al
// scrollear) -- ver AgendaMobileView.tsx: el tap solo abre este modal, el
// RPC book_class recién se dispara al tocar "Confirmar".
describe('BookingConfirmModal', () => {
  it('no renderiza nada sin clase objetivo', () => {
    const { toJSON } = render(
      <BookingConfirmModal visible target={null} onClose={jest.fn()} onConfirm={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  it('muestra la clase y el horario a confirmar', () => {
    const { getByText } = render(
      <BookingConfirmModal visible target={TARGET} onClose={jest.fn()} onConfirm={jest.fn()} />
    );
    expect(getByText('Reservar CrossFit')).toBeTruthy();
    expect(getByText(/19:00 - 20:00 hs · Prof\. Seba · Box 1/)).toBeTruthy();
  });

  it('llama a onConfirm al tocar "Confirmar" y a onClose al tocar "Cancelar"', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    const { getByText } = render(
      <BookingConfirmModal visible target={TARGET} onClose={onClose} onConfirm={onConfirm} />
    );
    fireEvent.press(getByText('Confirmar'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('deshabilita ambos botones mientras isSubmitting está en curso (evita el doble tap)', () => {
    const onConfirm = jest.fn();
    const { getByText, queryByText } = render(
      <BookingConfirmModal visible target={TARGET} isSubmitting onClose={jest.fn()} onConfirm={onConfirm} />
    );
    // Con isSubmitting, el botón "Confirmar" muestra un spinner en vez del texto.
    expect(queryByText('Confirmar')).toBeNull();
    fireEvent.press(getByText('Cancelar'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
