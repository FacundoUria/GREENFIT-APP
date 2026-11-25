import React from 'react';
import { StyleSheet, View } from 'react-native';
import Esqueleto, { Hueso } from './Esqueleto';
import { colors } from '../theme/colors';
import { alfa, mockup } from '../theme/agendaMockup';

// Esqueletos de cada pantalla, con las MISMAS medidas que las tarjetas
// reales (padding, bordes, radios, separaciones). Así, cuando llegan los
// datos, las tarjetas aparecen en el lugar del esqueleto, sin saltos. Si
// cambia el estilo de una tarjeta, hay que cambiarlo acá también.

const repetir = (n: number) => Array.from({ length: n }, (_, i) => i);

// Agenda: tarjetas de clase (AgendaMobileView: listContent + card).
export function EsqueletoAgenda({ cantidad = 3 }: { cantidad?: number }) {
  const hueso = mockup.surfaceContainerHigh;
  return (
    <Esqueleto style={estilos.agendaLista} testID="agenda-esqueleto">
      {repetir(cantidad).map((i) => (
        <View key={i} style={estilos.agendaCard}>
          {/* Alturas medidas en la tarjeta real (111 px): disciplina 20, hora 35, detalles 22. */}
          <View style={estilos.flex}>
            <Hueso ancho={72} alto={12} color={hueso} style={{ marginTop: 2, marginBottom: 6 }} />
            <Hueso ancho={112} alto={30} radio={8} color={hueso} style={{ marginBottom: 5 }} />
            <Hueso ancho="70%" alto={11} color={hueso} style={{ marginTop: 11 }} />
          </View>
          <Hueso ancho={104} alto={48} radio={12} color={hueso} />
        </View>
      ))}
    </Esqueleto>
  );
}

// Inicio: carrusel de créditos (CreditosCarousel: scroll + fila + card).
export function EsqueletoCreditos({ cantidad = 3 }: { cantidad?: number }) {
  return (
    <Esqueleto style={estilos.creditosFila} testID="creditos-esqueleto">
      {repetir(cantidad).map((i) => (
        <View key={i} style={estilos.creditoCard}>
          <Hueso ancho={64} alto={18} radio={999} />
          <Hueso ancho={44} alto={36} radio={8} />
          <Hueso ancho={58} alto={10} />
        </View>
      ))}
    </Esqueleto>
  );
}

// Mi Rutina, "Rutina de hoy": barra de sesión + ejercicios (UserRoutineScreen:
// sesionBar + exerciseCard).
export function EsqueletoRutina({ cantidad = 3 }: { cantidad?: number }) {
  return (
    <Esqueleto testID="rutina-esqueleto">
      {/* Barra real: 98 px (fila de 40 + 14 + barra de 10). */}
      <View style={estilos.sesionBar}>
        <View style={estilos.fila}>
          <View style={[estilos.fila, { gap: 10 }]}>
            <Hueso ancho={11} alto={11} radio={6} />
            <View>
              <Hueso ancho={96} alto={12} />
              <Hueso ancho={120} alto={20} style={{ marginTop: 6 }} />
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Hueso ancho={36} alto={22} />
            <Hueso ancho={78} alto={12} style={{ marginTop: 6 }} />
          </View>
        </View>
        <Hueso ancho="100%" alto={10} radio={5} />
      </View>
      {/* Ejercicio real: 164 px (etiqueta 20, nombre 20, series y carga en dos filas de 32). */}
      {repetir(cantidad).map((i) => (
        <View key={i} style={estilos.ejercicioCard}>
          <View style={estilos.flex}>
            <View style={[estilos.fila, { justifyContent: 'flex-start', gap: 8, marginBottom: 6 }]}>
              <Hueso ancho={92} alto={20} />
              <Hueso ancho={36} alto={14} />
            </View>
            <Hueso ancho="60%" alto={20} />
            <Hueso ancho={80} alto={32} radio={12} style={{ marginTop: 10 }} />
            <Hueso ancho={126} alto={32} radio={12} style={{ marginTop: 8 }} />
          </View>
          <Hueso ancho={56} alto={56} radio={16} />
        </View>
      ))}
    </Esqueleto>
  );
}

// Mi Rutina, "Entrenamientos": el renglón "TUS ENTRENAMIENTOS · N" y las
// tarjetas de sesión (UserRoutineScreen: historialTituloRow + sesionCard; la
// real con un ejercicio mide 168 px).
export function EsqueletoEntrenamientos({ cantidad = 3 }: { cantidad?: number }) {
  return (
    <Esqueleto testID="entrenamientos-esqueleto">
      <View style={[estilos.fila, { height: 15, marginTop: 2, marginBottom: 12 }]}>
        <Hueso ancho={130} alto={11} />
        <Hueso ancho={70} alto={11} />
      </View>
      {repetir(cantidad).map((i) => (
        <View key={i} style={[estilos.tarjeta, { borderRadius: 24, padding: 20, marginBottom: 14 }]}>
          <View style={estilos.sesionEncabezado}>
            <Hueso ancho={120} alto={12} style={{ marginVertical: 1.5 }} />
            <View style={[estilos.fila, { marginTop: 4, height: 24 }]}>
              <Hueso ancho="50%" alto={18} />
              <Hueso ancho={84} alto={24} radio={12} />
            </View>
          </View>
          <View style={[estilos.fila, { paddingTop: 12, height: 32 }]}>
            <Hueso ancho="45%" alto={13} />
            <Hueso ancho={76} alto={13} />
          </View>
          <View style={{ alignItems: 'flex-end', justifyContent: 'center', height: 38 }}>
            <Hueso ancho={170} alto={14} />
          </View>
        </View>
      ))}
    </Esqueleto>
  );
}

// "Mis rutinas": tarjetas de rutina (MisRutinasView: card). También sirve
// para otras listas de tarjetas: cambian el radio, el padding y la separación.
export function EsqueletoTarjetas({
  cantidad = 3,
  radio = 20,
  padding = 16,
  separacion = 10,
  testID = 'tarjetas-esqueleto',
}: {
  cantidad?: number;
  radio?: number;
  padding?: number;
  separacion?: number;
  testID?: string;
}) {
  return (
    <Esqueleto testID={testID}>
      {repetir(cantidad).map((i) => (
        <View key={i} style={[estilos.tarjeta, { borderRadius: radio, padding, marginBottom: separacion }]}>
          <Hueso ancho="55%" alto={15} />
          <Hueso ancho="40%" alto={12} style={{ marginTop: 8 }} />
          <Hueso ancho="30%" alto={12} style={{ marginTop: 6 }} />
        </View>
      ))}
    </Esqueleto>
  );
}

const estilos = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  agendaLista: { paddingHorizontal: 24, paddingTop: 20, gap: 14 },
  agendaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: mockup.surfaceContainerLow,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: alfa(mockup.outlineVariant, 0.5),
  },

  creditosFila: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  creditoCard: {
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

  sesionBar: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
    gap: 14,
  },
  ejercicioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: colors.surfaceAlt,
    backgroundColor: colors.surface,
  },

  tarjeta: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  sesionEncabezado: { paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
});
