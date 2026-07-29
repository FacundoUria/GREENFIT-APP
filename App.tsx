import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import { ConfiguracionProvider } from './src/context/ConfiguracionContext';
import RootNavigator from './src/navigation/RootNavigator';
import { registerPwa } from './src/pwa/registerPwa';
import IosInstallBanner from './src/components/IosInstallBanner';
import AndroidInstallBanner from './src/components/AndroidInstallBanner';
import { colors } from './src/theme/colors';

export default function App() {
  useEffect(() => {
    registerPwa();
  }, []);

  return (
    <AuthProvider>
      <ConfiguracionProvider>
        <StatusBar style="light" />
        {/* En escritorio/pantallas anchas (solo web), la app queda centrada con
            ancho de celular en vez de estirarse de punta a punta -- mantiene
            la experiencia nativa de PWA. En nativo esto no hace nada (flex:1
            normal), el ancho del dispositivo ya es angosto. */}
        <View style={styles.shell}>
          <View style={styles.container}>
            <RootNavigator />
            <IosInstallBanner />
            <AndroidInstallBanner />
          </View>
        </View>
      </ConfiguracionProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  shell:
    Platform.OS === 'web'
      ? { flex: 1, minHeight: '100vh' as any, backgroundColor: colors.background, alignItems: 'center' }
      : { flex: 1 },
  container: Platform.OS === 'web' ? { flex: 1, width: '100%', maxWidth: 480 } : { flex: 1 },
});
