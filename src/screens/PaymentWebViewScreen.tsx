import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { createPaymentPreference } from '../lib/paymentsApi';
import { ResultadoPago, resolvePaymentResultFromUrl } from '../lib/paymentResult';

const RESULTADO_META: Record<
  Exclude<ResultadoPago, null>,
  { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; message: string }
> = {
  approved: {
    icon: 'checkmark-circle',
    color: colors.primary,
    title: '¡Pago acreditado!',
    message: 'Tu compra se procesó con éxito. Ya podés ver tus créditos actualizados en tu Home.',
  },
  pending: {
    icon: 'time',
    color: colors.warning,
    title: 'Pago en revisión',
    message: 'Tu pago está en proceso de verificación. Apenas se acredite verás tus créditos sumados.',
  },
  failure: {
    icon: 'close-circle',
    color: colors.danger,
    title: 'No se pudo procesar el pago',
    message: 'El pago fue rechazado o cancelado. Podés intentarlo de nuevo cuando quieras.',
  },
};

export default function PaymentWebViewScreen({ route, navigation }: any) {
  const initPointInicial: string | undefined = route.params?.initPoint;
  const packId: string | undefined = route.params?.packId;
  const userId: string | undefined = route.params?.userId;
  // En Web, HomeScreen es quien detecta el resultado (a partir de la URL con
  // la que la PWA volvió a cargar tras la redirección a Mercado Pago -- ver
  // su propio useEffect) y lo manda ya resuelto acá. Esta pantalla arranca
  // directo en la tarjeta de resultado, sin WebView ni redirección de nuevo.
  const webResultadoInicial: ResultadoPago = route.params?.webResultado ?? null;

  const [initPoint, setInitPoint] = useState(initPointInicial);
  const [resultado, setResultado] = useState<ResultadoPago>(webResultadoInicial);
  const [reintentando, setReintentando] = useState(false);
  const hasResolvedRef = useRef(webResultadoInicial !== null);

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

  // Web/PWA: react-native-webview no soporta ese entorno ("React Native
  // WebView does not support this platform") -- en vez de un WebView
  // embebido, se redirige la pestaña entera al Checkout Pro de Mercado
  // Pago. El back_url que arma create-payment-preference para Web ya
  // apunta al origin real de la PWA (resolveBackUrls en
  // supabase/functions/_shared/mercadopago.ts), así que Mercado Pago vuelve
  // a cargarla ahí -- HomeScreen es quien detecta el resultado en esa
  // vuelta (ver su propio useEffect) y reabre esta pantalla ya con
  // `resultado` resuelto (webResultadoInicial más arriba). Dispara de nuevo
  // solo si initPoint cambió (ej. tras "Reintentar").
  useEffect(() => {
    if (Platform.OS !== 'web' || !initPoint || resultado) return;
    if (typeof window === 'undefined') return;
    window.location.href = initPoint;
  }, [initPoint, resultado]);

  // "Reintentar" genera una preferencia NUEVA (la vieja quedó asociada a un
  // pago rechazado, Mercado Pago no permite reusarla) y recarga el WebView
  // (nativo) o dispara una redirección nueva (Web, vía el useEffect de
  // arriba) sin volver a la lista de packs -- solo posible si vinimos de
  // handleSelectPack con packId/userId; si no están disponibles (deep link
  // viejo, por ejemplo), el botón vuelve atrás como antes.
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
    const meta = RESULTADO_META[resultado];
    return (
      <View style={styles.resultContainer}>
        <Ionicons name={meta.icon} size={64} color={meta.color} />
        <Text style={styles.resultTitle}>{meta.title}</Text>
        <Text style={styles.resultMessage}>{meta.message}</Text>
        <View style={styles.resultActions}>
          {resultado === 'failure' && (
            <TouchableOpacity
              style={[styles.resultButton, styles.resultButtonPrimary]}
              onPress={handleReintentar}
              disabled={reintentando}
            >
              {reintentando ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <Text style={styles.resultButtonPrimaryText}>Reintentar</Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.resultButton} onPress={() => navigation.goBack()}>
            <Text style={styles.resultButtonText}>{resultado === 'failure' ? 'Cancelar' : 'Listo'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!initPoint) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.danger} />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    // La redirección la dispara el useEffect de arriba -- esto es solo lo
    // que se ve durante el instante entre "se generó la preferencia" y
    // "el navegador terminó de salir de esta pestaña".
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.resultMessage, styles.webRedirectMessage]}>Redirigiendo a Mercado Pago...</Text>
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
  webRedirectMessage: { marginTop: 0 },
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
  resultContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  resultTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  resultMessage: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  resultActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  resultButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  resultButtonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  resultButtonText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  resultButtonPrimaryText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
});
