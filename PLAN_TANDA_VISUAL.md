# Tanda visual de la PWA

Plan acordado con Facundo. Cada parte se anota acá cuando se cierra (commit, push y bundle verificado).

## Reglas de cada parte

- Tokens de `src/theme/motion.ts` (curva, duraciones, escalas, vibración, umbrales).
- Solo `transform` y `opacity`: nada que recalcule layout ni repinte.
- Respetar "reducir movimiento" (`useReducirMovimiento`): sin desplazamientos ni escalas, solo fundido.
- Prueba de rendimiento (`e2e/rendimiento.spec.ts`, `RENDIMIENTO=1`) en iPhone 13 y Moto G4 con CPU 4x: cero tareas largas durante la animación y como mucho 5 % de cuadros arriba de 33 ms.
- Commit, push y bundle de greenfitapp.netlify.app verificado.
- Ningún cambio de texto, de lógica ni de base.

## Estado

| Parte | Qué | Estado |
|---|---|---|
| 1 | Base: tokens de movimiento, toque (Tocable), zonas seguras, áreas de 44 px | Hecha — `9b7eaa9` |
| 2 | Apariciones y esqueletos | Hecha — `d0ccaa0` |
| 3 | Hojas inferiores que se cierran deslizando | Hecha — `7184080` |
| — | Aparte de la tanda: "Renovar" (plan vencido, tarjetas grises) | Hecha — `b360530` |
| 4 | Agenda optimista, vibración, tirar para refrescar y áreas de toque chicas | Hecha (26/11) — Facundo aceptó el rendimiento en gama baja con la tarea de abajo pendiente |
| — | Rendimiento de la Agenda en gama baja (antes de la parte 5) | Pendiente |
| 5 | Pestañas deslizables en Mi Rutina, check de Mi Rutina rehecho, carrusel de créditos con enganche | Pendiente |
| 6 | (Opcional) Vidrio en la barra de pestañas flotante | Pendiente |

## Parte 4 — Agenda optimista, vibración y tirar para refrescar

- **Reserva optimista.** Al confirmar, la tarjeta pasa a "Reservada" al instante, con un tilde que crece (solo transform y opacity). Si el servidor rechaza, vuelve atrás con un fundido y el mismo mensaje de error de hoy. La hoja de "Reserva confirmada" (Agendar/Compartir) sube recién cuando el servidor confirma. La lógica de reserva no cambia.
- **Vibración** con `navigator.vibrate` si existe: 12 ms al reservar y al cancelar, 15 ms al finalizar entrenamiento. En iPhone no hace nada.
- **Tirar para refrescar** propio para web, en Agenda, Inicio y Mi Rutina: el indicador se mueve solo con transform, umbral de 64 px. En nativo queda `RefreshControl`. Con `overscroll-behavior-y: contain`, para que en Chrome de Android no se dispare también la recarga del navegador. Probarlo en modo navegador y en modo app instalada.
- **Áreas de toque de menos de 44 px**, llevarlas a 44:
  - Notificaciones: los 3 filtros y "Marcar todas como leídas".
  - Comunidad: las pestañas Feed, Mensajes y Ranking.
  - Perfil: "Cerrar sesión" y "¿Cómo ganar XP?".
  - Login: el botón de instalar.
  - Medir también el comprobante de transferencia.

### Estado de la parte 4 (25/11)

- Hecho: reserva optimista (la hoja de confirmar se cierra al tocar "Confirmar"; el pedido al servidor sale un cuadro después de pintar "Reservada"), vibración, tirar para refrescar (Agenda, Inicio, Mi Rutina; modo navegador y app instalada en e2e), áreas de 44 px (incluida la X y "Entendido" de la tarjeta de instalar, y "Volver" del comprobante, que medía 22x24).
- Rendimiento, con la metodología corregida (sin trace y tocando por coordenadas: el trace de Playwright sacaba fotos del DOM en el hilo de la página y daba tareas de ~50 ms que no eran de la app):
  - iPhone 13: todo cumple, partes 1 a 4.
  - Moto G4 CPU 4x: tirar para refrescar cumple en las tres pantallas. "Confirmar" da a veces una tarea de ~50 ms (antes de la parte 4, HEAD, la daba más seguido). "Abrir la hoja" (parte 3) da una tarea de ~55 ms en casi todas las corridas; ya pasaba en HEAD.
  - Las dos son el dibujo de la Agenda que dispara el toque, no la animación.
- Decisión de Facundo (26/11): commit y push así; el dibujo de la Agenda se aliviana en una tarea propia antes de la parte 5.

## Rendimiento de la Agenda en gama baja (antes de la parte 5)

Tarea propia, con su commit. Mismas reglas que las partes (sin cambios de texto, lógica ni base).

- Alivianar el dibujo de la Agenda (memorizar las tarjetas y la hoja, y lo que aparezca al medir) hasta que "Confirmar" y "abrir la hoja" den 0 tareas largas en Moto G4 con CPU 4x.
- La flecha "Go back" del encabezado de Notificaciones y Mi Credencial (React Navigation, 30x30) a 44 px.

## Parte 5

- Pestañas deslizables en Mi Rutina (ScrollView horizontal con scroll-snap nativo).
- El check de Mi Rutina rehecho: capa verde por opacidad y tilde por escala (hoy repinta colores desde JS).
- El carrusel de créditos del Inicio con enganche (scroll-snap).

## Parte 6 (opcional)

- Vidrio solo en la barra de pestañas, que pasa a flotar. Se descarta si no cumple el criterio en gama baja.

## Pendientes anotados (no van en esta tanda)

- "A A" con DNI 445379789: parece una cuenta de prueba (no tocarla).
- Los 8 e2e que ya fallaban.
- El montaje pesado de Mi Rutina en gama baja.
- El borrado de socios bloqueado por `notifications_sender_id_fkey`.
- Los 3 e2e intermitentes con 8 workers (solos pasan):
  - home-reactividad.spec.ts, el 6 ("Hoy Entrené" mueve el arco del anillo según el nuevo % del nivel).
  - rutina.spec.ts, "23503 sin salir de la pantalla: aviso con título y mensaje entendibles, recarga sola y se puede volver a marcar".
  - rutina.spec.ts, "le asignaron una rutina nueva con la pantalla abierta: tildar la vieja da GFR01, avisa y carga la nueva".
