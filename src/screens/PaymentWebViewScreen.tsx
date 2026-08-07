import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { createPaymentPreference } from '../lib/paymentsApi';

type ResultadoPago = 'approved' | 'pending' | 'failure' | null;

// Marcadores que buscamos en cada URL para saber cómo terminó el checkout,
// sin depender de que llegue un webhook de Mercado Pago antes de que el
// socio vuelva a la app. Cubrimos tanto los back_urls custom-scheme que la
// Edge Function configura (greenfit://payment-...) como los query params
// que Mercado Pago agrega a sus propias páginas de resultado (status /
// collection_status).
const SUCCESS_MARKERS = ['greenfit://payment-success', 'status=approved', 'collection_status=approved'];
const FAILURE_MARKERS = ['greenfit://payment-failure', 'status=rejected', 'collection_status=rejected'];
const PENDING_MARKERS = ['greenfit://payment-pending', 'status=pending', 'collection_status=in_process'];

function matchesAny(url: string, markers: string[]): boolean {
  return markers.some((marker) => url.includes(marker));
}

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

  const [initPoint, setInitPoint] = useState(initPointInicial);
  const [resultado, setResultado] = useState<ResultadoPago>(null);
  const [reintentando, setReintentando] = useState(false);
  const hasResolvedRef = useRef(false);

  function resolveFromUrl(url: string): boolean {
    if (hasResolvedRef.current || !url) return false;

    if (matchesAny(url, SUCCESS_MARKERS)) {
      hasResolvedRef.current = true;
      setResultado('approved');
      return true;
    }
    if (matchesAny(url, FAILURE_MARKERS)) {
      hasResolvedRef.current = true;
      setResultado('failure');
      return true;
    }
    if (matchesAny(url, PENDING_MARKERS)) {
      hasResolvedRef.current = true;
      setResultado('pending');
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

  // "Reintentar" genera una preferencia NUEVA (la vieja quedó asociada a un
  // pago rechazado, Mercado Pago no permite reusarla) y recarga el WebView
  // sin volver a la lista de packs -- solo posible si vinimos de
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
