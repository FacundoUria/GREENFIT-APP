import { Alert, Platform } from 'react-native';
import { showAlert } from '../../lib/crossPlatformAlert';

// Test dedicado que faltaba: los 24 call sites migrados a showAlert()
// (ProfileScreen, ProgresoMobileView, UserRoutineScreen, ComunidadMobileView,
// useAvatarUpload, ProfileStack) tienen sus propios tests que espían
// Alert.alert -- pero jest-expo simula Platform.OS='ios' por defecto, así
// que esos tests SOLO ejercitan la rama nativa de showAlert() (la que
// nunca estuvo rota). El bug real que motivó todo esto es la rama Web
// (Alert.alert es un no-op mudo ahí) -- este archivo es el único lugar de
// toda la suite que fuerza Platform.OS='web' y confirma que showAlert()
// realmente usa window.alert en ese caso, en vez de asumirlo.
describe('showAlert (reemplazo de Alert.alert -- no-op mudo en react-native-web)', () => {
  const originalPlatformOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalPlatformOS;
    delete (window as any).alert;
    jest.restoreAllMocks();
  });

  it('en Web, usa window.alert con el mensaje (no el título -- window.alert es un solo string)', () => {
    Platform.OS = 'web';
    // jest.spyOn exige que la propiedad ya exista -- window.alert no existe
    // en este entorno de test (jest-expo no corre en un browser real), así
    // que se asigna un stub directo en vez de espiar uno inexistente.
    const windowAlertSpy = jest.fn();
    window.alert = windowAlertSpy;
    const nativeAlertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    showAlert('No se pudo reservar', 'Sin créditos disponibles para esta disciplina');

    expect(windowAlertSpy).toHaveBeenCalledWith('Sin créditos disponibles para esta disciplina');
    expect(nativeAlertSpy).not.toHaveBeenCalled();
  });

  it('en Web sin `message` (solo título), usa el título como texto de window.alert', () => {
    Platform.OS = 'web';
    const windowAlertSpy = jest.fn();
    window.alert = windowAlertSpy;

    showAlert('Guardado');

    expect(windowAlertSpy).toHaveBeenCalledWith('Guardado');
  });

  it('en nativo (iOS/Android), usa Alert.alert real con título Y mensaje -- no window.alert', () => {
    Platform.OS = 'ios';
    const windowAlertSpy = jest.fn();
    window.alert = windowAlertSpy;
    const nativeAlertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    showAlert('Guardado', 'Tus datos se actualizaron.');

    expect(nativeAlertSpy).toHaveBeenCalledWith('Guardado', 'Tus datos se actualizaron.');
    expect(windowAlertSpy).not.toHaveBeenCalled();
  });
});
