---
name: global-extensibility-zero-hardcode
description: "Trigger: no hardcode, no hardcodear, generic theme, open source theme, global extension, zero hardcoding, dynamic layout, public package, configurable theme. Mandatory rules for building globally portable and reusable Pi themes and extensions with ZERO hardcoded personal names, fixed accounts, or rigid topology arrays."
license: Apache-2.0
metadata:
  author: CinloDev
  version: "1.0"
---

# Global Extensibility & Zero-Hardcode Discipline

## Activation Contract

Mandatory rulebook whenever designing, refactoring, styling, or adding features to `pi-cinlodev-cute` (or any public Pi package). 
The goal is to ensure the theme is **100% portable, generic, and ready for any user in the world** to install via npm, git, or settings without finding private names, hardcoded usernames, fixed profile counts, or rigid agent assumptions.

---

## Core Principles (The 5 Never-Hardcode Pillars)

### 1. Zero Personal or Private Identifiers
- **NEVER** hardcode user account names, author usernames, personal emails, or machine prefixes (e.g. `cinlo1`, `cinlo_dig`, `ranchesca`, `nekocin01`, `cin82`).
- **Dynamic Discovery**:
  - Profiles must be queried via the active profile API (`listAvailableProfiles(cwd)`) or disk scan (`.pi/agent/profiles/`).
  - Accounts must be discovered via CLIProxyAPI signals or provider account listings (`fetchUsageAccounts()`), never fixed lists.
  - User and machine names must use generic fallbacks (`detectSystemUser()` -> `os.userInfo().username` -> `"developer"`).

### 2. Zero Fixed Arrays for Dynamic Entities
- **NEVER** write rigid arrays like `const PRIMARY_CLUSTERS = ["a", "b", "c", "d"]` or `const FLAT_AGENTS = [...]` that artificially clamp or hide a user's real configuration.
- **Responsive Layout**:
  - If a user has 1 profile, show 1. If they have 10, lay out all 10 dynamically (with line wrapping, grid calculation, or scrollable rows based on terminal width).
  - Agents must be read dynamically from `activeDetails.model_profiles` (or active session metadata).

### 3. Pure Theme Token Resolution (No Magic Hexes)
- Colors must **never** be hardcoded as inline raw hex values (`#8e44ad`, `#B4E7C7`) in component renderers.
- All colors must resolve through the theme engine:
  - Theme variables declared in `themes/CinlodevCute.json` (`border`, `write`, `heading`, `mint`, `salmon`, `accent`, `text`, `muted`, `dim`).
  - Configurable palette overrides in `config/CinlodevCute.colors.json` or user-owned `~/.pi/agent/cute.json`.
  - Use `safeFg(theme, role, text, fallback)` so components gracefully adapt even when a user runs a foreign or minimal theme.

### 4. Dynamic Grouping by Convention, Not Explicit Whitelists
- Categorization of entities (such as agents, tools, or providers) must match on **patterns and semantic conventions**, not an exhaustive hardcoded whitelist:
  - Match prefixes or suffixes (e.g. `agentId.startsWith("jd-")`, `agentId.startsWith("review-")`, `toolName.startsWith("mem_")`).
  - Always provide a clean, elegant fallback for unknown/custom agents so third-party extensions render seamlessly without breaking.

### 5. Config-Driven Customization
- Any visual preference that might vary by user (e.g. default active sidebar tab, frame style, pulse intervals, quota thresholds, animation presets) belongs in:
  - `config/CinlodevCute.layout.json`
  - `config/CinlodevCute.strings.json`
  - `config/CinlodevCute.colors.json`
- Allow user overrides via `~/.pi/agent/cute.json` or project-local `.pi/cute.json`.

---

## Decision Matrix

| Scenario | Anti-Pattern (FORBIDDEN) ❌ | Correct Pattern (REQUIRED) ✅ |
| :--- | :--- | :--- |
| **Profile Switcher** | `["cinlo1", "cinlo2", "cinlo3", "cinlo4"]` | `listAvailableProfiles(cwd).map(...)` with dynamic wrapping |
| **Active Profile** | Fallback to `"cinlo1"` | Fallback to `profiles[0]?.name \|\| "default"` |
| **Agent Quotas** | Fixed list of 12 known agents | `Object.keys(activeDetails.model_profiles \|\| {})` |
| **Quota Accounts** | Extract hardcoded prefix strings | Read from live provider payload or generic model string parser |
| **Component Colors** | `\x1b[38;2;142;68;173m` or hardcoded `#8e44ad` | `safeFg(theme, "border", text)` or `palette.violet(text)` |
| **Category Styling** | `if (id === "gentle-ai-worker") ...` | `if (id.startsWith("gentle-ai-")) ...` with generic fallback |
| **UI Copy** | Hardcoded author mentions | Externalized in `cute-strings.ts` with persona overrides |

---

## Verification & Audit Checklist

Before submitting or merging any PR in `pi-cinlodev-cute`:
- [ ] **Grep Audit**: Search the codebase for private/personal tokens (`cinlo`, `ranchesca`, `neko`, etc.). None should exist in `src/` (only in `test/` mock fixtures).
- [ ] **Dynamic Count Test**: Test components with 0, 1, 4, and 12 items. Ensure layout wraps gracefully without overlapping borders or ghost hitboxes.
- [ ] **Third-Party Theme Test**: Run with an empty or non-Cute theme (`theme: undefined`). Verify no crashes or missing characters occur (`safeFg` fallback to plain text).
- [ ] **Test Suite Green**: `npm test` passes 100% of unit tests.
