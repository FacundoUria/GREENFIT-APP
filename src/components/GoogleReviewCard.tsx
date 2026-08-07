import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

// Fallback real a la ficha de Google Maps de GreenFit (Mendoza) -- se usa
// solo si EXPO_PUBLIC_GOOGLE_REVIEW_URL no está seteada en .env. Mismo
// criterio que el resto de la app con "no fingir": si el día de mañana se
// consigue un shortlink de reseña más directo, alcanza con editar el .env,
// sin tocar este componente.
const GOOGLE_REVIEW_URL_FALLBACK =
  'https://www.google.com/maps/place/GREEN+FIT/@-32.8675974,-68.8294067,17z/data=!3m1!4b1!4m6!3m5!1s0x967e08c4cee2dc95:0xb4fc10cec36073f5!8m2!3d-32.8675974!4d-68.8268318!16s%2Fg%2F11fzff33sk';

function getGoogleReviewUrl(): string {
  return process.env.EXPO_PUBLIC_GOOGLE_REVIEW_URL || GOOGLE_REVIEW_URL_FALLBACK;
}

// Tarjeta "dejanos tu reseña en Google" -- abre la ficha real de Google Maps
// de GreenFit en una pestaña/app externa. Sin XP ni tracking: es una simple
// invitación, no una acción gamificada.
export default function GoogleReviewCard() {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => Linking.openURL(getGoogleReviewUrl())}
      accessibilityLabel="Dejanos tu reseña en Google"
    >
      <View style={styles.iconCircle}>
        <Ionicons name="star" size={20} color={colors.warning} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>¿Te gusta entrenar en GreenFit?</Text>
        <Text style={styles.subtitle}>Dejanos tu reseña en Google -- ¡nos ayuda un montón! ⭐</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(224, 185, 83, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});
