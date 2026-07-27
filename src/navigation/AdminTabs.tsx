import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import DashboardScreen from '../screens/admin/DashboardScreen';
import ClassRosterScreen from '../screens/admin/ClassRosterScreen';
import NotificationsScreen from '../screens/admin/NotificationsScreen';
import { colors } from '../theme/colors';

const Tab = createBottomTabNavigator();
const DashboardStackNav = createNativeStackNavigator();

// El Dashboard necesita un Stack propio porque de ahí se navega al detalle
// de un turno (ClassRoster), algo que un Tab solo no puede hacer.
function DashboardStack() {
  return (
    <DashboardStackNav.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.textPrimary }}>
      <DashboardStackNav.Screen name="DashboardHome" component={DashboardScreen} options={{ title: 'Panel Admin' }} />
      <DashboardStackNav.Screen name="ClassRoster" component={ClassRosterScreen} options={{ title: 'Alumnos anotados' }} />
    </DashboardStackNav.Navigator>
  );
}

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  Panel: 'grid',
  Notificaciones: 'notifications',
};

export default function AdminTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.surfaceAlt },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={icons[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Panel" component={DashboardStack} />
      <Tab.Screen name="Notificaciones" component={NotificationsScreen} />
    </Tab.Navigator>
  );
}
