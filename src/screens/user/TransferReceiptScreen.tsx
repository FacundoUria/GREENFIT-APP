import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useConfiguracion } from '../../context/ConfiguracionContext';
import { colors } from '../../theme/colors';
import { formatCurrency } from '../../lib/currency';
import { showAlert } from '../../lib/crossPlatformAlert';
import { subirComprobantePago, crearPagoPendiente } from '../../lib/comprobanteApi';
import { copyToClipboard } from '../../lib/clipboard';

interface RouteParams {
  packId: string;
  packName: string;
  monto: number;
}

// Pantalla "Pagar por transferencia" -- se abre desde el selector de método
// de pago en HomeScreen.tsx (handleSelectPack sigue siendo el único camino
// hacia Mercado Pago, sin tocar). Flujo: mostrar alias/titular reales
// (configuracion, ya públicos) con copiar-al-portapapeles, sacar/elegir la
// foto del comprobante, y mandarlo -- se acredita AUTOMÁTICO al subirse
// (Fase 3, crear_pago_pendiente_transferencia -> acreditar_pack): ya no
// pasa por 'pendiente' ni por una aprobación manual de un admin. El control
// pasa a ser reactivo (admin_revertir_comprobante, si hace falta corregir
// algo después), no preventivo -- cambio de flujo de negocio ya decidido.
export default function TransferReceiptScreen({ navigation, route }: any) {
  const { packId, packName, monto } = route.params as RouteParams;
  const { user } = useAuth();
  const { configuracion } = useConfiguracion();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopiarAlias() {
    const ok = await copyToClipboard(configuracion.aliasCvu);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      showAlert('No se pudo copiar', 'Seleccioná el alias a mano y copialo.');
    }
  }

  async function handleTomarFoto() {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      showAlert('Permiso necesario', 'Habilitá el acceso a la cámara para poder fotografiar el comprobante.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
    if (!resultado.canceled && resultado.assets[0]) setImageUri(resultado.assets[0].uri);
  }

  async function handleElegirFoto() {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      showAlert('Permiso necesario', 'Habilitá el acceso a tus fotos para poder subir el comprobante.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true });
    if (!resultado.canceled && resultado.assets[0]) setImageUri(resultado.assets[0].uri);
  }

  async function handleEnviar() {
    if (!user || !imageUri || submitting) return;
    setSubmitting(true);
    try {
      const path = await subirComprobantePago(user.id, imageUri);
      await crearPagoPendiente({ packId, comprobantePath: path, monto });
      showAlert(
        '¡Comprobante recibido!',
        'Ya acreditamos tu pago -- revisá tu saldo actualizado en Inicio.'
      );
      navigation.goBack();
    } catch (err) {
      showAlert('No se pudo enviar el comprobante', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Pagar por transferencia</Text>
      </View>

      <Text style={styles.packLabel}>{packName}</Text>
      <Text style={styles.packPrice}>{formatCurrency(monto)}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Datos para transferir</Text>
        <View style={styles.dataRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dataLabel}>Alias / CVU</Text>
            <Text style={styles.dataValue}>{configuracion.aliasCvu || 'No cargado todavía'}</Text>
          </View>
          {!!configuracion.aliasCvu && (
            <TouchableOpacity style={styles.copyButton} onPress={handleCopiarAlias}>
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={copied ? colors.primary : colors.textPrimary}
              />
              <Text style={[styles.copyButtonText, copied && { color: colors.primary }]}>
                {copied ? '¡Copiado!' : 'Copiar'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {!!configuracion.titularCuenta && (
          <View style={styles.dataRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dataLabel}>Titular</Text>
              <Text style={styles.dataValue}>{configuracion.titularCuenta}</Text>
            </View>
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>Comprobante</Text>
      <Text style={styles.sectionHint}>Sacale una foto o subí una desde tu galería.</Text>

      {imageUri ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: imageUri }} style={styles.preview} />
          <TouchableOpacity style={styles.changeButton} onPress={() => setImageUri(null)}>
            <Text style={styles.changeButtonText}>Cambiar foto</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.pickerRow}>
          <TouchableOpacity style={styles.pickerButton} onPress={handleTomarFoto}>
            <Ionicons name="camera-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.pickerButtonText}>Sacar foto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickerButton} onPress={handleElegirFoto}>
            <Ionicons name="image-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.pickerButtonText}>Elegir de galería</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitButton, (!imageUri || submitting) && styles.submitButtonDisabled]}
        disabled={!imageUri || submitting}
        onPress={handleEnviar}
      >
        {submitting ? (
          <ActivityIndicator color={colors.onPrimary} size="small" />
        ) : (
          <Text style={styles.submitButtonText}>Enviar comprobante</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  packLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  packPrice: { color: colors.primary, fontSize: 20, fontWeight: '700', marginBottom: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    padding: 16,
    marginBottom: 24,
  },
  cardTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14, marginBottom: 10 },
  dataRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dataLabel: { color: colors.textSecondary, fontSize: 12 },
  dataValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', marginTop: 2 },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  copyButtonText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  sectionHint: { color: colors.textSecondary, fontSize: 12, marginBottom: 12 },
  pickerRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  pickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 16,
  },
  pickerButtonText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  previewWrap: { marginBottom: 24, alignItems: 'center' },
  preview: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.surface },
  changeButton: { marginTop: 10 },
  changeButtonText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
});
