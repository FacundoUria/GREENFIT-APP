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
    // window.alert es un solo string -- mismo criterio que ya usaba
    // mostrarErrorPago en HomeScreen.tsx: se muestra el mensaje (lo
    // accionable), no el título, para no duplicar/alargar el texto en un
    // alert nativo del navegador que no tiene layout para dos líneas.
    if (typeof window !== 'undefined') window.alert(message ?? title);
    return;
  }
  Alert.alert(title, message);
}
