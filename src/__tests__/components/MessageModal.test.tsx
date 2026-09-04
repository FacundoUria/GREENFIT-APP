import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MessageModal from '../../components/MessageModal';

// Reemplazo de Alert.alert(title, message) -- ver crossPlatformAlert.ts
// sobre por qué (Alert.alert es un no-op literal en react-native-web,
// así que en la PWA no mostraba NADA).
describe('MessageModal', () => {
  it('no renderiza nada sin contenido', () => {
    const { toJSON } = render(<MessageModal content={null} onClose={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('muestra título y mensaje cuando hay contenido', () => {
    const { getByText } = render(
      <MessageModal content={{ title: 'Sin cupo', message: 'Esta clase ya no tiene lugares disponibles.' }} onClose={jest.fn()} />
    );
    expect(getByText('Sin cupo')).toBeTruthy();
    expect(getByText('Esta clase ya no tiene lugares disponibles.')).toBeTruthy();
  });

  it('llama a onClose al tocar "Entendido"', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <MessageModal content={{ title: 'Reserva cancelada', message: 'Te devolvimos el crédito.' }} onClose={onClose} />
    );
    fireEvent.press(getByText('Entendido'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // actionLabel/onAction (nuevo, opcional -- ej. "Completar mis datos" en
  // el gate de contacto de emergencia de AgendaMobileView).
  describe('acción opcional (actionLabel/onAction)', () => {
    it('sin actionLabel/onAction, el comportamiento es EXACTAMENTE el de antes: un solo botón "Entendido", sin "Cerrar"', () => {
      const { getByText, queryByText } = render(
        <MessageModal content={{ title: 'Sin cupo', message: 'Esta clase ya no tiene lugares disponibles.' }} onClose={jest.fn()} />
      );
      expect(getByText('Entendido')).toBeTruthy();
      expect(queryByText('Cerrar')).toBeNull();
    });

    it('con actionLabel/onAction, el botón principal usa ese label y, al tocarlo, cierra Y dispara la acción', () => {
      const onClose = jest.fn();
      const onAction = jest.fn();
      const { getByText, queryByText } = render(
        <MessageModal
          content={{
            title: 'Completá tu contacto de emergencia',
            message: 'Para poder reservar...',
            actionLabel: 'Completar mis datos',
            onAction,
          }}
          onClose={onClose}
        />
      );

      expect(queryByText('Entendido')).toBeNull();
      fireEvent.press(getByText('Completar mis datos'));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('"Cerrar" (botón secundario) solo cierra -- no dispara onAction', () => {
      const onClose = jest.fn();
      const onAction = jest.fn();
      const { getByText } = render(
        <MessageModal
          content={{ title: 'x', message: 'y', actionLabel: 'Completar mis datos', onAction }}
          onClose={onClose}
        />
      );

      fireEvent.press(getByText('Cerrar'));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onAction).not.toHaveBeenCalled();
    });
  });
});
