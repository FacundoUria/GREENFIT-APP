import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalAlertBanner from '../../components/GlobalAlertBanner';

describe('GlobalAlertBanner (Alerta Global / Anuncio Flotante)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('no muestra nada si la alerta está desactivada', () => {
    const { queryByText } = render(<GlobalAlertBanner activa={false} mensaje="El sábado cerramos a las 14 hs" />);
    expect(queryByText('El sábado cerramos a las 14 hs')).toBeNull();
  });

  it('no muestra nada si está activada pero el mensaje quedó vacío', () => {
    const { queryByText } = render(<GlobalAlertBanner activa mensaje="   " />);
    expect(queryByText('¿')).toBeNull();
  });

  it('muestra el mensaje cuando está activa y tiene texto', async () => {
    const { findByText } = render(<GlobalAlertBanner activa mensaje="El sábado cerramos a las 14 hs" />);
    expect(await findByText('El sábado cerramos a las 14 hs')).toBeTruthy();
  });

  it('al tocar la X, desaparece y recuerda el descarte para ese mismo mensaje', async () => {
    const mensaje = 'El sábado cerramos a las 14 hs';
    const { findByText, getByLabelText, queryByText, unmount } = render(<GlobalAlertBanner activa mensaje={mensaje} />);
    await findByText(mensaje);

    fireEvent.press(getByLabelText('Cerrar aviso'));
    await waitFor(() => expect(queryByText(mensaje)).toBeNull());

    unmount();

    // Un remount con EL MISMO mensaje (ej. volver a abrir la app) no lo
    // vuelve a mostrar -- ya se descartó.
    const segundo = render(<GlobalAlertBanner activa mensaje={mensaje} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(segundo.queryByText(mensaje)).toBeNull();
  });

  it('un mensaje NUEVO del admin sí se muestra aunque el anterior ya se haya descartado', async () => {
    const primero = 'El sábado cerramos a las 14 hs';
    const segundo = 'Nuevo horario de Aparatos los domingos';

    const { findByText, getByLabelText, queryByText } = render(<GlobalAlertBanner activa mensaje={primero} />);
    await findByText(primero);
    fireEvent.press(getByLabelText('Cerrar aviso'));
    await waitFor(() => expect(queryByText(primero)).toBeNull());

    const otro = render(<GlobalAlertBanner activa mensaje={segundo} />);
    expect(await otro.findByText(segundo)).toBeTruthy();
  });
});
