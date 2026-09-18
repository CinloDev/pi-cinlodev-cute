---
name: cute-tui-styling
description: "Trigger: cute styling, card, transcript, tui component, frame box, dracula syntax, mouse layout, safeFg. Best practices for wrapping and styling Pi TUI components safely."
license: Apache-2.0
metadata:
  author: CinloDev
  version: "1.0"
---

## Activation Contract

Use this skill when:
- Creating or adjusting cards (`frameCategoryBox`) in the transcript.
- Applying Dracula-style code syntax highlighting to tool outputs.
- Wrapping interactive TUI components that handle mouse clicks or scrolling.
- Handling ANSI text formatting, color truncation, or terminal escapes.

## Hard Rules

1. **Mouse Layout Integrity**: Whenever adding breathing blank lines, card borders, or spacers, maintain 1:1 mouse alignment. Push a dummy `{ component: {}, height: 1 }` for empty lines and wrap clickable components in `FramedCardMouseProxy` so clicks/collapsing never ghost into neighboring elements.
2. **ANSI-Aware Measurement and Cuts**: Never measure string length with `.length` when ANSI escapes or Kitty APC / OSC sequences are present. Use `stripAnsi(s)` for measurement and `truncateAnsiAware(text, width)` for cutting to prevent border corruption or severing control sequences.
3. **Dracula Syntax Separation**:
   - For diffs (`edit`): Match prefixes (`+`, `-`, ` `) with `DIFF_LINE_RE`, color prefix in diff tones (`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`), and highlight code Dracula-style.
   - For file dumps (`write`): Highlight all lines of code preserving original indentation; do NOT strip indentation as diff context.
   - For human prose (Assistant / Markdown): Never run code tokenizers on natural language prose (causes word-salad). Let native Markdown renderers handle text.
4. **Theme Role Fallbacks**: Always wrap color styling with `safeFg(theme, role, text, fallback)`. Supports theme roles (`syntaxKeyword`, `heading`, `accent`) and direct hex codes (`#RRGGBB`), preventing runtime crashes when a theme misses a key.
5. **Padding & Empty Line Hygiene**: Pi's `Box` wraps content with background padding lines. In formatters, convert whitespace-only lines to empty strings (`""`) so `frameCategoryBox` can trim them without leaving background color blocks.

## Decision Gates

| Scenario | Rule |
|----------|------|
| Component has mouse clicks | Wrap in `FramedCardMouseProxy(child, boxed.length)` |
| Injected blank line in transcript | Add `{ component: {} as any, height: 1 }` to `mouseChildren` |
| Code file syntax | Use `highlightCodeLine(code, theme)` bound to `syntax*` roles |
| Diff output | Keep diff prefixes colored, highlight remaining code with Dracula |
| Prose or markdown | Use `formatAssistantProse` or `transformTranscriptLines` |

## Execution Steps

1. Detect target component type using constructor name or `toolName`.
2. Clean raw lines of padding or empty trailing lines.
3. Apply Dracula syntax highlighting or category card borders via `frameCategoryBox`.
4. Register the component's rendered height in `mouseChildren`.
5. Verify in unit tests that frames, syntax tokens, and mouse mappings remain intact.

## Output Contract

Return:
- Formatter functions modified or created.
- Evidence of mouse alignment and ANSI safety verification.
- Test coverage added in `test/`.
