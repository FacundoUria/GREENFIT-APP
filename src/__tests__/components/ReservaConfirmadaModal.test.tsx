import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ReservaConfirmadaModal from '../../components/ReservaConfirmadaModal';
import * as calendarShare from '../../lib/calendarShare';

jest.mock('../../lib/calendarShare', () => ({
  addToCalendar: jest.fn().mockResolvedValue(undefined),
  shareReserva: jest.fn().mockResolvedValue('shared'),
}));

const RESERVA = {
  disciplina: 'CrossFit',
  startAt: new Date('2026-08-10T19:00:00').toISOString(),
  endAt: new Date('2026-08-10T20:00:00').toISOString(),
  instructor: 'Seba',
  location: 'Box 1',
};

describe('ReservaConfirmadaModal (Módulo 1 -- confirmación gamificada)', () => {
  afterEach(() => jest.clearAllMocks());

  it('no renderiza nada si todavía no hay reserva confirmada', () => {
    const { toJSON } = render(<ReservaConfirmadaModal visible reserva={null} onClose={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('muestra el resumen de la clase (disciplina, profe, box) cuando está visible', () => {
    const { getByText } = render(<ReservaConfirmadaModal visible reserva={RESERVA} onClose={jest.fn()} />);
    expect(getByText('¡Reserva confirmada!')).toBeTruthy();
    expect(getByText('CrossFit')).toBeTruthy();
    expect(getByText('Prof. Seba')).toBeTruthy();
    expect(getByText('Box 1')).toBeTruthy();
  });

  it('llama a addToCalendar al tocar "Agendar"', async () => {
    const { getByText } = render(<ReservaConfirmadaModal visible reserva={RESERVA} onClose={jest.fn()} />);
    fireEvent.press(getByText('Agendar'));
    await waitFor(() => expect(calendarShare.addToCalendar).toHaveBeenCalledTimes(1));
  });

  it('llama a shareReserva al tocar "Compartir"', async () => {
    const { getByText } = render(<ReservaConfirmadaModal visible reserva={RESERVA} onClose={jest.fn()} />);
    fireEvent.press(getByText('Compartir'));
    await waitFor(() => expect(calendarShare.shareReserva).toHaveBeenCalledTimes(1));
  });

  it('cierra el modal al tocar "Listo"', () => {
    const onClose = jest.fn();
    const { getByText } = render(<ReservaConfirmadaModal visible reserva={RESERVA} onClose={onClose} />);
    fireEvent.press(getByText('Listo'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
