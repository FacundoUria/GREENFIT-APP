import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { colors } from '../../theme/colors';

export default function NotificationsScreen() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  function sendMassNotification() {
    if (!title || !body) {
      Alert.alert('Faltan datos', 'Completá título y mensaje.');
      return;
    }
    // TODO real: POST /notifications { userId: null, title, body }
    // El backend dispara push vía Expo Notifications a todos los tokens registrados.
    Alert.alert('Enviado (mock)', `"${title}" se envió a todos los socios.`);
    setTitle('');
    setBody('');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Notificación masiva</Text>
      <TextInput
        style={styles.input}
        placeholder="Título"
        placeholderTextColor={colors.textSecondary}
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Mensaje"
        placeholderTextColor={colors.textSecondary}
        multiline
        value={body}
        onChangeText={setBody}
      />
      <TouchableOpacity style={styles.button} onPress={sendMassNotification}>
        <Text style={styles.buttonText}>Enviar a todos los socios</Text>
      </TouchableOpacity>

      <Text style={styles.note}>
        Envío individual: se agrega igual, pasando userId en vez de null. Requiere que la app
        pida permiso de push y registre el token del dispositivo (Expo Notifications).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  header: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 20 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    color: colors.textPrimary,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center' },
  buttonText: { color: colors.white, fontWeight: '700' },
  note: { color: colors.textSecondary, fontSize: 12, marginTop: 24, lineHeight: 18 },
});
