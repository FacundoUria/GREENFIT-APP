import React from 'react';
import { View, StyleSheet } from 'react-native';
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

// Fondo de la barra flotante: la barra en sí ocupa todo el ancho con el color
// de fondo de la app (si no, los márgenes de una barra "flotante" dejan ver el
// fondo claro por defecto del navegador), y la píldora se dibuja acá adentro.
function FloatingTabBackground() {
  return <View style={styles.pill} />;
}

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

  // Redirección de "una sola vez al entrar" (perfil obligatorio incompleto):
  // si al socio le faltan campos obligatorios de "Mis datos", el tab inicial
  // es Perfil en vez de Inicio (ver ProfileStack.tsx, que a su vez arranca
  // directo en "Mis datos" Y bloquea el resto de las pantallas DE ESA
  // PESTAÑA). `initialRouteName` solo se evalúa al MONTAR este Tab.Navigator
  // (una vez por login, porque RootNavigator desmonta todo este árbol al
  // cerrar sesión) -- el resto de los tabs (Inicio, Agenda, Mi Rutina,
  // Comunidad) NO se tocan acá, el socio puede navegar a cualquiera de
  // ellos libremente en cualquier momento.
  const initialRouteName = !user?.perfilCompleto ? 'Perfil' : 'Inicio';

  return (
    <Tab.Navigator
      initialRouteName={initialRouteName}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        // Barra flotante (píldora con márgenes y borde) -- a propósito NO
        // `position: absolute`: en el flujo normal no tapa el contenido de
        // Agenda/Rutina/Comunidad/Perfil (esta barra es de TODAS las tabs).
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 0,
          paddingHorizontal: 22,
          paddingTop: 12,
          paddingBottom: 18,
          height: 84,
        },
        tabBarBackground: () => <FloatingTabBackground />,
        tabBarItemStyle: { borderRadius: 26, marginHorizontal: 2 },
        tabBarActiveBackgroundColor: `${colors.primary}1A`,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
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

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 6,
    bottom: 12,
    borderRadius: 32,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
});
