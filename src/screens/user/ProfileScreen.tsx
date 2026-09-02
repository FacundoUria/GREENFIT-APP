import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { showAlert } from '../../lib/crossPlatformAlert';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { usePushPermission } from '../../hooks/usePushPermission';
import PushBlockedModal from '../../components/PushBlockedModal';
import PushNeedsInstallModal from '../../components/PushNeedsInstallModal';
import InstallAppButton from '../../components/InstallAppButton';

interface ProfileForm {
  fullName: string;
  dni: string;
  email: string;
  phone: string;
  domicilio: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  medicalNotes: string;
}

// Nombre/Apellido son un pedido explícito del cliente como campos
// separados, pero `profiles` sigue guardando un único full_name (identidad
// que carga/corrige el admin) -- se parte solo para MOSTRARLO acá, no hay
// columnas nuevas de nombre/apellido ni se persiste nada distinto.
function splitFullName(fullName: string): { nombre: string; apellido: string } {
  const trimmed = fullName.trim();
  const primerEspacio = trimmed.indexOf(' ');
  if (primerEspacio === -1) return { nombre: trimmed, apellido: '' };
  return { nombre: trimmed.slice(0, primerEspacio), apellido: trimmed.slice(primerEspacio + 1) };
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

async function loadProfile(userId: string): Promise<ProfileForm> {
  let { data, error } = await supabase
    .from('profiles')
    .select('full_name, dni, email, phone, domicilio, emergency_contact_name, emergency_contact_phone, medical_notes')
    .eq('id', userId)
    .single();

  // 42703 = undefined_column -- domicilio es la columna más nueva de todas
  // (supabase_migration_domicilio_y_sync_telefono.sql), puede no existir
  // todavía en este ambiente. Sin este fallback, un select que pide una
  // columna que no existe falla COMPLETO (no devuelve el resto de campos
  // parcialmente), así que "Mis datos" quedaría rota entera por una sola
  // columna ausente -- se reintenta sin ella en vez de eso.
  if (error?.code === '42703') {
    ({ data, error } = await supabase
      .from('profiles')
      .select('full_name, dni, email, phone, emergency_contact_name, emergency_contact_phone, medical_notes')
      .eq('id', userId)
      .single());
  }

  if (error || !data) throw new Error(error?.message ?? 'No se pudo cargar tu perfil.');
  return {
    fullName: data.full_name,
    dni: data.dni ?? '',
    email: (data as any).email ?? '',
    phone: data.phone ?? '',
    domicilio: (data as any).domicilio ?? '',
    emergencyContactName: data.emergency_contact_name ?? '',
    emergencyContactPhone: data.emergency_contact_phone ?? '',
    medicalNotes: data.medical_notes ?? '',
  };
}

// Foco exclusivo en los datos de la cuenta del socio. Nombre/Apellido, DNI y
// Correo son de solo lectura (identidad del socio, la carga/corrige el
// admin desde Gestión de socios); Teléfono, Domicilio y Contacto de
// emergencia los edita el propio socio.
//
// Perfil obligatorio (pedido del cliente): si faltan Nombre, Apellido, DNI,
// Correo, Teléfono, Teléfono de emergencia o Domicilio, ProfileStack.tsx
// redirige acá UNA SOLA VEZ al entrar a la pestaña Perfil Y bloquea el
// resto de las pantallas DE ESA PESTAÑA (listado, Historial, Progreso) --
// el resto de la app (Inicio, Agenda, Mi Rutina, Comunidad) sigue 100%
// accesible, ver MainTabs.tsx/ProfileStack.tsx. Acá solo mostramos un
// banner informativo (`bloqueado`) mientras falten.
export default function ProfileScreen({ navigation }: any) {
  const { user, logout, marcarPerfilCompleto } = useAuth();
  const bloqueado = !!user && !user.perfilCompleto;
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
      showAlert('No se pudo actualizar', err instanceof Error ? err.message : 'Intentá de nuevo.');
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

    // Obligatorios SIEMPRE (no solo mientras está bloqueado) -- una vez
    // cargados, no deben poder volver a quedar vacíos por accidente. Nombre/
    // Apellido/DNI/Correo no se validan acá porque son de solo lectura (si
    // llegaran vacíos, no hay nada que el socio pueda hacer desde esta
    // pantalla para corregirlos -- eso lo resuelve el admin). Contacto de
    // emergencia (nombre) y Ficha médica quedaron afuera del set obligatorio
    // a pedido explícito del cliente -- siguen siendo editables, solo que
    // ya no bloquean el guardado si quedan vacíos.
    const phone = form.phone.trim();
    const domicilio = form.domicilio.trim();
    const emergencyContactPhone = form.emergencyContactPhone.trim();
    if (!phone || !domicilio || !emergencyContactPhone) {
      showAlert('Faltan datos obligatorios', 'Completá Teléfono, Domicilio y Teléfono de emergencia antes de guardar.');
      return;
    }

    setIsSaving(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          phone,
          domicilio,
          emergency_contact_name: form.emergencyContactName.trim() || null,
          emergency_contact_phone: emergencyContactPhone,
          medical_notes: form.medicalNotes.trim() || null,
        })
        .eq('id', user.id);
      if (updateError) throw new Error(updateError.message);

      // Sincronización estricta con el panel Admin: `socios.telefono` (la
      // ficha que lee el botón de WhatsApp del Admin) es una tabla
      // SEPARADA de `profiles`, bridgeada por DNI -- sin este RPC el
      // teléfono actualizado acá nunca le llegaría a esa grilla. Best-effort
      // a propósito (no revienta el guardado si la migración todavía no
      // corrió o la cuenta no está vinculada a ninguna ficha de socios).
      const { error: syncError } = await supabase.rpc('sincronizar_telefono_a_socio');
      if (syncError) {
        console.warn('[GreenFit] No se pudo sincronizar el teléfono con el panel Admin:', syncError.message);
      }

      // Desbloquea la pestaña Perfil al instante si hacía falta -- no-op
      // inofensivo si ya estaba completo de antes.
      marcarPerfilCompleto();
      showAlert('Guardado', 'Tus datos se actualizaron.');
    } catch (err) {
      showAlert('Error', err instanceof Error ? err.message : 'No se pudo guardar.');
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
        <View style={styles.bloqueoBanner} accessibilityLabel="Perfil incompleto">
          <Ionicons name="alert-circle" size={18} color={colors.warning} />
          <Text style={styles.bloqueoBannerText}>
            Por seguridad, el gimnasio exige tener completos tus datos antes de usar el resto de tu Perfil. Completá
            Teléfono, Domicilio y Teléfono de emergencia y tocá "Guardar cambios" para continuar.
          </Text>
        </View>
      )}

      <SectionCard icon="person-outline" title="Mis datos">
        <FieldLabel>Nombre</FieldLabel>
        <TextInput style={[styles.input, styles.inputDisabled]} value={splitFullName(form.fullName).nombre} editable={false} />
        <FieldLabel>Apellido</FieldLabel>
        <TextInput style={[styles.input, styles.inputDisabled]} value={splitFullName(form.fullName).apellido} editable={false} />
        <FieldLabel>DNI</FieldLabel>
        <TextInput style={[styles.input, styles.inputDisabled]} value={form.dni} editable={false} />
        <FieldLabel>Correo</FieldLabel>
        <TextInput style={[styles.input, styles.inputDisabled]} value={form.email} editable={false} />
        <Text style={styles.helperText}>
          Nombre, Apellido, DNI y Correo los administra el gimnasio -- para corregirlos, contactá a recepción.
        </Text>
        <FieldLabel>Teléfono *</FieldLabel>
        <TextInput
          style={styles.input}
          placeholder="Teléfono / WhatsApp"
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(v) => setForm({ ...form, phone: v })}
        />
        <FieldLabel>Domicilio *</FieldLabel>
        <TextInput
          style={[styles.input, styles.inputLast]}
          placeholder="Calle, número, localidad"
          placeholderTextColor={colors.textSecondary}
          value={form.domicilio}
          onChangeText={(v) => setForm({ ...form, domicilio: v })}
        />
      </SectionCard>

      <SectionCard icon="alert-circle-outline" title="Contacto de emergencia">
        <FieldLabel>Nombre del contacto</FieldLabel>
        <TextInput
          style={styles.input}
          placeholder="Nombre del contacto"
          placeholderTextColor={colors.textSecondary}
          value={form.emergencyContactName}
          onChangeText={(v) => setForm({ ...form, emergencyContactName: v })}
        />
        <FieldLabel>Teléfono de emergencia *</FieldLabel>
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

      {/* "Ver historial de clases" navega a una ruta ("History") que solo
          existe en el ProfileStack completo -- mientras `bloqueado` es
          true, esa pila vive reducida a solo esta pantalla (ver
          ProfileStack.tsx), esa ruta no está registrada ahí. */}
      {!bloqueado && (
        <SectionCard icon="ellipsis-horizontal-circle-outline" title="Más opciones">
          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('History')}>
            <Text style={styles.rowText}>Ver historial de clases</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </SectionCard>
      )}

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
  fieldLabel: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '700', marginBottom: 4, marginLeft: 2 },
  helperText: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: -2, marginBottom: 14 },
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
