import React, { useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { createPaymentPreference } from '../lib/paymentsApi';
import { ResultadoPago, resolvePaymentResultFromUrl } from '../lib/paymentResult';
import PaymentResultCard from '../components/PaymentResultCard';

// Nativo (iOS/Android, Expo Go o build instalada): react-native-webview SÍ
// funciona acá. El sufijo .native.tsx hace que Metro (y Jest, con el mismo
// resolver) nunca incluya este archivo -- ni el import de react-native-
// webview -- en el bundle Web; ver PaymentWebViewScreen.web.tsx para esa
// plataforma. Repartir la lógica en dos archivos por extensión es la única
// forma real de lograrlo: un `Platform.OS === 'web'` en un archivo ÚNICO no
// alcanza, porque el import estático de react-native-webview ya se evalúa
// (y falla) al cargar el módulo, antes de que corra ningún condicional.
export default function PaymentWebViewScreen({ route, navigation }: any) {
  const initPointInicial: string | undefined = route.params?.initPoint;
  const packId: string | undefined = route.params?.packId;
  const userId: string | undefined = route.params?.userId;

  const [initPoint, setInitPoint] = useState(initPointInicial);
  const [resultado, setResultado] = useState<ResultadoPago>(null);
  const [reintentando, setReintentando] = useState(false);
  const hasResolvedRef = useRef(false);

  function resolveFromUrl(url: string): boolean {
    if (hasResolvedRef.current || !url) return false;
    const detectado = resolvePaymentResultFromUrl(url);
    if (!detectado) return false;
    hasResolvedRef.current = true;
    setResultado(detectado);
    return true;
  }

  // El custom scheme (greenfit://...) nunca llega a "navegar" de verdad —
  // hay que interceptarlo ACÁ, antes de que el WebView intente cargarlo y
  // falle. Devolver `false` cancela esa navegación dentro del WebView.
  function handleShouldStartLoad(request: { url: string }): boolean {
    if (resolveFromUrl(request.url)) return false;
    return true;
  }

  // Los query params de status (páginas reales de Mercado Pago) sí cargan
  // como una página normal, así que a esos los detectamos post-navegación.
  function handleNavigationChange(navState: WebViewNavigation) {
    if (navState.url) resolveFromUrl(navState.url);
  }

  // "Reintentar" genera una preferencia NUEVA (la vieja quedó asociada a un
  // pago rechazado, Mercado Pago no permite reusarla) y recarga el WebView
  // (key={initPoint} más abajo) sin volver a la lista de packs -- solo
  // posible si vinimos de handleSelectPack con packId/userId; si no están
  // disponibles (deep link viejo, por ejemplo), el botón vuelve atrás.
  async function handleReintentar() {
    if (!packId || !userId) {
      navigation.goBack();
      return;
    }
    setReintentando(true);
    try {
      const preference = await createPaymentPreference({ packId, userId });
      hasResolvedRef.current = false;
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

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
        <Ionicons name="close" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <WebView
        key={initPoint}
        source={{ uri: initPoint }}
        style={styles.webview}
        startInLoadingState
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onNavigationStateChange={handleNavigationChange}
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 12 },
  closeButton: {
    alignSelf: 'flex-end',
    margin: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  webview: { flex: 1, backgroundColor: colors.background },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
