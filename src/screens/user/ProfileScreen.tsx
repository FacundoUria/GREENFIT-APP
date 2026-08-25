import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { usePushPermission } from '../../hooks/usePushPermission';
import PushBlockedModal from '../../components/PushBlockedModal';
import PushNeedsInstallModal from '../../components/PushNeedsInstallModal';
import InstallAppButton from '../../components/InstallAppButton';

interface ProfileForm {
  fullName: string;
  dni: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  medicalNotes: string;
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

async function loadProfile(userId: string): Promise<ProfileForm> {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, dni, phone, emergency_contact_name, emergency_contact_phone, medical_notes')
    .eq('id', userId)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No se pudo cargar tu perfil.');
  return {
    fullName: data.full_name,
    dni: data.dni ?? '',
    phone: data.phone ?? '',
    emergencyContactName: data.emergency_contact_name ?? '',
    emergencyContactPhone: data.emergency_contact_phone ?? '',
    medicalNotes: data.medical_notes ?? '',
  };
}

// Foco exclusivo en los datos de la cuenta del socio. El nombre y el DNI
// son de solo lectura (identidad del socio, la carga/corrige el admin desde
// Gestión de socios); el resto lo edita el propio socio.
//
// Exigencia de seguridad médica del gimnasio: si faltan los datos de
// emergencia, ProfileStack.tsx redirige acá UNA SOLA VEZ al entrar (sin
// bloquear nada -- el socio puede navegar a cualquier otro tab cuando
// quiera, ver MainTabs.tsx/ProfileStack.tsx). Acá solo mostramos un banner
// informativo (`bloqueado`) mientras falten, y Contacto de emergencia/Ficha
// médica quedan obligatorios para guardar SIEMPRE (no solo la primera vez),
// para que una vez completos nunca se puedan volver a vaciar sin querer.
export default function ProfileScreen({ navigation }: any) {
  const { user, logout, marcarDatosEmergenciaCompletos } = useAuth();
  const bloqueado = !!user && !user.datosEmergenciaCompletos;
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPushBlockedModal, setShowPushBlockedModal] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const pushPermission = usePushPermission(user?.id);
  const pushBloqueado = pushPermission.permission === 'denied';

  async function handleTogglePush(next: boolean) {
    try {
      await pushPermission.toggle(next);
    } catch (err) {
      Alert.alert('No se pudo actualizar', err instanceof Error ? err.message : 'Intentá de nuevo.');
    }
  }

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      setForm(await loadProfile(user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar tu perfil.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!user || !form) return;

    // Obligatorios SIEMPRE (no solo mientras está bloqueado) -- exigencia
    // de seguridad médica del gimnasio: una vez cargados, no deben poder
    // volver a quedar vacíos por accidente.
    const emergencyContactName = form.emergencyContactName.trim();
    const emergencyContactPhone = form.emergencyContactPhone.trim();
    const medicalNotes = form.medicalNotes.trim();
    if (!emergencyContactName || !emergencyContactPhone || !medicalNotes) {
      Alert.alert(
        'Faltan datos obligatorios',
        'Completá Contacto de emergencia (nombre y teléfono) y Ficha médica antes de guardar.'
      );
      return;
    }

    setIsSaving(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          phone: form.phone.trim() || null,
          emergency_contact_name: emergencyContactName,
          emergency_contact_phone: emergencyContactPhone,
          medical_notes: medicalNotes,
        })
        .eq('id', user.id);
      if (updateError) throw new Error(updateError.message);
      // Desbloquea RootNavigator al instante si hacía falta -- no-op
      // inofensivo si ya estaba completo de antes.
      marcarDatosEmergenciaCompletos();
      Alert.alert('Guardado', 'Tus datos se actualizaron.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading || !form) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      {error && <Text style={styles.error}>{error}</Text>}

      {bloqueado && (
        <View style={styles.bloqueoBanner} accessibilityLabel="Datos de emergencia obligatorios">
          <Ionicons name="medkit" size={18} color={colors.warning} />
          <Text style={styles.bloqueoBannerText}>
            Por seguridad, el gimnasio exige tener cargados tus datos de emergencia antes de usar la app. Completá
            Contacto de emergencia y Ficha médica y tocá "Guardar cambios" para continuar.
          </Text>
        </View>
      )}

      <SectionCard icon="person-outline" title="Mis datos">
        <TextInput style={[styles.input, styles.inputDisabled]} value={form.fullName} editable={false} />
        <TextInput style={[styles.input, styles.inputDisabled]} value={form.dni} editable={false} />
        <TextInput
          style={[styles.input, styles.inputLast]}
          placeholder="Teléfono / WhatsApp"
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(v) => setForm({ ...form, phone: v })}
        />
      </SectionCard>

