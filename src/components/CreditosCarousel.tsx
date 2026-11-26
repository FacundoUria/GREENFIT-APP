import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { UserCredit } from '../types';
import { DisciplinaSinVigente } from '../lib/planSinVigente';
import Aparecer from './Aparecer';

// Carrusel horizontal de créditos de Inicio: UNA tarjeta por disciplina
// activa del socio, en el orden que devuelve fetchUserBalances() -- ninguna
// cantidad fija de tarjetas, ningún nombre ni número escrito acá: todo sale
// de `balances` (user_credits + disciplines). Solo son texto fijo de UI las
// etiquetas ("créditos", "pase libre") y el símbolo "∞".
//
// Aparatos (kind='membership') es pase libre: sin número, "∞".
// Créditos (kind='credits'): remainingCredits real (la suma de sus lotes).
// Después de las activas, en gris, las que el socio tuvo y hoy no tiene
// vigentes (`sinVigente`, caso parcial de "Renovar"): solo informativas.

interface CreditosCarouselProps {
  balances: UserCredit[];
  // Caso parcial de "Renovar": disciplinas que el socio tuvo y hoy no tiene
  // vigentes. Van al final, en gris, solo informativas (no se tocan).
  sinVigente?: DisciplinaSinVigente[];
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

// Tarjeta gris: misma forma que las demás, sin número real. Créditos: "0" y
// "Sin créditos". Aparatos (pase libre vencido): "—" y "Vencido".
function SinVigenteCard({ disciplina }: { disciplina: DisciplinaSinVigente }) {
  const esPaseLibre = disciplina.kind === 'membership';
  const etiqueta = esPaseLibre ? 'Vencido' : 'Sin créditos';
  return (
    <View
      style={[styles.card, styles.cardSinVigente]}
      testID={`credito-card-sin-vigente-${disciplina.disciplineId}`}
      accessibilityLabel={`${disciplina.name}: ${etiqueta.toLowerCase()}`}
    >
      <View style={styles.pill}>
        <Text style={styles.pillTexto} numberOfLines={1}>
          {disciplina.name}
        </Text>
      </View>
      <View style={styles.centro}>
        <Text style={[styles.numero, styles.numeroSinVigente]}>{esPaseLibre ? '—' : '0'}</Text>
      </View>
      <View style={styles.pie}>
        <View style={[styles.punto, styles.puntoSinVigente]} />
        <Text style={styles.etiqueta}>{etiqueta}</Text>
      </View>
    </View>
  );
}

export default function CreditosCarousel({ balances, sinVigente = [] }: CreditosCarouselProps) {
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
        <Aparecer key={b.discipline.id}>
          <CreditoCard balance={b} />
        </Aparecer>
      ))}
      {sinVigente.map((d) => (
        <Aparecer key={`sin-vigente-${d.disciplineId}`}>
          <SinVigenteCard disciplina={d} />
        </Aparecer>
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
  // Variante gris (sin vigente): apagada, sin el verde del punto.
  cardSinVigente: { opacity: 0.55 },
  numeroSinVigente: { color: colors.textSecondary },
  puntoSinVigente: { backgroundColor: colors.textSecondary },
});
