# fix/read-write-dracula-highlighting — Resaltado sintáctico Dracula en cards de read y write

Objetivo: Garantizar que el contenido interno de las cards de `read`, `write` y `edit` se pinte con el resaltado de sintaxis estilo Dracula (roles `syntax*` de Cinlodev CUTE), manteniendo los marcos de las cards intactos (lila para read, celeste para write).

## Diagnóstico y problemas identificados
1. **`write` emitía contenido plano sin colorear**: `formatWriteDiffLines` asumía formato de diff de git (`/^([+-\s])(\s*\d*)\s(.*)$/`). Las líneas sin indentación (`import`, `export`, `function`, `const`, `}`, etc.) no empezaban con `+`, `-` ni espacio, dando `null` y quedando en texto plano blanco.
2. **`edit` diffs compactos fallaban**: Diffs con `+code` o `-code` sin espacio tras el símbolo no matcheaban por exigir `\s` obligatorio.
3. **`read` header detection**: `idx === 0` fallaba cuando Pi anteponía `Spacer(1)` o líneas vacías de padding, provocando que la cabecera `read <path>` se procesara como código.
4. **Limpieza de rangos en rutas**: Rutas con sufijo de líneas (`:1-10`) en `args.path` o headers deben limpiarse antes de evaluar extensiones en `toolFileHighlightable`.

## Tareas
- [x] T1: Crear artifact de tracking y registrar en Engram memory.
- [x] T2: Refactorizar formateo de `write` y `edit` en `src/cute-transcript.ts`: soportar código completo para `write` y diffs flexibles (`+`, `-`, ` ` con o sin número de línea y con o sin espacio) para `edit`.
- [x] T3: Refactorizar `formatReadLines` en `src/cute-transcript.ts`: detectar encabezados sin depender de `idx === 0`, preservar indentación y aplicar resaltado Dracula a todas las líneas de código.
- [x] T4: Agregar tests unitarios en `test/cute.test.ts` cubriendo `write` (código completo con imports, exports, llaves), `edit` (diffs variados) y `read` (con/sin prefijos y espaciado).
- [x] T5: Verificar que toda la suite (`npm test`) pase al 100%.

## Resultados y evidencia
- Commit en rama de feature: `ef99944` (`fix(transcript): Dracula syntax highlighting in read and write cards`).
- 54 tests pasando (0 fallos).
- `write` resalta el 100% de las líneas de código en Dracula, con sangría intacta.
- `edit` resalta tanto diffs con número de línea (`+123 code`) como compactos (`+code`).
- `read` detecta el encabezado sin importar spacers iniciales y aplica syntax highlighting completo.
