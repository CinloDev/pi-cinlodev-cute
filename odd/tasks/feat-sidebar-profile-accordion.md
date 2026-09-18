# feat/sidebar-profile-accordion — Desplegable inline de perfiles SDD en Status card

Objetivo: permitir que el perfil de SDD (`🤖 Cinlodev02`) en la tarjeta de Status
del sidebar funcione como un acordeón desplegable interactivo (Opción 2), donde
al hacer click en la fila del perfil se desplieguen los perfiles creados y se pueda
seleccionar uno directamente desde la sidebar.

## Contrato visual y de interacción
- Tarjeta de Status (`src/footer.ts`):
  - Fila de perfil colapsada (default):
    `boxLine("🤖 " + activeName, cAccent("▸"))`
  - Fila de perfil expandida:
    `boxLine("🤖 " + activeName, cAccent("▾"))`
    Seguido de cada perfil disponible:
    - Activo: `boxLine(cAccent("  ● " + name), cAccent("(activo)"))`
    - Inactivo: `boxLine(cMuted("  ○ " + name))`
- Interacción con mouse (`src/sidebar.ts`):
  - Click en la fila del header del perfil conmuta `expanded = !expanded`.
  - Click en cualquiera de las filas de perfiles activa ese perfil y contrae el menú.
  - Al activar, se actualiza el modelo en sesión, thinking level y status en tiempo real.
  - Click fuera del menú colapsa el acordeón automáticamente.

## Tasks
- [x] T1: Crear módulo `src/cute-profiles.ts` para listar perfiles disponibles (proyecto, global, builtins) y proveer la función de cambio de perfil reactivo, usando la API compartida de `pi-sdd-profiles` vía `Symbol.for("cinlodev.sdd-profiles.api")` o fallback autónomo de filesystem.
- [x] T2: Actualizar `CinlodevCuteFooter` en `src/footer.ts` para renderizar el acordeón desplegable en `renderSidebarCard()`, manteniendo el registro de líneas clickeables (offset del toggle y de cada opción).
- [x] T3: Actualizar `installSidebar` en `src/sidebar.ts` para capturar eventos de click con el mouse (`event.type === "click"`) y despacharlos a los handlers de click de la tarjeta de Status.
- [x] T4: Exponer la API en `pi-sdd-profiles` (`globalThis[Symbol.for("cinlodev.sdd-profiles.api")]`) en el repositorio `pi-sdd-profiles` para sincronización limpia de modelo y thinking level.
- [x] T5: Tests unitarios en `test/` cubriendo: listado de perfiles, renderizado colapsado/expandido, despacho de clicks y no-regresión de `npm test`.

## Verification Evidence
- `node --check index.ts src/*.ts`: 0 syntax errors across all files.
- `npm test`: 49 tests passing, 0 failing.
- `npm test --prefix /home/cinlodev/Projects/experiments/pi-sdd-profiles`: 85 tests passing, 0 failing.
- Branch: `feat/sidebar-profile-accordion` creada desde `develop` sin tocar `main`.
- Safety Gate: ningún commit automático ejecutado sin verificación de Cinlo.
