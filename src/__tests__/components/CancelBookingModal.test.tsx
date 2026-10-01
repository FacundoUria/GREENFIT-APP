import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CancelBookingModal from '../../components/CancelBookingModal';

// CAMBIO real (ticket "cancel_booking bloquea dentro del tiempo de gracia"):
// antes, `withinCancelLimit` solo significaba "no se te reintegra el
// crédito" -- la cancelación se dejaba pasar igual. Ahora el servidor la
// rechaza del todo, así que este modal deja de ofrecer un botón "Confirmar
// cancelación" condenado a fallar: lo deshabilita y cambia el aviso para
// avisar ESO, no el reintegro.
describe('CancelBookingModal', () => {
  // Mismo criterio que BookingConfirmModal: el socio ve la FECHA de la
  // reserva que está por cancelar, no solo el nombre de la clase.
  it('muestra la fecha de la reserva que se va a cancelar', () => {
    const { getByText } = render(
      <CancelBookingModal
        visible
        className="CrossFit"
        dateLabel="Mañana, viernes 2 de octubre"
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />
    );
    expect(getByText('Cancelar CrossFit')).toBeTruthy();
    expect(getByText('Mañana, viernes 2 de octubre')).toBeTruthy();
  });

  it('sin fecha (dateLabel ausente) no dibuja una línea vacía', () => {
    const { queryByText } = render(
      <CancelBookingModal visible className="CrossFit" onClose={jest.fn()} onConfirm={jest.fn()} />
    );
    expect(queryByText(/^(Hoy|Mañana), /)).toBeNull();
  });

  it('fuera de la ventana (withinCancelLimit=false): sin aviso, "Confirmar cancelación" habilitado y funcional', () => {
    const onConfirm = jest.fn();
    const { getByText, queryByText, getByTestId } = render(
      <CancelBookingModal
        visible
        className="CrossFit"
        withinCancelLimit={false}
        limiteMinutos={120}
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(queryByText(/no podés cancelarla/)).toBeNull();
    fireEvent.press(getByTestId('cancel-booking-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('dentro de la ventana (withinCancelLimit=true): avisa "no podés cancelarla" (ya no "no se reintegra el crédito") y deshabilita el botón', () => {
    const onConfirm = jest.fn();
    const { getByText, queryByText, getByTestId } = render(
      <CancelBookingModal
        visible
        className="CrossFit"
        withinCancelLimit
        limiteMinutos={10}
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(getByText('Faltan menos de 10 minutos para que empiece la clase: no podés cancelarla.')).toBeTruthy();
    expect(queryByText(/no se reintegra el crédito/)).toBeNull();

    fireEvent.press(getByTestId('cancel-booking-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('dentro de la ventana, el aviso también formatea en horas cuando corresponde (mismo formatLimite de siempre)', () => {
    const { getByText } = render(
      <CancelBookingModal
        visible
        className="CrossFit"
        withinCancelLimit
        limiteMinutos={120}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />
    );

    expect(getByText('Faltan menos de 2 horas para que empiece la clase: no podés cancelarla.')).toBeTruthy();
  });

  it('isSubmitting sigue deshabilitando el botón igual que antes, sin importar withinCancelLimit', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <CancelBookingModal
        visible
        className="CrossFit"
        withinCancelLimit={false}
        isSubmitting
        limiteMinutos={120}
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.press(getByTestId('cancel-booking-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Volver" sigue funcionando igual, dentro o fuera de la ventana', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <CancelBookingModal
        visible
        className="CrossFit"
        withinCancelLimit
        limiteMinutos={10}
        onClose={onClose}
        onConfirm={jest.fn()}
      />
    );

    fireEvent.press(getByText('Volver'));
    expect(onClose).toHaveBeenCalled();
  });
});
