import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/user/HomeScreen';
import PaymentWebViewScreen from '../screens/PaymentWebViewScreen';
import TransferReceiptScreen from '../screens/user/TransferReceiptScreen';

const Stack = createNativeStackNavigator();

// Stack propio del socio para la pestaña "Inicio": permite entrar al
// checkout de Mercado Pago (WebView) o a la pantalla de "pagar por
// transferencia" (comprobante) desde el selector de método de pago, sin
// sacar esa navegación del tab de Inicio.
export default function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="PaymentWebView" component={PaymentWebViewScreen} />
      <Stack.Screen name="TransferReceipt" component={TransferReceiptScreen} />
    </Stack.Navigator>
  );
}
