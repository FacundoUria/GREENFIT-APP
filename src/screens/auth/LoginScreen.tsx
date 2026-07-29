import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
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
      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        placeholderTextColor={colors.textSecondary}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

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
