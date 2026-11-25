import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import ZonaSegura, { useInsetsSeguros } from '../../components/ZonaSegura';

// La zona segura de ARRIBA (notch / barra de estado con la app instalada) se
// aplica una sola vez, en la raíz; adentro todos ven top = 0 para que los
// headers de react-navigation no la sumen de nuevo. La de abajo pasa intacta.

function MostrarInsets() {
  const i = useInsetsSeguros();
  return <Text>{`top=${i.top} bottom=${i.bottom}`}</Text>;
}

describe('ZonaSegura', () => {
  it('aplica el inset de arriba como padding y adentro deja top = 0 (el de abajo sigue)', () => {
    const { getByTestId, getByText } = render(
      <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
        <ZonaSegura style={{ flex: 1 }} testID="zona">
          <MostrarInsets />
        </ZonaSegura>
      </SafeAreaInsetsContext.Provider>
    );
    expect(getByText('top=0 bottom=34')).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId('zona').props.style)).toMatchObject({ flex: 1, paddingTop: 47 });
  });

  it('sin provider (tests, o antes de medir): todo en 0, sin romper', () => {
    const { getByText } = render(<MostrarInsets />);
    expect(getByText('top=0 bottom=0')).toBeTruthy();
  });
});
