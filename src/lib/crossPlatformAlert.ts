import { Alert, Platform } from 'react-native';

// react-native-web implementa Alert.alert como un no-op literal
// (`static alert() {}`, node_modules/react-native-web/src/exports/Alert) --
// en Web (la PWA), Alert.alert('...', '...') no muestra NADA: ni error, ni
// éxito, ni nada. HomeScreen.tsx ya había descubierto esto para un caso
// puntual (mostrarErrorPago, ver el comentario ahí) pero el resto de la app
// -- reservar/cancelar en AgendaMobileView y HomeScreen -- seguía usando
// Alert.alert directo, así que cualquier error real de esos flujos (ej.
// "Sin créditos disponibles" que devuelve book_class) quedaba mudo: el
// socio tocaba la clase, el spinner desaparecía, y no pasaba nada más --
// percibido como "se queda pensando y nunca reserva".
//
// showAlert() es el reemplazo único para toda la app: mismo `title`/
// `message` de Alert.alert en nativo, y en Web usa window.alert (visible de
// verdad) en vez del no-op.
export function showAlert(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    // window.alert es un solo string: título y mensaje van juntos, separados
    // por una línea en blanco. Antes se mostraba solo el mensaje y el título
    // se perdía en web (ej. "Tu rutina se actualizó" no se veía).
    if (typeof window !== 'undefined') window.alert(textoAlertaWeb(title, message));
    return;
  }
  Alert.alert(title, message);
}

// Texto de window.alert en Web: "título\n\nmensaje", o el que venga si falta
// el otro (vacíos o solo espacios cuentan como faltantes).
export function textoAlertaWeb(title: string, message?: string): string {
  const titulo = title?.trim() ?? '';
  const cuerpo = message?.trim() ?? '';
  if (titulo && cuerpo) return `${titulo}\n\n${cuerpo}`;
  return cuerpo || titulo;
}
