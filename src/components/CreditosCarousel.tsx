import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { UserCredit } from '../types';

// Carrusel horizontal de créditos de Inicio: UNA tarjeta por disciplina
// activa del socio, en el orden que devuelve fetchUserBalances() -- ninguna
// cantidad fija de tarjetas, ningún nombre ni número escrito acá: todo sale
// de `balances` (user_credits + disciplines). Solo son texto fijo de UI las
// etiquetas ("créditos", "pase libre") y el símbolo "∞".
//
// Aparatos (kind='membership') es pase libre: sin número, "∞".
// Créditos (kind='credits'): remainingCredits real (la suma de sus lotes).

interface CreditosCarouselProps {
  balances: UserCredit[];
}

function CreditoCard({ balance }: { balance: UserCredit }) {
  const esPaseLibre = balance.discipline.kind === 'membership';
  const cantidad = balance.remainingCredits ?? 0;

  return (
    <View style={styles.card} testID={`credito-card-${balance.discipline.id}`}>
      <View style={styles.pill}>
        <Text style={styles.pillTexto} numberOfLines={1}>
          {balance.discipline.name}
        </Text>
      </View>
      <View style={styles.centro}>
        {esPaseLibre ? (
          <Text style={styles.infinito} accessibilityLabel="Pase libre">
            ∞
          </Text>
        ) : (
          <Text style={styles.numero}>{cantidad}</Text>
        )}
      </View>
      <View style={styles.pie}>
        <View style={styles.punto} />
        <Text style={[styles.etiqueta, esPaseLibre && styles.etiquetaPaseLibre]}>
          {esPaseLibre ? 'pase libre' : cantidad === 1 ? 'crédito' : 'créditos'}
        </Text>
      </View>
    </View>
  );
}

export default function CreditosCarousel({ balances }: CreditosCarouselProps) {
  if (balances.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.fila}
      testID="creditos-carrusel"
    >
      {balances.map((b) => (
        <CreditoCard key={b.discipline.id} balance={b} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Sangra a los bordes de la pantalla (la pantalla padea 20 a cada lado).
  scroll: { marginHorizontal: -20 },
  fila: { paddingHorizontal: 20, paddingVertical: 4, gap: 10 },
  card: {
    width: 112,
    minHeight: 132,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    borderRadius: 18,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    backgroundColor: colors.background,
  },
  pillTexto: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  numero: { color: colors.textPrimary, fontSize: 38, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  infinito: { color: colors.textPrimary, fontSize: 34, lineHeight: 40, fontWeight: '700' },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  punto: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  etiqueta: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  etiquetaPaseLibre: { color: colors.primary },
});
