import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';

import HomeStack from './HomeStack';
import BookingScreen from '../screens/user/BookingScreen';
import ProfileStack from './ProfileStack';
import UserRoutineScreen from '../screens/user/UserRoutineScreen';
import { useNotificationSubscription } from '../hooks/useNotificationSubscription';
import { useAutoRequestWebPush } from '../hooks/usePushPermission';

const Tab = createBottomTabNavigator();

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  Inicio: 'home',
  Reservas: 'calendar',
  'Mi Rutina': 'barbell',
  Perfil: 'person',
};

// Único Tab Navigator del socio. Ninguna pestaña de Notificaciones acá — se
// accede desde la campanita del header (Inicio), que empuja fuera del Tab
// Navigator (ver RootStack).
export default function MainTabs() {
  const { user } = useAuth();
  // Popup local con sonido cuando entra una notificación relevante.
  useNotificationSubscription(user?.id);
  // Web Push real (con la app cerrada) — pide permiso una sola vez al loguearse.
  useAutoRequestWebPush(user?.id);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.surfaceAlt },
        tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Inicio" component={HomeStack} />
      <Tab.Screen name="Reservas" component={BookingScreen} />
      <Tab.Screen name="Mi Rutina" component={UserRoutineScreen} />
      <Tab.Screen name="Perfil" component={ProfileStack} />
    </Tab.Navigator>
  );
}
