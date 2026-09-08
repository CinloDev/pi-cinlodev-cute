<p align="center">
  <h1 align="center">🌸 pi-cinlodev-cute 💜</h1>
  <p align="center">
    <strong>An exclusive, high-density visual suite, aesthetic theme pack, and custom TUI components for Pi Coding Agent and la Gentlewoman.</strong>
  </p>
</p>

<p align="center">
  <img src="./public/theme_sup.png" alt="la Gentlewoman Welcome Dashboard & Persistent HUD" width="95%" />
</p>

---

## ✨ Overview

**`pi-cinlodev-cute`** elevates the Pi Coding Agent terminal experience into a cohesive, elegant, and responsive developer workspace. Designed with the distinctive **Cinlodev CUTE** aesthetic—deep obsidian backdrops, double violet structural rails, pastel pink accents, and warm golden highlights—it combines visual delight with senior-grade density.

---

## 🎨 Design Highlights

<p align="center">
  <img src="./public/theme_inf.png" alt="Double-Line Prompt Editor & CUTE Statusline Footer" width="95%" />
</p>

### 1. 🌸 Cinlodev CUTE Theme (`CinlodevCute.json`)
* **Deep Obsidian Canvas:** `#1A1218` main background and subtle `#241822` element surfaces.
* **Double-Rail Violet Borders:** Signature `#8e44ad` framing with `#5c2c74` subtle separators.
* **Pastel Rose Accents:** `#F095C8` (active accent), `#FFB1DD` (bright pink highlights & custom block cursor), `#D7A0B8` (secondary).
* **Warm Gilding & Notices:** `#E0C27A` (headings, user messages, thinking badges), `#F2B86D` (git dirty counts, package warnings), and `#B4E7C7` (success green).

### 2. 👑 la Gentlewoman Welcome Dashboard (`src/welcome.ts`)
* High-density header showing Pi version, active Git branch, model, thinking profile, active context files, and loaded skills/extensions.
* **Expandable on demand:** Toggle between compact and full dashboard with `Ctrl+O` or `/welcome`.
* Symmetric double-line border with custom Unicode glyphs (`╔═ ◆ Cinlodev CUTE · la Gentlewoman ═╗`).

### 3. 🎛️ Persistent HUD Widget (`src/hud.ts`)
* Sits cleanly above the prompt editor to provide continuous ambient feedback without polluting conversation history.
* Displays real-time model name, thinking level, context window token gauge, input/output token counts, session cost, and active workspace path.
* **Modes:** Full (`/hud full`), Compact (`/hud compact`), or Hidden (`/hud off`).

### 4. ✿ Double-Line Violet Prompt Editor (`src/editor.ts`)
* Double violet frame (`╔═`, `║`, `╚═`) that wraps your command input seamlessly.
* **Animated Petal Indicator:** The flower icon spins through animated frames (`✿` → `❀` → `❁` → `✾`) with a muted `working` status whenever the agent executes a turn, resting peacefully in `✿` when idle.
* **Pastel Pink Cursor:** Inverted block cursor styled in `#FFB1DD` pastel pink (`\x1b[48;2;255;177;221m`).
* **Terminal Margin Protection:** Uses a 1-column safety margin (`width - 1`) so that exiting with `Ctrl+D` dumps clean, undeformed rectangular boxes into your shell scrollback.

### 5. 🎀 CUTE Minimalist Statusline Footer (`src/footer.ts`)
* Replaces the default status bar with a responsive, single-line dock:
  ```text
  ✿ Cinlodev CUTE │  branch ±N │ model (high) │ ctx ▰▰▱▱▱▱ 15% │ $0.000 │ MCP: ready
  ```
* **Intelligent Responsive Compaction:** Never wraps or breaks into multiple lines. On narrower splits (e.g. Herdr/tmux panes), it gracefully shortens branch names, drops secondary metrics, and compacts branding to keep your workspace clean.

### 6. ✎ Working-Tree Changes Cap (`lib/shell-changes.ts`)
* Intelligently caps the listed modified files at a maximum of 5, appending `+N más` for remaining files to prevent screen clutter on wide terminals.

---

## 📦 Installation

Install directly into Pi via Git:

```bash
pi install git:github.com/CinloDev/pi-cinlodev-cute
```

Or for local development / testing:

```bash
pi install /path/to/pi-cinlodev-cute
```

---

## ⌨️ Slash Commands

| Command | Description |
| :--- | :--- |
| `/cinlodev` | Instantly re-applies and verifies all Cinlodev CUTE components (Header, HUD, Editor, Footer). |
| `/hud` | Configure persistent HUD above input (`/hud`, `/hud full`, `/hud compact`, `/hud off`). |
| `/welcome` | Toggle or configure the Welcome Dashboard (`/welcome full`, `/welcome compact`, `/welcome off`). |
| `/gentle:changes` | Open interactive two-pane diff viewer for modified working tree files (`Alt+G`). |

---

## 🛡️ Architecture & Upstream Protection

`pi-cinlodev-cute` is architected as an independent Pi extension package:
* It hooks into standard Pi lifecycle events (`session_start`, `agent_start`, `agent_end`).
* Your custom theme, HUD, editor, and statusline persist independently across `pi update` runs and upstream package resets.
* Mathematical border alignments ensure all UI components colocate symmetrically across all terminal dimensions.

---

<p align="center">
  <sub>Crafted with 💜 and 🌸 for Cinlo & la Gentlewoman.</sub>
</p>
