# Green Fit — App demo

## Setup Supabase (una sola vez)

1. Entrá a tu proyecto de Supabase → **SQL Editor** → pegá el contenido completo de
   `backend/supabase-schema.sql` → Run. Esto crea las tablas, el trigger de registro
   y las políticas de seguridad (RLS).
2. Andá a **Settings → API** y copiá `Project URL` y `anon public key`.
3. En la raíz del proyecto, copiá `.env.example` como `.env` y pegá esos dos valores.
4. (Opcional pero recomendado) En **Authentication → Providers → Email**, decidí si
   querés confirmación de mail obligatoria. Si la dejás activada, el registro no
   loguea directo — el usuario tiene que confirmar el mail primero (la app ya
   contempla ese caso).

## Cómo correr la app

1. Instalá Node.js LTS si no lo tenés: https://nodejs.org
2. Instalá **Expo Go** en tu celular.
3. En la terminal, parado en esta carpeta:
   ```
   npm install
   npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
   npx expo start
   ```
4. Escaneá el QR con Expo Go.
5. Registrate con un mail real. El primer usuario que crees va a tener rol "socio"
   por default (así lo define el trigger). Para probar el panel admin, entrá a
   Supabase → Table Editor → `profiles` → editá esa fila → `role = admin`.

## Qué es real ahora y qué sigue siendo mock

- **Real**: auth completo (registro, login, logout, sesión persistida), rol leído
  desde `profiles` vía Supabase, RLS protegiendo cada tabla.
- **Mock todavía**: packs, horarios, historial y roster siguen en `useState` local
  (no leen ni escriben Supabase). El botón "Voy" no descuenta créditos reales ni
  inserta en `bookings` — solo cambia el estado en pantalla.

## Próximo paso lógico

Conectar `BookingScreen`, `HomeScreen`, `DashboardScreen` y `ClassRosterScreen` a
las tablas reales (`schedules`, `user_credits`, `bookings`). El punto más delicado
ahí no es el CRUD — es evitar que dos personas reserven el último cupo al mismo
tiempo. Para eso conviene una función de Postgres (`book_class`, vía RPC) que
chequee y reserve en una sola transacción, en vez de hacerlo con dos llamadas
separadas desde el cliente (leer cupo, después insertar).
