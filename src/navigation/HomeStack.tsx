import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/user/HomeScreen';
import PaymentWebViewScreen from '../screens/PaymentWebViewScreen';

const Stack = createNativeStackNavigator();

// Stack propio del socio para la pestaña "Inicio": permite entrar al
// checkout de Mercado Pago (WebView) desde el banner "Comprar créditos /
// pase" sin sacar esa navegación del tab de Inicio.
export default function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="PaymentWebView" component={PaymentWebViewScreen} />
    </Stack.Navigator>
  );
}
