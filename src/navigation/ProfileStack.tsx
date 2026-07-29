import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import ProfileScreen from '../screens/user/ProfileScreen';
import HistoryScreen from '../screens/user/HistoryScreen';

const Stack = createNativeStackNavigator();

export default function ProfileStack() {
  return (
    <Stack.Navigator
      screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.textPrimary }}
    >
      <Stack.Screen name="ProfileHome" component={ProfileScreen} options={{ title: 'Perfil' }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Historial de clases' }} />
    </Stack.Navigator>
  );
}
