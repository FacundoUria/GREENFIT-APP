// AsyncStorage real usa NativeModules que no existen en el entorno de test
// -- este es el mock oficial del propio paquete (en memoria, se resetea
// entre tests con jest.clearAllMocks en cada archivo que lo necesite).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// src/lib/supabase.ts llama a createClient() al importarse y explota si
// faltan estas dos env vars -- en CI/test no hay .env real, así que les
// ponemos un valor dummy (nunca se abre una conexión real: cada test que
// necesita comportamiento de red mockea supabase.from/rpc explícitamente).
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';

// Los sets de íconos reales (Ionicons, etc.) cargan su fuente con un
// setState async apenas montan, lo que dispara warnings de "not wrapped in
// act()" en cada test que renderiza un ícono -- son puramente decorativos
// acá, así que se reemplazan por un <Text> plano.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  function stubIcon(setName) {
    return function IconStub(props) {
      return React.createElement(Text, props, `${setName}:${props.name ?? ''}`);
    };
  }
  return new Proxy(
    {},
    {
      get: (_target, prop) => stubIcon(String(prop)),
    }
  );
});
