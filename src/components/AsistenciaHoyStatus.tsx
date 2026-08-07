import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchAsistenciaHoyRegistrada } from '../lib/xpApi';

interface AsistenciaHoyStatusProps {
  userId: string;
}

// Estado de SOLO LECTURA de la asistencia de hoy -- reemplaza al viejo
// HoyEntreneButton.tsx (botón de autoreporte). Regla vigente: los +100 XP
// diarios SOLO los puede acreditar el Admin (Check-in Rápido desde el
// Dashboard, o la asistencia confirmada de una clase reservada) -- el socio
// ya no tiene ninguna acción para otorgárselos él mismo, este widget
// únicamente refleja si ya están acreditados hoy. Ver
// backend/supabase_migration_xp_solo_asistencia.sql.
export default function AsistenciaHoyStatus({ userId }: AsistenciaHoyStatusProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [yaRegistrado, setYaRegistrado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetchAsistenciaHoyRegistrada(userId)
      .then((registrado) => {
        if (!cancelado) setYaRegistrado(registrado);
      })
      .catch(() => {
        // Si falla la carga, queda en el estado neutro por defecto -- mejor
        // eso que bloquear el dashboard entero por este widget secundario.
      })
      .finally(() => {
        if (!cancelado) setIsLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [userId]);

  if (isLoading) return null;

  const texto = yaRegistrado ? '¡Seba registró tu asistencia! Sumaste +100 XP hoy' : 'Esperando check-in en el gimnasio...';

  return (
    <View style={[styles.status, yaRegistrado && styles.statusDone]} accessibilityLabel={texto}>
      <Ionicons
        name={yaRegistrado ? 'checkmark-circle' : 'time-outline'}
        size={18}
        color={yaRegistrado ? colors.primary : colors.textSecondary}
      />
      <Text style={[styles.text, yaRegistrado && styles.textDone]}>{texto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  statusDone: { backgroundColor: colors.surface, borderColor: colors.primary },
  text: { color: colors.textSecondary, fontWeight: '700', fontSize: 13.5 },
  textDone: { color: colors.primary },
});
