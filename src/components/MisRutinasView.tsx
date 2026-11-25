import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Tocable from './Tocable';
import Aparecer from './Aparecer';
import { EsqueletoTarjetas } from './Esqueletos';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { formatShortDate } from '../lib/dateFormat';
import {
  getMisRutinasAnteriores,
  getRutina,
  getSesionesDeRutina,
  DiaHistorial,
  RutinaAnterior,
} from '../lib/routinesApi';
import { Routine } from '../types';

// Pestaña "Mis rutinas" de Mi Rutina (historial de rutinas, Fase 1): la rutina actual y
// el "Historial de rutinas" con las anteriores, de la más nueva a la más vieja. Cada una
// se abre en SOLO LECTURA: sus días y ejercicios, y los entrenamientos que el socio
// registró en ella con la carga que usó. Nada se edita ni se tilda acá.

const VERDE_TINTE = 'rgba(0, 255, 56, 0.10)';
const VERDE_BORDE = 'rgba(0, 255, 56, 0.28)';

function horaArgentina(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Mendoza',
  });
}

function rango(desde: string, hasta: string): string {
  return `Del ${formatShortDate(desde)} al ${formatShortDate(hasta)}`;
}

function textoEntrenamientos(n: number): string {
  return n === 1 ? '1 entrenamiento' : `${n} entrenamientos`;
}

