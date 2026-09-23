# Feature: Sidebar Engram Card & Cloud Sync Integration

## Objective
Add a dedicated, interactive Engram card to the CUTE sidebar rail located directly below the Context card. The card provides real-time visibility into local Engram daemon health (`http://127.0.0.1:7437`), observation metrics, cloud replication status, and one-click actions: opening the web dashboard (`https://engram.cinlodev.com/dashboard/`), enrolling the current repository if not enrolled, and unenrolling (pausing sync) on demand.

## Requirements
1. **Engram Service (`src/cute-engram.ts`)**:
   - Resolve active project name from `cwd` / `.git` / package.
   - Fetch health status from `http://127.0.0.1:7437/health`.
   - Fetch sync status and enrolled projects from `http://127.0.0.1:7437/sync/status?project=...` and SQLite/CLI check.
   - Execute actions:
     - Open dashboard URL (`xdg-open` + OSC 8 fallback).
     - Enroll project: `engram cloud enroll <project>`.
     - Unenroll project: `engram cloud unenroll <project>`.
   - TTL caching and non-blocking asynchronous polling to protect TUI render loops.

2. **Component `CinlodevEngramCard` (`src/cute-engram.ts`)**:
   - Double-line CUTE frame matching theme borders.
   - Clear Dracula semántica:
     - Mint (`#50FA7B`) for healthy daemon and synced status.
     - Cyan (`#8BE9FD`) for dashboard link, server host, and project.
     - Pink / Violet (`#FF79C6` / `#8BE9FD`) for titles and badges.
     - Yellow / Coral for pending sync or offline state.
   - Interactive mouse targets (`handleRailClick`):
     - Click on `[dashboard ↗]` -> open browser.
     - Click on `[+ enrolar]` -> execute `engram cloud enroll`.
     - Click on `[desincronizar ✕]` -> execute `engram cloud unenroll`.
     - Click on header toggle arrow (`▲` / `▼`) -> collapse/expand card.

3. **Sidebar Rail Integration**:
   - Place `"engram"` in `src/sidebar.ts` directly below `"context"`:
     `["footer", "context", "engram", "usage", "gitGraph", "tools", "agents", "todo"]`.
   - Mount and register `engramRail` via `sidebarPart(tui, "engram", ...)` in `src/footer.ts`.
   - Trigger refresh on session events (`session_start`, `turn_end`, `tool_execution_end`).

4. **Testing**:
   - Unit tests covering status parsing, rendering states (enrolled, unenrolled, offline, error), and mouse click routing in `test/cute.test.ts`.

## Tasks
- [x] T1: Implement Engram telemetry client and actions runner in `src/cute-engram.ts`
- [x] T2: Implement `CinlodevEngramCard` with Dracula semántica, status chips, and click routing
- [x] T3: Integrate `"engram"` into `src/sidebar.ts` below `"context"` and register in `src/footer.ts`
- [x] T4: Add comprehensive tests in `test/cute.test.ts` and verify clean build
