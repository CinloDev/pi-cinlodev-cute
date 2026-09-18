---
name: cute-theme-development
description: "Trigger: cute, cinlodev-cute, theme pack, pi-cinlodev-cute, extension architecture, gentle-shell compatibility. Core rules and architecture for Developing CUTE without touching external source code."
license: Apache-2.0
metadata:
  author: CinloDev
  version: "1.0"
---

## Activation Contract

Use this skill when:
- Developing, refactoring, or fixing features in `pi-cinlodev-cute`.
- Integrating with Pi's interactive TUI or coexisting with external extensions (`gentle-shell`, `quiet-tools`, etc.).
- Designing new UI components (HUD, Welcome Dashboard, cards, statusline, sidebar).

## Hard Rules

1. **Zero External Source Mutation**: NEVER edit or mutate files outside this repository (e.g. `@earendil-works/pi-*`, `gentle-shell`, or global Pi internals). All theme logic, hooks, wrappers, and overrides must live 100% inside `pi-cinlodev-cute`.
2. **Zero Native Tool Collision**: NEVER re-register built-in tool names (`pi.registerTool({ name: "bash" | "read" | "write" ... })`). Let execution and tool management belong to Pi and `quiet-tools`. Style tools exclusively via transcript component post-processing.
3. **Safe Hierarchy Traversal**: When hooking into transcripts or document containers, descend through custom layout nodes (e.g. `[NODE]()` from `gentle-shell`) to locate components dynamically without assuming rigid indexes.
4. **No Hardcoded Visuals**: Colors, glyphs, layout dimensions, and user strings must be externalized in `config/CinlodevCute.*.json` and theme variables in `themes/CinlodevCute.json`, allowing user overrides via `~/.pi/agent/cute.json`.
5. **Strict Git Flow**: Never push or commit directly to `main`. Create `feat/*` or `fix/*` branches from `develop`, open a PR into `develop`, merge, then open a release PR from `develop` into `main`. All tests (`npm test`) must pass at 100% before merging.

## Decision Gates

| Need | Action |
|------|--------|
| Style a tool output (bash, read, write) | Intercept in `formatTranscriptChildren`; do NOT register a tool definition |
| Add new UI widget or banner | Use `ctx.ui.setHeader`, `ctx.ui.setWidget` with wrapper guards |
| Traverse document tree | Use `findTranscript` with recursive entry/children/`[NODE]()` search |
| Change colors or borders | Update `config/CinlodevCute.colors.json` and `themes/CinlodevCute.json` |
| Add user-facing strings | Update `config/CinlodevCute.strings.json` with fallback defaults |

## Execution Steps

1. Verify working directory is clean and on a fresh `feat/*` or `fix/*` branch from `develop`.
2. Implement behavior purely inside `src/`, `config/`, or `themes/`.
3. Wrap components without mutating their prototypes or interfering with other extensions.
4. Add unit tests in `test/` covering new behavior and regression safety.
5. Run `npm test` and ensure all suites pass.
6. Commit with Conventional Commits, push branch, create PR to `develop`, merge, then release PR to `main`.
7. Sync changes to `~/.pi/agent/git/github.com/CinloDev/pi-cinlodev-cute` for immediate live verification.

## Output Contract

Return:
- Architectural decisions made and files modified.
- Verification that no external source code was touched.
- Test suite status (`npm test`).
- Git Flow PR and merge links.
