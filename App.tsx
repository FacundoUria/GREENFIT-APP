import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { registerPwa } from './src/pwa/registerPwa';
import IosInstallBanner from './src/components/IosInstallBanner';

export default function App() {
  useEffect(() => {
    registerPwa();
  }, []);

  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
      <IosInstallBanner />
    </AuthProvider>
  );
}
