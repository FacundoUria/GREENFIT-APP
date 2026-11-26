import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { HeaderBackButton } from '@react-navigation/elements';
import { colors } from '../theme/colors';
import MainTabs from './MainTabs';
import NotificacionesMobileView from '../screens/user/NotificacionesMobileView';
import CredentialScreen from '../screens/user/CredentialScreen';

const Stack = createNativeStackNavigator();

// Flecha de volver del encabezado, en web: la misma de React Navigation (mismo
// ícono, mismo "Go back", mismo goBack), con un área de toque de 44 x 44 (la de
// fábrica mide 30 x 30 y su hitSlop no cuenta en web). Los márgenes compensan
// el tamaño: el ícono queda exactamente donde estaba. En nativo, la de siempre.
function volverDe44(navigation: { goBack: () => void }): NativeStackNavigationOptions {
  if (Platform.OS !== 'web') return {};
  return {
    headerLeft: ({ tintColor, canGoBack }) =>
      canGoBack ? (
        <HeaderBackButton tintColor={tintColor} canGoBack onPress={navigation.goBack} style={estilos.volver} />
      ) : null,
  };
}

// Notificaciones vive ACÁ, fuera del Tab Navigator — no dentro del stack de
// la pestaña "Perfil" (donde vivía antes). Ahí adentro, tocar la campanita
// empujaba la pantalla de Notificaciones a esa MISMA pila, y al tocar
// después la pestaña "Perfil" React Navigation mostraba la última pantalla
// de esa pila (Notificaciones) en vez de resetear al listado inicial — el
// bug de "el tab dice Perfil pero abre Notificaciones". Al vivir en un
// stack hermano del Tab Navigator, no comparte historial con ninguna pestaña.
export default function RootStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen
        name="Notifications"
        component={NotificacionesMobileView}
        options={({ navigation }) => ({
          headerShown: true,
          title: 'Notificaciones',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          ...volverDe44(navigation),
        })}
      />
      <Stack.Screen
        name="Credential"
        component={CredentialScreen}
        options={({ navigation }) => ({
          headerShown: true,
          title: 'Mi Credencial',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          ...volverDe44(navigation),
        })}
      />
    </Stack.Navigator>
  );
}

const estilos = StyleSheet.create({
  // De fábrica: 30 x 30 con márgenes 3 (arriba/abajo) y 11 (costados), o sea
  // una caja de 52 x 36. Acá: 44 x 44 con márgenes -4 y 4: la misma caja de
  // 52 x 36 y el ícono centrado en el mismo punto.
  volver: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    marginVertical: -4,
    marginHorizontal: 4,
  },
});
