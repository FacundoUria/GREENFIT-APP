import React from 'react';
import { Alert } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import ProfileScreen from '../screens/user/ProfileScreen';
import HistoryScreen from '../screens/user/HistoryScreen';
import ProgresoMobileView from '../screens/user/ProgresoMobileView';
import PerfilMobileView, { PerfilAccesoDirecto } from '../screens/user/PerfilMobileView';

const Stack = createNativeStackNavigator();

function proximamente(titulo: string) {
  Alert.alert(titulo, 'Todavía estamos preparando esta sección.');
}

// Traduce cada tile de la grilla 3x3 de PerfilMobileView a una ruta real.
// Vive acá (capa de navegación) y no dentro de PerfilMobileView.tsx a
// propósito -- esa vista queda agnóstica de la forma del árbol de
// navegación, así no hay que volver a tocarla si el árbol cambia.
function ProfileHomeScreen({ navigation }: any) {
  function handleNavigate(target: PerfilAccesoDirecto) {
    switch (target) {
      case 'mis-datos':
        navigation.navigate('MyData');
        return;
      case 'mis-reservas':
        navigation.navigate('Reservas');
        return;
      case 'notificaciones':
        navigation.navigate('Notifications');
        return;
      case 'pagos':
        proximamente('Pagos y Facturas');
        return;
      case 'progreso':
        // Pantalla empujada ACÁ MISMO (ver Stack.Screen "Progreso" abajo) --
        // ya no es un tab de la bottom nav (ese lugar lo ocupa Comunidad
        // ahora), header nativo con botón de volver automático.
        navigation.navigate('Progreso');
        return;
      case 'comunidad':
        // Tab de primer nivel en MainTabs.tsx -- mismo route name de
        // siempre, solo cambió de vivir en RootStack a vivir como tab.
        navigation.navigate('Comunidad');
        return;
      case 'mi-plan':
        proximamente('Mi Plan / Membresía');
        return;
      case 'soporte':
        // No debería llegar acá -- PerfilMobileView abre WhatsApp
        // directamente para este acceso sin pasar por onNavigate.
        return;
    }
  }

  return <PerfilMobileView onNavigate={handleNavigate} />;
}

export default function ProfileStack() {
  const { user } = useAuth();
  // Mismo criterio que MainTabs.tsx: si vía el tab "Perfil" (redirigido por
  // datos de emergencia incompletos), esta pila arranca directo en "Mis
  // datos" en vez del listado -- una sola vez al montar, sin impedir que el
  // socio navegue a cualquier otra pantalla después (botón de volver y
  // resto de tabs quedan intactos, no hay ningún bloqueo).
  const initialRouteName = !user?.datosEmergenciaCompletos ? 'MyData' : 'ProfileHome';

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.textPrimary }}
    >
      {/* Sin header nativo acá -- PerfilMobileView ya trae su propio título
          "Mi Perfil" en el layout, mismo criterio que Inicio/Agenda/Comunidad. */}
      <Stack.Screen name="ProfileHome" component={ProfileHomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="MyData" component={ProfileScreen} options={{ title: 'Mis datos' }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Historial de clases' }} />
      {/* Progreso dejó de ser tab (Módulo 5) -- ahora se abre desde acá, con
          header nativo real (título + botón de volver) porque es una
          pantalla de "profundidad 2" (Perfil -> Progreso), no un peer de
          primer nivel como los tabs. */}
      <Stack.Screen name="Progreso" component={ProgresoMobileView} options={{ title: 'Mi Progreso' }} />
    </Stack.Navigator>
  );
}
