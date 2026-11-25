import React, { useContext } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { EdgeInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';

// Zonas seguras (notch arriba, barra de gestos abajo). En web las mide
// react-native-safe-area-context con env(safe-area-inset-*), que solo vale algo
// con `viewport-fit=cover` en el <meta name="viewport"> (public/index.html).
//
// La de ARRIBA se aplica UNA vez acá, en la raíz: con la app instalada en iOS
// (barra de estado black-translucent) el contenido ya no queda debajo de la
// hora. Para que los headers de react-navigation no la vuelvan a sumar, a todo
// lo de adentro se le pasa top = 0. La de ABAJO la usa la barra de pestañas
// (MainTabs) y, más adelante, las hojas inferiores.

const SIN_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

// Como useSafeAreaInsets, pero sin romper si no hay SafeAreaProvider arriba
// (tests de componentes sueltos): devuelve 0 en todos los bordes.
export function useInsetsSeguros(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? SIN_INSETS;
}

export default function ZonaSegura({
  style,
  children,
  testID,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
}) {
  const insets = useInsetsSeguros();
  return (
    <View style={[style, { paddingTop: insets.top }]} testID={testID}>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  );
}
