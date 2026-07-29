import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import MainTabs from './MainTabs';
import NotificationsScreen from '../screens/user/NotificationsScreen';

const Stack = createNativeStackNavigator();

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
        component={NotificationsScreen}
        options={{
          headerShown: true,
          title: 'Notificaciones',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
        }}
      />
    </Stack.Navigator>
  );
}