      <SectionCard icon="alert-circle-outline" title="Contacto de emergencia">
        <TextInput
          style={styles.input}
          placeholder="Nombre del contacto"
          placeholderTextColor={colors.textSecondary}
          value={form.emergencyContactName}
          onChangeText={(v) => setForm({ ...form, emergencyContactName: v })}
        />
        <TextInput
          style={[styles.input, styles.inputLast]}
          placeholder="Teléfono del contacto"
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
          value={form.emergencyContactPhone}
          onChangeText={(v) => setForm({ ...form, emergencyContactPhone: v })}
        />
      </SectionCard>

      <SectionCard icon="medkit-outline" title="Ficha médica">
        <TextInput
          style={[styles.input, styles.inputLast, styles.textArea]}
          placeholder="Lesiones, condiciones físicas u otras observaciones..."
          placeholderTextColor={colors.textSecondary}
          multiline
          value={form.medicalNotes}
          onChangeText={(v) => setForm({ ...form, medicalNotes: v })}
        />
      </SectionCard>

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.saveButtonText}>Guardar cambios</Text>
        )}
      </TouchableOpacity>

      {(pushPermission.supported || pushPermission.iosNeedsInstall) && (
        <SectionCard icon="notifications-outline" title="Notificaciones">
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowText}>Notificaciones push</Text>
              <Text style={pushBloqueado ? styles.rowSubtextWarning : styles.rowSubtext}>
                {pushPermission.iosNeedsInstall
                  ? 'Agregá Greenfit a tu pantalla de inicio para activarlas.'
                  : pushBloqueado
                  ? 'Bloqueadas en este dispositivo.'
                  : 'Avisos de clases, vencimientos y novedades del gimnasio.'}
              </Text>
            </View>
            {pushPermission.isLoading ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : pushPermission.iosNeedsInstall ? (
              <TouchableOpacity style={styles.howToButton} onPress={() => setShowInstallModal(true)}>
                <Ionicons name="download-outline" size={13} color={colors.primary} />
                <Text style={styles.howToButtonText}>¿Cómo activarlas?</Text>
              </TouchableOpacity>
            ) : pushBloqueado ? (
              <TouchableOpacity style={styles.howToButton} onPress={() => setShowPushBlockedModal(true)}>
                <Ionicons name="lock-closed" size={13} color={colors.warning} />
                <Text style={styles.howToButtonText}>¿Cómo activarlas?</Text>
              </TouchableOpacity>
            ) : (
              <Switch
                value={pushPermission.enabled}
                onValueChange={handleTogglePush}
                trackColor={{ false: colors.surfaceAlt, true: colors.primary }}
                thumbColor={colors.white}
              />
            )}
          </View>
        </SectionCard>
      )}

      <PushBlockedModal visible={showPushBlockedModal} onClose={() => setShowPushBlockedModal(false)} />
      <PushNeedsInstallModal visible={showInstallModal} onClose={() => setShowInstallModal(false)} />

      <SectionCard icon="ellipsis-horizontal-circle-outline" title="Más opciones">
        <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('History')}>
          <Text style={styles.rowText}>Ver historial de clases</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </SectionCard>

      <TouchableOpacity style={styles.logout} onPress={logout}>
        <Ionicons name="log-out-outline" size={16} color={colors.danger} />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </TouchableOpacity>
    </ScrollView>
    <InstallAppButton bottomOffset={78} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  error: { color: colors.danger, marginBottom: 12 },
  bloqueoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(224, 185, 83, 0.12)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: 14,
    marginBottom: 16,
  },
  bloqueoBannerText: { flex: 1, color: colors.textPrimary, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    color: colors.textPrimary,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  inputLast: { marginBottom: 0 },
  inputDisabled: { color: colors.textSecondary },
  textArea: { height: 90, textAlignVertical: 'top' },
  saveButton: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 14 },
  saveButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  rowSubtext: { color: colors.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 16 },
  rowSubtextWarning: { color: colors.warning, fontSize: 12, marginTop: 3, lineHeight: 16, fontWeight: '600' },
  howToButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(224, 185, 83, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  howToButtonText: { color: colors.warning, fontSize: 12, fontWeight: '700' },
  logout: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  logoutText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
});
