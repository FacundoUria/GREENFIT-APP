import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import AuthStack from './AuthStack';
import UserTabs from './UserTabs';
import AdminTabs from './AdminTabs';
import { colors } from '../theme/colors';

// Esta es la pieza central del control de acceso por rol:
// no hay "if role === admin" desperdigado por la app, todo pasa por acá.
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
      {!user ? (
        <AuthStack />
      ) : user.role === 'admin' ? (
        <AdminTabs />
      ) : (
        <UserTabs />
      )}
    </NavigationContainer>
  );
}
