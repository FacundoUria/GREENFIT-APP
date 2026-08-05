import React from 'react';
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native';

// Componente único de avatar, reusado en TODA la app (Perfil, Feed,
// comentarios, Mensajes privados, Ranking) para que la foto de perfil
// sincronice de forma consistente en todos lados: si hay `uri` (viene de
// profiles.avatar_url, real o recién subida) se muestra la foto; si no,
// fallback a las iniciales con un fondo de color DINÁMICO por nombre (mismo
// color siempre para el mismo socio, distinto entre socios distintos -- no
// todo el mundo cae en el mismo verde de marca).

const AVATAR_PALETTE = ['#00FF38', '#3DDC97', '#5FA8FF', '#B98CFF', '#FF7BAC', '#FFB84D', '#FF6B6B', '#4DD0E1'];

function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getAvatarColor(name: string): string {
  if (!name) return AVATAR_PALETTE[0];
  return AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length];
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: number;
  // Acepta el style de View O de Image -- este componente renderiza uno u
  // otro según haya foto o no, así que el caller no tiene por qué saber
  // cuál de los dos va a terminar montado.
  style?: StyleProp<ViewStyle> | StyleProp<ImageStyle>;
}

export default function Avatar({ uri, name, size = 40, style }: AvatarProps) {
  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, dim, style as StyleProp<ImageStyle>]} />;
  }

  const color = getAvatarColor(name);
  return (
    <View style={[styles.fallback, dim, { backgroundColor: `${color}26`, borderColor: color }, style as StyleProp<ViewStyle>]}>
      <Text style={[styles.initials, { color, fontSize: size * 0.36 }]}>{getInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: '#27272A' },
  fallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  initials: { fontWeight: '800' },
});
