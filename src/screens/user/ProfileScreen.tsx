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

interface ProfileForm {
  fullName: string;
  dni: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  medicalNotes: string;
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
export default function ProfileScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPushBlockedModal, setShowPushBlockedModal] = useState(false);
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
    setIsSaving(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          phone: form.phone.trim() || null,
          emergency_contact_name: form.emergencyContactName.trim() || null,
          emergency_contact_phone: form.emergencyContactPhone.trim() || null,
          medical_notes: form.medicalNotes.trim() || null,
        })
        .eq('id', user.id);
      if (updateError) throw new Error(updateError.message);
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
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.sectionTitle}>Mis datos</Text>
      <TextInput style={[styles.input, styles.inputDisabled]} value={form.fullName} editable={false} />
      <TextInput style={[styles.input, styles.inputDisabled]} value={form.dni} editable={false} />
      <TextInput
        style={styles.input}
        placeholder="Teléfono / WhatsApp"
        placeholderTextColor={colors.textSecondary}
        keyboardType="phone-pad"
        value={form.phone}
        onChangeText={(v) => setForm({ ...form, phone: v })}
      />

      <Text style={styles.sectionTitle}>Contacto de emergencia</Text>
      <TextInput
        style={styles.input}
        placeholder="Nombre del contacto"
        placeholderTextColor={colors.textSecondary}
        value={form.emergencyContactName}
        onChangeText={(v) => setForm({ ...form, emergencyContactName: v })}
      />
      <TextInput
        style={styles.input}
        placeholder="Teléfono del contacto"
        placeholderTextColor={colors.textSecondary}
        keyboardType="phone-pad"
        value={form.emergencyContactPhone}
        onChangeText={(v) => setForm({ ...form, emergencyContactPhone: v })}
      />

      <Text style={styles.sectionTitle}>Ficha médica</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Lesiones, condiciones físicas u otras observaciones..."
        placeholderTextColor={colors.textSecondary}
        multiline
        value={form.medicalNotes}
        onChangeText={(v) => setForm({ ...form, medicalNotes: v })}
      />

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.saveButtonText}>Guardar cambios</Text>
        )}
      </TouchableOpacity>

      {pushPermission.supported && (
        <>
          <Text style={styles.sectionTitle}>Notificaciones</Text>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowText}>Notificaciones push</Text>
              <Text style={pushBloqueado ? styles.rowSubtextWarning : styles.rowSubtext}>
                {pushBloqueado
                  ? 'Bloqueadas en este dispositivo.'
                  : 'Avisos de clases, vencimientos y novedades del gimnasio.'}
              </Text>
            </View>
            {pushPermission.isLoading ? (
              <ActivityIndicator color={colors.primary} size="small" />
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
        </>
      )}

      <PushBlockedModal visible={showPushBlockedModal} onClose={() => setShowPushBlockedModal(false)} />

      <Text style={styles.sectionTitle}>Más opciones</Text>
      <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('History')}>
        <Text style={styles.rowText}>Ver historial de clases</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.logout} onPress={logout}>
        <Ionicons name="log-out-outline" size={16} color={colors.danger} />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  error: { color: colors.danger, marginBottom: 12 },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    color: colors.textPrimary,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  inputDisabled: { color: colors.textSecondary, backgroundColor: colors.background },
  textArea: { height: 90, textAlignVertical: 'top' },
  saveButton: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  saveButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    marginBottom: 12,
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
    marginTop: 8,
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  logoutText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
});
