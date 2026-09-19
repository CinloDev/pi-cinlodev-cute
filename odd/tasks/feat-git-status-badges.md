# feat/git-status-badges — Badges de estado en vivo en la card de Git Graph

Objetivo: Integrar badges de estado del árbol de trabajo (`clean`, `modified`, `staged`, `untracked`) adentro de la card de Git Graph (`src/cute-git-graph.ts`), coloreados con la paleta Dracula / CUTE, tanto en modo expandido como en modo colapsado.

## Contrato Visual
1. **Árbol limpio (Clean)**:
   - Badge: `✔ clean` en verde menta (`mint` / `#B4E7C7`).
2. **Con cambios (Dirty)**:
   - `● 2 mod` en naranja (`warning` / `#F2B86D`).
   - `+ 1 staged` en verde (`green` / `#78A588`).
   - `? 3 untracked` en secundario (`secondary` / `#D7A0B8`).
3. **Ubicación**:
   - En modo colapsado: Junto a la rama (` develop · ✔ clean · 5b0836f Merge...`).
   - En modo expandido: Como una barra de estado superior sobre el árbol (`Status: ● 2 mod  +1 staged`).

## Tareas
- [x] T1: Crear artifact de tracking y registrar en Engram memory.
- [x] T2: Implementar `fetchGitStatus` y `formatGitStatusBadges` en `src/cute-git-graph.ts` con caché TTL.
- [x] T3: Integrar los badges en `CinlodevGitGraphCard` para modos expandido y colapsado.
- [x] T4: Escribir unit tests en `test/cute.test.ts` verificando parseo de `git status --porcelain` y coloreado Dracula.
- [x] T5: Verificar `npm test` al 100%, commit, PRs y sincronización global.

## Resultados
- 57 tests unitarios pasando limpios.
- Estado en vivo renderizado en la card de Git Graph.
