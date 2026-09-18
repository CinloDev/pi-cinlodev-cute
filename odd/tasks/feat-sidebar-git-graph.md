# feat/sidebar-git-graph — Árbol interactivo de Git en el rail de la sidebar

Objetivo: Añadir una card interactiva de Git Graph en el espacio del rail izquierdo de la sidebar de `pi-cinlodev-cute`, permitiendo ver el árbol de commits y ramas formateado en Dracula, con capacidad de colapsar a 1 línea o desplegar con un clic.

## Arquitectura y Contrato
1. **Componente dedicado (`src/cute-git-graph.ts`)**:
   - Ejecuta `git log --graph --oneline --decorate -n <limit>` de forma asíncrona / cacheada con TTL (evitar bloquear el render del TUI).
   - Formatea los símbolos de árbol (`*`, `|`, `/`, `\`), hashes, decoraciones de ramas y mensajes usando roles `syntax*` de Cinlodev CUTE / Dracula.
   - Soporta estado interactivo: `collapsed` (resumen de 1 línea: rama actual + último commit / ahead-behind) vs `expanded` (árbol de commits).
   - Implementa `handleRailClick()` para alternar estado con un clic del mouse.
2. **Integración en `src/sidebar.ts`**:
   - Incorporar `"gitGraph"` en `sectionData` del rail (`footer`, `context`, `gitGraph`, `changes`, `agents`, `todo`).
   - Mapear clics del mouse con `handleRailClick()` en el rail.
3. **Configuración en `config/CinlodevCute.layout.json`**:
   - Opciones: `gitGraph: { enabled: true, defaultExpanded: true, maxCommits: 6, ttlMs: 4000, minWidth: 30 }`.
4. **Disciplina y Estándares**:
   - Cero dependencias externas y cero modificación de código fuera del repo.
   - Tests unitarios en `test/cute.test.ts` con mock de git graph y verificación de estados colapsado/desplegado.

## Tasks
- [x] T1: Configuración en `config/CinlodevCute.layout.json` y tipado en `src/cute-layout.ts`.
- [x] T2: Crear `src/cute-git-graph.ts` con `CuteGitGraphComponent`, parseo y formateo Dracula de `git log --graph`, caché con TTL y toggle de expansión.
- [x] T3: Conectar el componente en `src/sidebar.ts` dentro del rail y en el despacho de eventos de mouse (`handleRailClick`).
- [x] T4: Tests unitarios en `test/cute.test.ts` cubriendo render colapsado/expandido, formateo de grafos y limpieza de timers/caché.
- [x] T5: Verificación de suite completa (`npm test`), revisión visual y sincronización.

## Resultados
- 56 tests pasando (0 fallos).
- Card interactiva de Git Graph en la sidebar conmutable por clic de mouse.
