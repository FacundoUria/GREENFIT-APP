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
});