export default function MisRutinasView({
  userId,
  rutinaActual,
  recarga = 0,
  onVerRutinaActual,
}: {
  userId: string;
  rutinaActual: Routine | null;
  recarga?: number;
  onVerRutinaActual: () => void;
}) {
  const [anteriores, setAnteriores] = useState<RutinaAnterior[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<RutinaAnterior | null>(null);

  useEffect(() => {
    let activo = true;
    setCargando(true);
    setError(null);
    getMisRutinasAnteriores(userId)
      .then((lista) => {
        if (activo) setAnteriores(lista);
      })
      .catch((err) => {
        if (activo) setError(err instanceof Error ? err.message : 'No se pudo cargar tu historial de rutinas.');
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, [userId, recarga]);

  if (abierta) return <RutinaSoloLectura rutina={abierta} onVolver={() => setAbierta(null)} />;

  const totalEjercicios = rutinaActual?.days.reduce((acc, d) => acc + d.exercises.length, 0) ?? 0;

  return (
    <>
      <Text style={[styles.seccionLabel, { marginBottom: 10 }]}>RUTINA ACTUAL</Text>
      {/* Cada tarjeta entra con <Aparecer>, en cascada. */}
      {rutinaActual ? (
        <Aparecer>
          <View style={[styles.card, styles.cardActual]}>
            <Text style={styles.cardTitulo}>{rutinaActual.title}</Text>
            <Text style={styles.cardMeta}>
              {[
                rutinaActual.vigenteDesde ? `Desde el ${formatShortDate(rutinaActual.vigenteDesde)}` : null,
                `${rutinaActual.days.length} ${rutinaActual.days.length === 1 ? 'día' : 'días'}`,
                `${totalEjercicios} ejercicios`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Tocable
              onPress={onVerRutinaActual}
              style={styles.botonVerActual}
              accessibilityRole="button"
              accessibilityLabel="Ir a la rutina de hoy"
            >
              <Ionicons name="flash" size={15} color={colors.onPrimary} />
              <Text style={styles.botonVerActualTexto}>Entrenar hoy</Text>
            </Tocable>
          </View>
        </Aparecer>
      ) : (
        <Aparecer>
          <View style={styles.card}>
            <Text style={styles.cardMeta}>Todavía no tenés una rutina asignada.</Text>
          </View>
        </Aparecer>
      )}

      <View style={styles.tituloRow}>
        <Text style={styles.seccionLabel}>HISTORIAL DE RUTINAS</Text>
        {!cargando && !error && <Text style={styles.cantidad}>{anteriores.length}</Text>}
      </View>

      {cargando ? (
        <EsqueletoTarjetas testID="mis-rutinas-esqueleto" />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : anteriores.length === 0 ? (
        <Aparecer>
          <View style={styles.card}>
            <Text style={styles.cardMeta}>
              Todavía no tenés rutinas anteriores. Cuando tu entrenador te asigne una nueva, la actual va a quedar guardada
              acá.
            </Text>
          </View>
        </Aparecer>
      ) : (
        anteriores.map((r) => (
          <Aparecer key={r.id}>
            <Tocable
              onPress={() => setAbierta(r)}
              style={styles.card}
              accessibilityRole="button"
              accessibilityLabel={`Ver rutina ${r.title}`}
            >
              <View style={styles.filaAnterior}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitulo}>{r.title}</Text>
                  <Text style={styles.cardMeta}>{rango(r.vigenteDesde, r.vigenteHasta)}</Text>
                  {r.entrenamientos > 0 && <Text style={styles.cardMeta}>{textoEntrenamientos(r.entrenamientos)}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </View>
            </Tocable>
          </Aparecer>
        ))
      )}
    </>
  );
}

// Una rutina anterior, en solo lectura.
function RutinaSoloLectura({ rutina, onVolver }: { rutina: RutinaAnterior; onVolver: () => void }) {
  const [detalle, setDetalle] = useState<Routine | null>(null);
  const [sesiones, setSesiones] = useState<DiaHistorial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    Promise.all([getRutina(rutina.id), getSesionesDeRutina(rutina.id)])
      .then(([r, s]) => {
        if (!activo) return;
        setDetalle(r);
        setSesiones(s);
      })
      .catch((err) => {
        if (activo) setError(err instanceof Error ? err.message : 'No se pudo cargar la rutina.');
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, [rutina.id]);

  const listaSesiones = sesiones.flatMap((d) => d.sesiones.map((s) => ({ fecha: d.fecha, sesion: s })));

  return (
    <>
      <Tocable
        onPress={onVolver}
        style={styles.volver}
        accessibilityRole="button"
        accessibilityLabel="Volver a Mis rutinas"
      >
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
        <Text style={styles.volverTexto}>Mis rutinas</Text>
      </Tocable>

      <View style={[styles.card, { marginBottom: 14 }]}>
        <Text style={styles.cardTitulo}>{rutina.title}</Text>
        <Text style={styles.cardMeta}>{rango(rutina.vigenteDesde, rutina.vigenteHasta)}</Text>
        <View style={styles.badgeLectura}>
          <Ionicons name="lock-closed" size={12} color={colors.textSecondary} />
          <Text style={styles.badgeLecturaTexto}>Solo lectura</Text>
        </View>
        {!!detalle?.notes && <Text style={[styles.cardMeta, { marginTop: 8 }]}>{detalle.notes}</Text>}
      </View>

      {cargando ? (
        <EsqueletoTarjetas cantidad={2} testID="rutina-detalle-esqueleto" />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <>
          {(detalle?.days ?? []).map((dia) => (
            <Aparecer key={dia.id}>
              <View style={styles.card}>
                <Text style={[styles.seccionLabel, { marginBottom: 8 }]}>{(dia.title || 'Día').toUpperCase()}</Text>
                {dia.exercises.map((e) => (
                  <View key={e.id} style={styles.ejercicio}>
                    <Text style={styles.ejercicioNombre}>{e.exercise.name}</Text>
                    <Text style={styles.ejercicioDatos}>
                      {[
                        `${e.sets ?? '-'} × ${e.reps || '-'}`,
                        e.restSeconds ? `Descanso ${e.restSeconds} s` : null,
                        e.weightSuggestion ? `Sugerida ${e.weightSuggestion}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {!!e.notes && <Text style={styles.ejercicioNotas}>{e.notes}</Text>}
                  </View>
                ))}
              </View>
            </Aparecer>
          ))}

          <View style={styles.tituloRow}>
            <Text style={styles.seccionLabel}>TUS ENTRENAMIENTOS EN ESTA RUTINA</Text>
            <Text style={styles.cantidad}>{listaSesiones.length}</Text>
          </View>
          {listaSesiones.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardMeta}>No hay entrenamientos registrados en esta rutina.</Text>
            </View>
          ) : (
            listaSesiones.map(({ fecha, sesion }) => (
              <Aparecer key={sesion.sesionId}>
                <View style={styles.card}>
                  <Text style={styles.cardTitulo}>
                    {`${formatShortDate(fecha)} · ${horaArgentina(sesion.creadoEn)} hs`}
                  </Text>
                  {!!sesion.tituloDia && <Text style={styles.cardMeta}>{sesion.tituloDia}</Text>}
                  {sesion.ejercicios.map((e) => (
                    <View key={e.id} style={styles.sesionEjercicio}>
                      <Text style={styles.sesionEjercicioNombre}>{e.nombre}</Text>
                      <Text style={styles.sesionEjercicioDatos}>
                        {`${e.series ?? '-'} × ${e.repeticiones || '-'} · ${e.peso || 'Sin carga'}`}
                      </Text>
                    </View>
                  ))}
                </View>
              </Aparecer>
            ))
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  seccionLabel: { color: colors.primary, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5 },
  tituloRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  cantidad: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  cardActual: { borderColor: VERDE_BORDE, backgroundColor: VERDE_TINTE },
  cardTitulo: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  cardMeta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  botonVerActual: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: 44, // área mínima de toque (antes 35)
  },
  botonVerActualTexto: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
  filaAnterior: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volver: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12, alignSelf: 'flex-start', paddingVertical: 6 },
  volverTexto: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  badgeLectura: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: colors.surfaceAlt,
  },
  badgeLecturaTexto: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  ejercicio: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.surfaceAlt },
  ejercicioNombre: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  ejercicioDatos: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  ejercicioNotas: { color: colors.textSecondary, fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  sesionEjercicio: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  sesionEjercicioNombre: { color: colors.textPrimary, fontSize: 13, flex: 1 },
  sesionEjercicioDatos: { color: colors.textSecondary, fontSize: 12.5 },
  error: { color: colors.danger, fontSize: 13, marginTop: 8 },
});
