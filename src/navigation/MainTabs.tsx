import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';

import HomeStack from './HomeStack';
import AgendaMobileView from '../screens/user/AgendaMobileView';
import ProfileStack from './ProfileStack';
import UserRoutineScreen from '../screens/user/UserRoutineScreen';
import ComunidadMobileView from '../screens/user/ComunidadMobileView';
import { useNotificationSubscription } from '../hooks/useNotificationSubscription';
import { useAutoRequestWebPush } from '../hooks/usePushPermission';

const Tab = createBottomTabNavigator();

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  Inicio: 'home',
  Reservas: 'calendar',
  'Mi Rutina': 'barbell',
  Comunidad: 'people',
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

  // Redirección de "una sola vez al entrar" (exigencia de seguridad médica):
  // si al socio le faltan datos de emergencia, el tab inicial es Perfil en
  // vez de Inicio (ver ProfileStack.tsx, que a su vez arranca directo en
  // "Mis datos"). `initialRouteName` solo se evalúa al MONTAR este
  // Tab.Navigator (una vez por login, porque RootNavigator desmonta todo
  // este árbol al cerrar sesión) -- después el socio puede tocar cualquier
  // otro tab libremente, no queda atrapado ni se lo vuelve a redirigir.
  const initialRouteName = !user?.datosEmergenciaCompletos ? 'Perfil' : 'Inicio';

  return (
    <Tab.Navigator
      initialRouteName={initialRouteName}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.surfaceAlt },
        tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Inicio" component={HomeStack} />
      {/* La ruta sigue llamándose "Reservas" (HomeScreen navega a ella con
          ese nombre para el banner "Reservar" -- ver HomeScreen.tsx) pero
          ahora renderiza AgendaMobileView (Módulo 2 del rediseño): Agenda
          reemplaza a la vieja pantalla de Reservas, solo cambia el label
          visible del tab. */}
      <Tab.Screen name="Reservas" component={AgendaMobileView} options={{ tabBarLabel: 'Agenda' }} />
      <Tab.Screen name="Mi Rutina" component={UserRoutineScreen} />
      {/* Comunidad pasó a tab de primer nivel (antes vivía como pantalla
          empujada desde el tile de Perfil) -- es la función de retención/
          red social del gym, no puede quedar escondida. Progreso hizo el
          camino inverso: dejó de ser tab y ahora se abre desde el tile
          "Logros" de Mi Perfil (ver ProfileStack.tsx) -- mismo route name
          "Progreso" en su nueva ubicación, así que ese tile no necesitó
          ningún cambio de código, solo cambió A DÓNDE resuelve. */}
      <Tab.Screen name="Comunidad" component={ComunidadMobileView} />
      <Tab.Screen name="Perfil" component={ProfileStack} />
    </Tab.Navigator>
  );
}
