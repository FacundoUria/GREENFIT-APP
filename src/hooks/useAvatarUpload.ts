import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { checkAvatarDisponible, subirAvatarPerfil } from '../lib/avatarApi';

// Lógica de "tocar el avatar para cambiar la foto de perfil", extraída de
// PerfilMobileView.tsx para poder reusarla tal cual en la tarjeta de perfil
// gamificada que ahora también vive en Inicio (HomeScreen) -- mismo
// comportamiento exacto en los dos lugares, un solo lugar para mantenerlo.
export function useAvatarUpload(userId: string | undefined, onUploaded: (url: string) => void) {
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  async function handleAvatarPress() {
    if (!userId || isUploadingAvatar) return;
    const disponible = await checkAvatarDisponible();
    if (!disponible) {
      Alert.alert('Función no disponible', 'La foto de perfil todavía no está activada. Probá de nuevo más tarde.');
      return;
    }
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso necesario', 'Habilitá el acceso a tus fotos para poder cambiar tu foto de perfil.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (resultado.canceled || !resultado.assets[0]) return;

    setIsUploadingAvatar(true);
    try {
      const url = await subirAvatarPerfil(userId, resultado.assets[0].uri);
      onUploaded(url);
    } catch (err) {
      Alert.alert('No se pudo actualizar la foto', err instanceof Error ? err.message : 'Intentá de nuevo.');
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  return { isUploadingAvatar, handleAvatarPress };
}
