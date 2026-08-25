import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import AuthStack from './AuthStack';
import RootStack from './RootStack';
import { colors } from '../theme/colors';

// Esta es la pieza central del control de acceso por rol:
// no hay "if role === admin" desperdigado por la app, todo pasa por acá.
//
// La exigencia de datos de emergencia (seguridad médica) NO vive acá --
// no bloquea ni atrapa al socio en ninguna pantalla. Es una redirección
// simple de "una sola vez al entrar" hacia Mis Datos, con el menú inferior
// y el botón de volver siempre habilitados (ver MainTabs.tsx / ProfileStack.tsx).
export default function RootNavigator() {
  const { user, isBootstrapping } = useAuth();

  // Mientras se chequea si ya había una sesión guardada, no mostramos
  // Login (parpadeo feo) ni la app (todavía no sabemos el rol).
  if (isBootstrapping) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {!user ? <AuthStack /> : <RootStack />}
    </NavigationContainer>
  );
}
