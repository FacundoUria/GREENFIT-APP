import React, { useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

// Marcadores que buscamos en cada URL para saber cómo terminó el checkout,
// sin depender de que llegue un webhook de Mercado Pago antes de que el
// socio vuelva a la app. Cubrimos tanto los back_urls custom-scheme que le
// pediremos a la Edge Function que configure (greenfit://payment-...) como
// los query params que Mercado Pago agrega a sus propias páginas de
// resultado (status / collection_status).
const SUCCESS_MARKERS = ['greenfit://payment-success', 'status=approved', 'collection_status=approved'];
const FAILURE_MARKERS = ['greenfit://payment-failure', 'status=rejected', 'collection_status=rejected'];
const PENDING_MARKERS = ['greenfit://payment-pending', 'status=pending', 'collection_status=in_process'];

function matchesAny(url: string, markers: string[]): boolean {
  return markers.some((marker) => url.includes(marker));
}

export default function PaymentWebViewScreen({ route, navigation }: any) {
  const initPoint: string | undefined = route.params?.initPoint;
  const hasResolvedRef = useRef(false);

  function resolveFromUrl(url: string): boolean {
    if (hasResolvedRef.current || !url) return false;

    if (matchesAny(url, SUCCESS_MARKERS)) {
      hasResolvedRef.current = true;
      Alert.alert('Pago acreditado', 'Tu compra se procesó con éxito.', [
        { text: 'Listo', onPress: () => navigation.goBack() },
      ]);
      return true;
    }
    if (matchesAny(url, FAILURE_MARKERS)) {
      hasResolvedRef.current = true;
      Alert.alert('Pago rechazado', 'No se pudo procesar el pago. Podés intentar de nuevo.', [
        { text: 'Cerrar', onPress: () => navigation.goBack() },
      ]);
      return true;
    }
    if (matchesAny(url, PENDING_MARKERS)) {
      hasResolvedRef.current = true;
      Alert.alert('Pago pendiente', 'Tu pago está en revisión, te avisamos cuando se acredite.', [
        { text: 'Cerrar', onPress: () => navigation.goBack() },
      ]);
      return true;
    }
    return false;
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
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
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
