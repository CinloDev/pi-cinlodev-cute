# feat/sidebar-tools-telemetry — Mini telemetría de herramientas en el rail de la sidebar

Objetivo: Añadir una card compacta en el rail izquierdo de la sidebar (`src/cute-tools.ts`) que muestre en tiempo real qué herramientas ha ejecutado el agente durante la sesión actual, estiladas con sus colores temáticos Dracula/CUTE.

## Contrato Visual
1. **Pills por herramienta**:
   - `read`: glifo `✎ <N> read` en lila (`#C5A3E0` / role `read`).
   - `write/edit`: glifo `✎ <N> write` en celeste (`#A5CBE8` / role `write`).
   - `bash`: glifo `>_ <N> bash` en verde menta (`#8EC5A6` / role `bash`).
   - `engram`: glifo `🧠 <N> engram` en salmón (`#F0978A` / role `salmon`).
   - `grep`: glifo `🔍 <N> grep` en dorado (`#F2B86D` / role `warning`).
   - `fetch`: glifo `↓ <N> fetch` en rosa (`#F095C8` / role `pink`).
   - `search`: glifo `◆ <N> search` en rosa apagado (`#D7A0B8` / role `secondary`).
2. **Card Frame**:
   - Título: `╔═ 🛠 tools ═════════════════════════════╗`.
   - Comportamiento reactivo: Si no se ha ejecutado ninguna herramienta en la sesión, la card se mantiene oculta (`return []`).
   - Ajuste de ancho (wrapping): Distribuye las pills en una o dos líneas según el ancho del rail sin cortar palabras.

## Arquitectura
1. **`src/cute-tools.ts`**:
   - Función `collectToolCounts(ctx: ExtensionContext): ToolCounts`.
   - Función `formatToolPill(category: keyof Omit<ToolCounts, "total">, count: number, theme?: Theme): string`.
   - Función `wrapToolPills(pills: string[], innerWidth: number): string[]`.
   - Clase `CinlodevToolsCard implements Component`:
     - Renderiza la card CUTE con `cuteGlyphs` y borde violeta (`colors.sidebarBorder`).
2. **Configuración en `config/CinlodevCute.layout.json` & `src/cute-layout.ts`**:
   - `tools: { enabled: true, minWidth: 30 }`.
3. **Integración en `src/sidebar.ts` & `src/footer.ts`**:
   - Incluir `"tools"` en `sectionData` de `src/sidebar.ts`.
   - Registrar `toolsPart` con `sidebarPart` en `src/footer.ts`.
   - Invalidación reactiva en `tool_execution_end`, `turn_end`, `session_start`.
4. **Tests Unitarios en `test/cute.test.ts`**:
   - Conteo de tools a partir de mensajes de sesión simulados.
   - Formateo de pills y colores CUTE.
   - Ocultamiento cuando el conteo es cero.

## Tareas
- [x] T1: Crear artifact de tracking y registrar en Engram memory.
- [x] T2: Agregar configuración en `config/CinlodevCute.layout.json` y tipado en `src/cute-layout.ts`.
- [x] T3: Implementar `src/cute-tools.ts` con recolección de eventos, formateo de pills y renderizado.
- [x] T4: Conectar la card en `src/sidebar.ts` y `src/footer.ts`.
- [x] T5: Tests unitarios en `test/cute.test.ts` y verificación `npm test`.
- [x] T6: Git Flow (commits, PRs a develop y main, merge y sync global).

## Resultados
- 60 tests pasando limpios (0 fallos).
- Card de herramientas con conteo por sesión en vivo.
