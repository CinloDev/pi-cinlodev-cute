# feat/absorb-changes-into-git-graph — Absorber métricas de cambios en la card de Git y limpiar línea suelta

Objetivo: Integrar las métricas de líneas añadidas/eliminadas (`+added -deleted`) y conteo de archivos adentro de la card de Git Graph (`src/cute-git-graph.ts`), y remover la sección suelta `"changes"` sin caja del rail de la sidebar (`src/sidebar.ts`).

## Diagnóstico
- `gentle-shell` registra un widget de cambios (`renderChangesWidget`) mediante `sidebarPart(tui, "changes", ...)`.
- En el rail izquierdo de la sidebar, `src/sidebar.ts` listaba `"changes"` en `sectionData`, pintando una línea de texto descolgada sin marco doble violeta (`✎ 16 files · +990 -42 · partial counts`).
- La información de cambios pertenece conceptualmente al estado de Git del repositorio.

## Solución implementada
1. **En `src/cute-git-graph.ts`**:
   - `fetchGitStatus` ahora consulta también `git diff HEAD --numstat` (o `git diff --numstat`) de forma cacheada y ligera.
   - Parsea `linesAdded` y `linesDeleted` (tratando binarios `- -` con gracia).
   - En `formatGitStatusBadges`, si hay líneas añadidas o eliminadas, añade el badge coloreado: `+added` en verde menta y `−deleted` en coral rojo (`toolDiffRemoved` / `red`).
2. **En `src/sidebar.ts`**:
   - Se remueve `"changes"` de `sectionData`.
   - La sidebar queda 100% limpia, armónica y libre de líneas flotantes sin marco.
3. **Tests unitarios**:
   - Nuevos tests para el parseo de numstat y formateo de líneas diff en `test/cute.test.ts`.
   - Todos los tests pasando (100%).

## Tasks
- [x] T1: Crear artifact de tracking y registrar en Engram memory.
- [x] T2: Extender `GitStatusCounts` y `parseGitNumstat` en `src/cute-git-graph.ts`.
- [x] T3: Actualizar `formatGitStatusBadges` para incluir `+lines` y `−lines`.
- [x] T4: Remover `"changes"` de `sectionData` en `src/sidebar.ts`.
- [x] T5: Tests unitarios en `test/cute.test.ts` y verificación `npm test`.
- [x] T6: Git Flow (commits, PRs a develop y main, merge y sync global).

## Resultados
- 60 tests unitarios pasando al 100%.
- Eliminada la línea suelta sin marco en el rail de la sidebar.
- Métricas de diff (+agregadas, -eliminadas) absorbidas en la card de Git Graph.
