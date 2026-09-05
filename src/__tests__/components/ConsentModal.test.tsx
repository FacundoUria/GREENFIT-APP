import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ConsentModal from '../../components/ConsentModal';

const ACEPTO_LABEL =
  'Acepto la declaración de salud, el consentimiento informado y las condiciones de participación.';
const NO_ACEPTO_LABEL = 'No acepto.';

// Segundo gate de reserva (coexiste con el de contacto de emergencia, ver
// AgendaMobileView.tsx) -- pantalla completa con el texto legal exacto,
// mostrada solo cuando al socio le falta la versión vigente de
// CONSENT_VERSION (consentApi.ts).
describe('ConsentModal', () => {
  it('muestra el texto legal completo (título y cierre), sin parafrasear', () => {
    const { getByText } = render(
      <ConsentModal visible onClose={jest.fn()} onAccept={jest.fn()} />
    );
    expect(getByText(/Declaración de salud y consentimiento para realizar actividad física/)).toBeTruthy();
    expect(
      getByText(/Declaro haber leído y comprendido esta información y acepto las condiciones de ingreso/)
    ).toBeTruthy();
    expect(getByText(ACEPTO_LABEL)).toBeTruthy();
    expect(getByText(NO_ACEPTO_LABEL)).toBeTruthy();
  });

  it('"Continuar" arranca deshabilitado -- sin marcar nada no se puede avanzar', () => {
    const onAccept = jest.fn();
    const { getByText } = render(
      <ConsentModal visible onClose={jest.fn()} onAccept={onAccept} />
    );
    fireEvent.press(getByText('Continuar'));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('marcar "No acepto" NO habilita "Continuar"', () => {
    const onAccept = jest.fn();
    const { getByText } = render(
      <ConsentModal visible onClose={jest.fn()} onAccept={onAccept} />
    );
    fireEvent.press(getByText(NO_ACEPTO_LABEL));
    fireEvent.press(getByText('Continuar'));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('marcar "Acepto" y tocar "Continuar" llama a onAccept', () => {
    const onAccept = jest.fn();
    const { getByText } = render(
      <ConsentModal visible onClose={jest.fn()} onAccept={onAccept} />
    );
    fireEvent.press(getByText(ACEPTO_LABEL));
    fireEvent.press(getByText('Continuar'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('marcar "Acepto" y después "No acepto" (mutuamente excluyentes) vuelve a deshabilitar "Continuar"', () => {
    const onAccept = jest.fn();
    const { getByText } = render(
      <ConsentModal visible onClose={jest.fn()} onAccept={onAccept} />
    );
    fireEvent.press(getByText(ACEPTO_LABEL));
    fireEvent.press(getByText(NO_ACEPTO_LABEL));
    fireEvent.press(getByText('Continuar'));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('tocar "Volver" llama a onClose', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <ConsentModal visible onClose={onClose} onAccept={jest.fn()} />
    );
    fireEvent.press(getByText('Volver'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('deshabilita "Volver" y "Continuar" mientras isSubmitting está en curso', () => {
    const onAccept = jest.fn();
    const onClose = jest.fn();
    const { getByText, queryByText } = render(
      <ConsentModal visible isSubmitting onClose={onClose} onAccept={onAccept} />
    );
    // Con isSubmitting, el botón "Continuar" muestra un spinner en vez del texto.
    expect(queryByText('Continuar')).toBeNull();
    fireEvent.press(getByText('Volver'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reabrir el modal resetea la selección (no queda "Acepto" pre-marcado de una apertura anterior)', () => {
    const onAccept = jest.fn();
    const { getByText, rerender } = render(
      <ConsentModal visible onClose={jest.fn()} onAccept={onAccept} />
    );
    fireEvent.press(getByText(ACEPTO_LABEL));

    rerender(<ConsentModal visible={false} onClose={jest.fn()} onAccept={onAccept} />);
    rerender(<ConsentModal visible onClose={jest.fn()} onAccept={onAccept} />);

    fireEvent.press(getByText('Continuar'));
    expect(onAccept).not.toHaveBeenCalled();
  });
});
