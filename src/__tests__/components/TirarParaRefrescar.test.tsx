import React from 'react';
import { ScrollView, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { useTirarParaRefrescar } from '../../components/TirarParaRefrescar';
import { colors } from '../../theme/colors';

// Tirar para refrescar (tanda visual, parte 4). El gesto propio (touch, el
// indicador que sigue al dedo con transform, el umbral de 64 px y
// overscroll-behavior-y: contain) es de web y lo cubre e2e/refresco.spec.ts
// en un navegador real. Acá, nativo: queda el RefreshControl de siempre y
// envolver() no agrega nada.

function Pantalla({ refrescando, onRefrescar }: { refrescando: boolean; onRefrescar: () => unknown }) {
  const refresco = useTirarParaRefrescar({ refrescando, onRefrescar });
  return refresco.envolver(
    <ScrollView testID="scroll" ref={refresco.refScroll} refreshControl={refresco.refreshControl}>
      <Text>Contenido</Text>
    </ScrollView>
  );
}

describe('useTirarParaRefrescar (nativo)', () => {
  it('deja el RefreshControl de siempre: refreshing, color de la app y onRefresh llama a la recarga', () => {
    const onRefrescar = jest.fn();
    const { getByTestId, rerender } = render(<Pantalla refrescando={false} onRefrescar={onRefrescar} />);

    const control = getByTestId('scroll').props.refreshControl;
    expect(control.props.refreshing).toBe(false);
    expect(control.props.tintColor).toBe(colors.primary);
    act(() => control.props.onRefresh());
    expect(onRefrescar).toHaveBeenCalledTimes(1);

    rerender(<Pantalla refrescando onRefrescar={onRefrescar} />);
    expect(getByTestId('scroll').props.refreshControl.props.refreshing).toBe(true);
  });

  it('envolver() devuelve el ScrollView tal cual: sin indicador propio', () => {
    const { queryByTestId, getByText } = render(<Pantalla refrescando={false} onRefrescar={jest.fn()} />);
    expect(getByText('Contenido')).toBeTruthy();
    expect(queryByTestId('refresco-indicador')).toBeNull();
  });
});
