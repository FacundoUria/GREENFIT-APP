import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import BookingConfirmModal from '../../components/BookingConfirmModal';
import { CONSENT_TEXT_SHORT } from '../../lib/consentApi';

const TARGET = {
  title: 'CrossFit',
  dateLabel: 'Hoy, jueves 1 de octubre',
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

  // Bug real: el modal mostraba la hora pero no la fecha -- con la lista de
  // Agenda pisada por una respuesta atrasada, el socio confirmaba una clase
  // de OTRO día sin poder notarlo.
  it('muestra la FECHA de la clase que se va a reservar, no solo la hora', () => {
    const { getByText } = render(
      <BookingConfirmModal visible target={TARGET} onClose={jest.fn()} onConfirm={jest.fn()} />
    );
    expect(getByText('Hoy, jueves 1 de octubre')).toBeTruthy();
  });

  it('muestra la clase y el horario a confirmar', () => {
    const { getByText } = render(
      <BookingConfirmModal visible target={TARGET} onClose={jest.fn()} onConfirm={jest.fn()} />
    );
    expect(getByText('Reservar CrossFit')).toBeTruthy();
    expect(getByText(/19:00 - 20:00 hs · Prof\. Seba · Box 1/)).toBeTruthy();
  });

  // Tanda EC -- reservar una clase en curso: el modal lo dice.
  it('con aviso (clase en curso), lo muestra; sin aviso, no dibuja nada extra', () => {
    const { getByText, rerender, queryByText } = render(
      <BookingConfirmModal
        visible
        target={{ ...TARGET, aviso: 'La clase ya empezó: termina a las 20:00 hs.' }}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />
    );
    expect(getByText('La clase ya empezó: termina a las 20:00 hs.')).toBeTruthy();

    rerender(<BookingConfirmModal visible target={TARGET} onClose={jest.fn()} onConfirm={jest.fn()} />);
    expect(queryByText(/ya empezó/)).toBeNull();
  });

  // Reafirmación corta de salud (segundo gate, coexiste con el
  // consentimiento informado completo de ConsentModal -- ver consentApi.ts):
  // se pide SIEMPRE, en cada reserva, y "Confirmar" no habilita hasta
  // marcarla.
  it('muestra el texto corto de reafirmación de salud', () => {
    const { getByText } = render(
      <BookingConfirmModal visible target={TARGET} onClose={jest.fn()} onConfirm={jest.fn()} />
    );
    expect(getByText(CONSENT_TEXT_SHORT)).toBeTruthy();
  });

  it('"Confirmar" arranca deshabilitado hasta marcar la reafirmación de salud', () => {
    const onConfirm = jest.fn();
    const { getByText } = render(
      <BookingConfirmModal visible target={TARGET} onClose={jest.fn()} onConfirm={onConfirm} />
    );
    fireEvent.press(getByText('Confirmar'));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.press(getByText(CONSENT_TEXT_SHORT));
    fireEvent.press(getByText('Confirmar'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('llama a onConfirm al tocar "Confirmar" (con la reafirmación marcada) y a onClose al tocar "Cancelar"', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    const { getByText } = render(
      <BookingConfirmModal visible target={TARGET} onClose={onClose} onConfirm={onConfirm} />
    );
    fireEvent.press(getByText(CONSENT_TEXT_SHORT));
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

  it('reabrir el modal (visible pasa a true de nuevo) resetea la reafirmación destildada', () => {
    const onConfirm = jest.fn();
    const { getByText, rerender } = render(
      <BookingConfirmModal visible={false} target={TARGET} onClose={jest.fn()} onConfirm={onConfirm} />
    );
    rerender(<BookingConfirmModal visible target={TARGET} onClose={jest.fn()} onConfirm={onConfirm} />);

    fireEvent.press(getByText('Confirmar'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// Rendimiento de la Agenda en gama baja: PrecalentarHojaReserva maqueta el
// texto de la hoja una vez, invisible, en web (ver e2e/hojas.spec.ts). En
// nativo no dibuja nada y avisa que terminó enseguida.
describe('PrecalentarHojaReserva (nativo)', () => {
  it('no dibuja nada y llama a onListo', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrecalentarHojaReserva } = require('../../components/BookingConfirmModal');
    const onListo = jest.fn();
    const { toJSON, queryByText } = render(<PrecalentarHojaReserva onListo={onListo} />);
    expect(toJSON()).toBeNull();
    expect(queryByText(CONSENT_TEXT_SHORT)).toBeNull();
    expect(onListo).toHaveBeenCalledTimes(1);
  });
});
