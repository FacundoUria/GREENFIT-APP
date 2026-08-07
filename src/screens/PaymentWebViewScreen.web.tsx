import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { createPaymentPreference } from '../lib/paymentsApi';
import { ResultadoPago } from '../lib/paymentResult';
import PaymentResultCard from '../components/PaymentResultCard';

// Web/PWA: este archivo NO IMPORTA react-native-webview BAJO NINGUNA
// CIRCUNSTANCIA -- ese es justo el punto del split por extensión (ver
// PaymentWebViewScreen.native.tsx). En React Native Web, un `Platform.OS
// === 'web'` adentro de un único archivo compartido NO alcanza: el import
// estático de react-native-webview ya se evalúa (y tira "does not support
// this platform") al cargar el módulo, mucho antes de que corra cualquier
// condicional de render. Separando en .web.tsx / .native.tsx, Metro (y
// Jest, con el mismo resolver de extensión por plataforma) directamente
// nunca incluye react-native-webview en el bundle de Web.
//
// No hay WebView embebido acá: se redirige la pestaña ENTERA al Checkout
// Pro de Mercado Pago (window.location.href). El back_url que arma
// create-payment-preference para Web ya apunta al origin real de la PWA
// (resolveBackUrls en supabase/functions/_shared/mercadopago.ts), así que
// Mercado Pago vuelve a cargarla ahí -- HomeScreen es quien detecta el
// resultado en esa vuelta (su propio useEffect, mismos query params
// status/collection_status) y reabre esta pantalla ya con `resultado`
// resuelto, sin generar ninguna preferencia nueva.
export default function PaymentWebViewScreen({ route, navigation }: any) {
  const initPointInicial: string | undefined = route.params?.initPoint;
  const packId: string | undefined = route.params?.packId;
  const userId: string | undefined = route.params?.userId;
  const webResultadoInicial: ResultadoPago = route.params?.webResultado ?? null;

  const [initPoint, setInitPoint] = useState(initPointInicial);
  const [resultado, setResultado] = useState<ResultadoPago>(webResultadoInicial);
  const [reintentando, setReintentando] = useState(false);
  const yaRedirigioRef = useRef(false);

  // Dispara la redirección apenas hay un initPoint nuevo y todavía no se
  // conoce ningún resultado -- una sola vez por initPoint (yaRedirigioRef
  // evita reintentar la redirección en re-renders posteriores mientras el
  // navegador todavía está saliendo de esta pestaña).
  useEffect(() => {
    if (!initPoint || resultado) return;
    if (typeof window === 'undefined') return;
    yaRedirigioRef.current = true;
    window.location.href = initPoint;
  }, [initPoint, resultado]);

  // "Reintentar" genera una preferencia NUEVA (la vieja quedó asociada a un
  // pago rechazado, Mercado Pago no permite reusarla) y dispara una
  // redirección nueva (vía el useEffect de arriba) -- solo posible si
  // vinimos de handleSelectPack con packId/userId; si no están disponibles
  // (deep link viejo, por ejemplo), el botón vuelve atrás.
  async function handleReintentar() {
    if (!packId || !userId) {
      navigation.goBack();
      return;
    }
    setReintentando(true);
    try {
      const preference = await createPaymentPreference({ packId, userId });
      yaRedirigioRef.current = false;
      setResultado(null);
      setInitPoint(preference.initPoint);
    } catch {
      // Si ni siquiera se pudo generar una preferencia nueva, no tiene
      // sentido insistir en esta pantalla -- se vuelve al origen.
      navigation.goBack();
    } finally {
      setReintentando(false);
    }
  }

  if (resultado) {
    return (
      <PaymentResultCard
        resultado={resultado}
        reintentando={reintentando}
        onReintentar={handleReintentar}
        onClose={() => navigation.goBack()}
      />
    );
  }

  if (!initPoint) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.danger} />
      </View>
    );
  }

  // La redirección la dispara el useEffect de arriba -- esto es solo lo que
  // se ve durante el instante entre "se generó la preferencia" y "el
  // navegador terminó de salir de esta pestaña".
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.redirectMessage}>Redirigiendo a Mercado Pago...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 12 },
  redirectMessage: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
});
