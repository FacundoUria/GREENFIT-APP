import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { dniToEmail } from '../../lib/dni';
import InstallAppButton from '../../components/InstallAppButton';

// No hay auto-registro: las cuentas las crea el admin ("Gestión de socios").
// El socio ingresa con su DNI; por default, la contraseña también es su DNI
// hasta que el admin la resetee o el socio la cambie.
export default function LoginScreen() {
  const { login, isLoading } = useAuth();
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    setError('');
    try {
      // El admin (creado a mano, con email real) puede tipear su email tal
      // cual; el socio tipea su DNI y acá se arma el email sintético.
      const identifier = dni.trim();
      const email = identifier.includes('@') ? identifier : dniToEmail(identifier);
      await login(email, password);
    } catch (e: any) {
      setError(e.message ?? 'Error al iniciar sesión');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Greenfit</Text>

      <TextInput
        style={styles.input}
        placeholder="DNI"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        keyboardType="email-address"
        value={dni}
        onChangeText={setDni}
      />
      <View style={styles.passwordWrap}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Contraseña"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShowPassword((prev) => !prev)}
          hitSlop={10}
          accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.buttonText}>Ingresar</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>Ingresá con tu DNI.</Text>

      <InstallAppButton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '800', color: colors.primary, textAlign: 'center', marginBottom: 32 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    color: colors.textPrimary,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  passwordWrap: { position: 'relative', justifyContent: 'center', marginBottom: 14 },
  passwordInput: { paddingRight: 48, marginBottom: 0 },
  eyeButton: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  error: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
  hint: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 40 },
});
