# Feature: Sidebar Quotas / Usage Card

## Objective
Adapt `/usage` subscriptions and quota metrics into a non-blocking, collapsible card on the sidebar rail positioned cleanly below the Context card. The card toggles on/off with the shortcut `Alt+U`, uses the sleek Context-style gauge bar (`▰▰▰▱▱`), and shows quota progress, remaining percentage, and reset timers for active CLIProxyAPI / provider accounts.

## Requirements
1. **Usage Fetcher & Parser (`src/cute-usage.ts`)**:
   - Fetch quota data from CLIProxyAPI management endpoint (`http://127.0.0.1:8317`) with key resolution from `~/.pi/agent/auth.json` / env / secrets fallback (or reuse `cpamc-usage` cache/api if available).
   - Defensive parsing: never throw on network failure or empty quota; cache with TTL (e.g. 15s while open).
   - Extract top active accounts and pools (Codex, Claude, Gemini, OpenCode, etc.).
2. **Component `CinlodevUsageCard` (`src/cute-usage.ts`)**:
   - Matches Dracula/CUTE double-line frame (`╔══ ✿ Quotas ════════╗`).
   - For each active pool/account:
     - Header row: Pool/Account name on left (`Codex · 5h` or `Claude weekly`), percentage and reset timer on right (`76% · 3h`).
     - Gauge bar row: Context-style full-width bar (`g.gaugeFilled.repeat(filled) + g.gaugeEmpty.repeat(empty)`) colored dynamically with threshold colors (mint > 50%, gold 20-50%, coral < 20%).
   - When closed/hidden, `render(width)` returns `[]` (0 lines) so the rail leaves no blank space.
3. **Sidebar Rail & Shortcut Integration**:
   - Place `"usage"` in `src/sidebar.ts` right below `"context"` and above `"gitGraph"`:
     `["footer", "context", "usage", "gitGraph", "tools", "agents", "todo"]`.
   - Wire `Alt+U` shortcut (`pi.registerShortcut("alt+u", ...)`) and `/usage-card` toggle command to switch `CinlodevUsageCard` visibility and call `tui.requestRender()`.
4. **Unit Tests**:
   - Verify parsing of quota pools and calculations.
   - Verify `CinlodevUsageCard` toggle state and rendered lines with Context-style gauge bars.

## Tasks
- [x] T1: Implement CLIProxyAPI quota fetcher and parser with TTL caching in `src/cute-usage.ts`
- [x] T2: Implement `CinlodevUsageCard` with Context-style gauge bars and visibility toggle in `src/cute-usage.ts`
- [x] T3: Integrate `"usage"` section in `src/sidebar.ts` and `src/footer.ts`, and register `alt+u` shortcut in `index.ts`
- [x] T4: Add unit tests in `test/cute.test.ts` and verify 100% pass rate
