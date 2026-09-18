# feat/context-threshold-notifications — Notificaciones progresivas de contexto (Herdr + Pi toast)

Objetivo: alertar proactivamente al usuario sobre el consumo de la ventana de contexto
con dos niveles bien diferenciados según el semáforo de la tarjeta Context de CUTE:
1. Alerta preventiva (Naranja 65% - 79%): 1 única notificación sugiriendo /handoff, /new o /continue.
2. Alerta crítica (Rojo/Coral >= 80%): Notificación inmediata + recordatorio cada 5 minutos
   mientras permanezca en zona crítica, sugiriendo /compact o cambio de sesión.

## Despacho de notificaciones
- Utilizar el patrón de `dc-notify`:
  - Si `herdrAvailable()` (`HERDR_SOCKET_PATH` o `HERDR_ENV`): despacha vía `herdr notification show`.
  - Si no: fallback a `ctx.ui.notify` en la TUI de Pi.

## Tasks
- [x] T1: Crear módulo `src/cute-notify.ts` con helpers `herdrAvailable()`, `notifyHerdr(message, body)` y `notify(ctx, message, body, type)` con fallback a `ctx.ui.notify`.
- [x] T2: Crear monitor de contexto `src/cute-context-monitor.ts` (`CuteContextMonitor`) con lógica de dos niveles (naranja 1 aviso, rojo recurrente cada 5 min con unref, reseteo al descender).
- [x] T3: Cablear el monitor en `index.ts` escuchando el evento `turn_end`, `session_compact` y `session_start` de Pi.
- [x] T4: Tests unitarios en `test/cute.test.ts` verificando: lógica de umbrales 65% y 80%, aviso único en naranja, recurrencia cada 5 min en rojo, y reseteo al descender de contexto.
- [x] T5: Sincronizar archivos a la carpeta viva de Pi y verificar `npm test` verde.

## Verification Evidence
- `npm test`: 52 tests passing, 0 failing.
- `node --check index.ts src/*.ts`: 0 syntax errors.
- Sincronizado a `~/.pi/agent/git/github.com/CinloDev/pi-cinlodev-cute/`.
- Git Flow: rama `feat/context-threshold-notifications` abierta desde `develop`.
- Safety Gate: sin commit automático hasta verificación de Cinlo.
