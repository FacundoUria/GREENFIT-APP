// Copiar alias/CVU al portapapeles. Sin `expo-clipboard` a propósito -- no
// hay ninguna dependencia de portapapeles instalada en el proyecto todavía
// (ver package.json), y el deploy real de esta app es la PWA (Web): agregar
// una librería nativa nueva para un botón de copiar en un proyecto sin
// staging es más riesgo del que vale, cuando `navigator.clipboard` ya cubre
// el 100% del target real. En nativo (Android/iOS vía Expo Go/build) esto
// devuelve `false` sin romper nada -- el socio siempre puede seleccionar y
// copiar el alias a mano igual, el texto sigue visible en pantalla.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // sigue al `return false` de abajo
  }
  return false;
}
