# feat/bash-live-streaming — Bash vivo con mismo frame CUTE

Objetivo: replicar el movimiento de código del repo j0k3r-theme (opción 3)
SIN cambiar la forma de las cards. Solo `bash` en este prototipo.
`read`/`edit`/`write` quedan intactos.

## Contrato visual (no-negociable)
- Frame sigue siendo `frameCategoryBox` de `src/cute-transcript.ts`:
  `╔═ title ═╗` / `║ content ║` / `╚═╝`, mismo ancho exacto, mismos tonos
  (`colors.bashMessage` para borde, `colors.bashOutput` adentro).
- Título sigue `>_ bash`. Nada de `╭╮╰╯`, nada de neón de j0k3r.

## De dónde viene el movimiento (referencia, no copiar estilo)
- `https://github.com/j0k3r-dev-rgl/j0k3r-pi/tree/main/extensions/j0k3r-theme`
- `src/tools/index.ts` → `registerNativeToolOverrides` con `renderShell: "self"`
- `src/render/ToolCard.ts` → `ToolCardCallComponent`/`ToolCardResultComponent`
  con `state.interval = setInterval(() => context.invalidate(), 1000)` mientras
  `isPartial`, cache cuando termina, `unref()` siempre.
- `src/render/bashRenderer.ts` → preview últimas 5 líneas + `● Running... (Xs)` /
  `Took Xs · Ctrl+O to expand`, borde dinámico por estado (allá naranja/rojo;
  acá mantener tonos CUTE).

## Tasks
- [x] T1: Nuevo `src/cute-live-bash.ts` con `registerCuteLiveBash(pi, cwd)`:
      override solo `bash` vía `createBashToolDefinition(cwd)` + `renderShell: "self"`,
      `renderCall`/`renderResult` que dibujen con `frameCategoryBox` + helpers
      existentes (`cleanBashLines`, `formatBashOutputLines`), preview colapsado
      últimas 5 líneas, timer 1s solo mientras `isPartial`/ejecutando, `unref`,
      `clearInterval` al terminar, cache cuando `!isPartial`.
- [x] T2: Cablear en `index.ts` (session_start + registro temprano como j0k3r),
      y evitar doble-frame: cuando el live-bash está activo, `formatTranscriptChildren`
      en `src/cute-transcript.ts` NO debe re-enmarcar bash (passthrough), sin cambiar
      el frame de ningún otro tool.
- [x] T3: Tests en `test/` que prueben: frame intacto (╔═/║/╚═ presentes),
      preview colapsado acota a 5 líneas, timer se limpia (sin handles abiertos),
      y no-regresión de `read`/`edit`/`write`.
- [x] T4: `npm test` verde (`node --test test/cute.test.ts` + nuevo test si se crea).

## No-goals
- No cambiar forma, paleta ni glyphs de ninguna card.
- No tocar `read`/`edit`/`write` en este prototipo.
- No commit sin verificación explícita de Cinlo (gate humano).
