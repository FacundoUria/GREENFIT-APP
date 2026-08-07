import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

interface GlobalAlertBannerProps {
  activa: boolean;
  mensaje: string;
}

// Un aviso descartado se recuerda por su TEXTO, no por un flag genérico --
// así un socio que ya cerró "el sábado cerramos a las 14hs" no lo vuelve a
// ver en cada apertura de la app, pero SÍ ve el próximo aviso real que el
// admin escriba (mensaje distinto = clave distinta).
function claveDescartada(mensaje: string): string {
  return `greenfit:alerta-global-descartada:${mensaje}`;
}

// Banner flotante de "Alerta Global" -- se muestra al cargar Inicio si el
// admin la activó desde Configuración (alerta_app_activa/alerta_app_mensaje
// en `configuracion`, ver ConfiguracionContext.tsx). 100% presentacional:
// no otorga XP ni escribe nada más allá de recordar "ya lo cerré" en
// AsyncStorage, local al dispositivo.
export default function GlobalAlertBanner({ activa, mensaje }: GlobalAlertBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function verificar() {
      const mensajeLimpio = mensaje.trim();
      if (!activa || !mensajeLimpio) {
        if (!cancelado) setVisible(false);
        return;
      }
      try {
        const descartada = await AsyncStorage.getItem(claveDescartada(mensajeLimpio));
        if (!cancelado) setVisible(!descartada);
      } catch {
        // Si falla la lectura local, mejor mostrar el aviso de más que
        // ocultar un aviso real por un problema de storage.
        if (!cancelado) setVisible(true);
      }
    }
    verificar();
    return () => {
      cancelado = true;
    };
  }, [activa, mensaje]);

  async function handleDescartar() {
    setVisible(false);
    try {
      await AsyncStorage.setItem(claveDescartada(mensaje.trim()), '1');
    } catch {
      // Best-effort -- si falla, en la próxima apertura vuelve a aparecer,
      // no es grave.
    }
  }

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleDescartar}>
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="megaphone" size={18} color={colors.primary} />
          </View>
          <Text style={styles.mensaje}>{mensaje.trim()}</Text>
          <TouchableOpacity
            onPress={handleDescartar}
            hitSlop={10}
            accessibilityLabel="Cerrar aviso"
            style={styles.closeButton}
          >
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Sin backdrop oscuro a propósito -- es un banner flotante que se lee
  // mientras seguís viendo el resto de la pantalla, no un diálogo bloqueante.
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 255, 56, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mensaje: { flex: 1, color: colors.textPrimary, fontSize: 13.5, fontWeight: '600', lineHeight: 19, marginTop: 5 },
  closeButton: { padding: 4 },
});
