import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tunable Cinlodev CUTE layout numbers. Visual defaults are byte-identical to
 * the literals previously hardcoded in src/sidebar.ts, src/footer.ts,
 * src/hud.ts, src/todos.ts, src/welcome.ts and src/editor.ts, so
 * the default visual stays unchanged.
 */
export interface CuteSidebarLayout {
	/** Minimum terminal columns to enable the sidebar rail (was SIDEBAR_BREAKPOINT). */
	breakpoint: number;
	/** Rail width in cells (was RAIL_WIDTH). */
	railWidth: number;
	/** Horizontal padding inside the rail (was RAIL_PADDING). */
	railPadding: number;
	/** Gap of the host hstack (was GAP). */
	gap: number;
	/** Width of the left border column (was LEFT_BORDER_WIDTH). */
	leftBorderWidth: number;
	/** Width of the middle divider column. */
	middleDividerWidth: number;
	/** Fallback terminal rows when the host reports none. */
	fallbackRows: number;
	/** Minimum columns to keep the left border mounted. */
	minColumnsWithBorder: number;
	/** Poll interval for sidebar attach in milliseconds. */
	attachMs: number;
	/** Whether the tabs navigation in the sidebar is enabled. Default true. */
	tabsEnabled?: boolean;
	/** Default active tab id or key (e.g. "1" or "main"). Default "1". */
	defaultTab?: string;
}

export interface CuteFooterLayout {
	/** Minimum width for the bottom footer line (was Math.max(20, width)). */
	minWidth: number;
	/** Minimum width for the sidebar status card (was Math.max(30, width)). */
	cardMinWidth: number;
	/** Context gauge cells (was GAUGE_CELLS). */
	gaugeCells: number;
	/** Minimum interval between git dirty checks in milliseconds. */
	dirtyMs: number;
	/** Branch length before compacting with an ellipsis. */
	branchMax: number;
	/** Max extra extension statuses rendered in the sidebar card. */
	extraMax: number;
	/** Cost decimals when the total is >= 1 (was toFixed(2)). */
	costDecimalsAboveOne: number;
	/** Cost decimals when the total is < 1 (was toFixed(3)). */
	costDecimalsBelowOne: number;
}

export interface CuteHudLayout {
	/** Minimum widget width in cells (was Math.max(30, width)). */
	minWidth: number;
	/** TTL for the cached git branch read in milliseconds (was 3000). */
	gitBranchTtlMs: number;
	/** TTL for the cached active profile read in milliseconds (was 5000). */
	activeProfileTtlMs: number;
	/** Wide-tier threshold in columns for the 2-line HUD (was ~120). */
	tierWideMin: number;
	/** Medium-tier threshold in columns for the 3-line HUD (was 80). */
	tierMediumMin: number;
}

export interface CuteTodosLayout {
	/** Max todo rows in the sidebar rail (was RAIL_MAX_ROWS). */
	railMaxRows: number;
	/** Max todo rows in the bottom placement (was BOTTOM_MAX_ROWS). */
	bottomMaxRows: number;
	/** Minimum card width in cells (was Math.max(30, width)). */
	minWidth: number;
}

export interface CuteWelcomeLayout {
	/** Minimum widget width in cells (was Math.max(48, width)). */
	minWidth: number;
	/** Width below which the model name renders short (was safeWidth < 90). */
	modelBreakpoint: number;
	/** Width below which the meta row collapses (was safeWidth < 70). */
	metaCollapseBreakpoint: number;
	/** Width below which hotkeys render compact (was safeWidth < 80). */
	hotkeysCompactBreakpoint: number;
	/** Width below which hotkeys render minimal (was safeWidth < 60). */
	hotkeysMinimalBreakpoint: number;
	/** TTL for cached welcome stats in milliseconds (was 10_000). */
	statsTtlMs: number;
}

export interface CuteEditorLayout {
	/** Horizontal padding passed to the base editor (was paddingX: 1). */
	paddingX: number;
	/** Working-pulse interval in milliseconds (was 160). */
	pulseMs: number;
	/** Minimum widget width in cells (was Math.max(10, width)). */
	minWidth: number;
	/** Columns reserved inside safeWidth for the manual cursor breath (was safeWidth - 3). */
	innerReserve: number;
}

export interface CuteScrollLayout {
	/** Number of lines to scroll per mouse wheel tick (was 1 in Pi default, painfully slow). */
	wheelScrollLines: number;
}

export interface CuteGitGraphLayout {
	/** Whether the Git Graph widget in the sidebar is enabled. */
	enabled: boolean;
	/** Whether the Git Graph starts expanded (tree view) or collapsed (1 line). */
	defaultExpanded: boolean;
	/** Maximum commits to display in the graph tree view. */
	maxCommits: number;
	/** Cache TTL in milliseconds for git log operations. */
	ttlMs: number;
	/** Minimum width in cells for the git graph card. */
	minWidth: number;
}

export interface CuteToolsLayout {
	/** Whether the Tools Telemetry widget in the sidebar is enabled. */
	enabled: boolean;
	/** Minimum width in cells for the tools telemetry card. */
	minWidth: number;
}

export interface CuteTerminalLayout {
	/** Columns always kept clear on the left edge (was 0: full-bleed). */
	insetLeft: number;
	/** Columns always kept clear on the right edge (was 0: full-bleed). */
	insetRight: number;
	/** Extra left columns kept clear only inside Herdr (HERDR_ENV=1). */
	herdrInsetLeft: number;
	/** Extra right columns kept clear only inside Herdr (HERDR_ENV=1). */
	herdrInsetRight: number;
}

export interface CuteLayout {
	sidebar: CuteSidebarLayout;
	footer: CuteFooterLayout;
	hud: CuteHudLayout;
	todos: CuteTodosLayout;
	welcome: CuteWelcomeLayout;
	editor: CuteEditorLayout;
	scroll: CuteScrollLayout;
	gitGraph: CuteGitGraphLayout;
	tools: CuteToolsLayout;
	terminal: CuteTerminalLayout;
}

export const CUTE_LAYOUT_FILENAME = "CinlodevCute.layout.json";

const DEFAULTS: CuteLayout = {
	sidebar: {
		breakpoint: 140,
		railWidth: 52,
		railPadding: 1,
		gap: 0,
		leftBorderWidth: 2,
		middleDividerWidth: 2,
		fallbackRows: 50,
		minColumnsWithBorder: 40,
		attachMs: 100,
		tabsEnabled: true,
		defaultTab: "1",
	},
	footer: {
		minWidth: 20,
		cardMinWidth: 30,
		gaugeCells: 6,
		dirtyMs: 4000,
		branchMax: 18,
		extraMax: 3,
		costDecimalsAboveOne: 2,
		costDecimalsBelowOne: 3,
	},
	hud: {
		minWidth: 30,
		gitBranchTtlMs: 3000,
		activeProfileTtlMs: 5000,
		tierWideMin: 120,
		tierMediumMin: 80,
	},
	todos: {
		railMaxRows: 8,
		bottomMaxRows: 4,
		minWidth: 30,
	},
	welcome: {
		minWidth: 48,
		modelBreakpoint: 90,
		metaCollapseBreakpoint: 70,
		hotkeysCompactBreakpoint: 80,
		hotkeysMinimalBreakpoint: 60,
		statsTtlMs: 10_000,
	},
	editor: {
		paddingX: 1,
		pulseMs: 160,
		minWidth: 10,
		innerReserve: 3,
	},
	scroll: {
		wheelScrollLines: 3,
	},
	gitGraph: {
		enabled: true,
		defaultExpanded: true,
		maxCommits: 6,
		ttlMs: 4000,
		minWidth: 30,
	},
	tools: {
		enabled: true,
		minWidth: 30,
	},
	terminal: {
		insetLeft: 0,
		insetRight: 0,
		herdrInsetLeft: 0,
		herdrInsetRight: 1,
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickNumber(source: unknown, fallback: number): number {
	return typeof source === "number" && Number.isFinite(source) ? source : fallback;
}

function pickBoolean(source: unknown, fallback: boolean): boolean {
	return typeof source === "boolean" ? source : fallback;
}

/** Merge a parsed JSON value over the defaults; unknown keys are ignored. */
function mergeSection<T extends Record<string, number>>(currentSection: T, raw: unknown): T {
	const base = { ...currentSection };
	if (!isRecord(raw)) return base;
	for (const key of Object.keys(currentSection) as (keyof T)[]) {
		base[key] = pickNumber(raw[key as string], base[key]) as T[keyof T];
	}
	return base;
}

export function mergeSidebar(currentSection: CuteSidebarLayout, raw: unknown): CuteSidebarLayout {
	const base = { ...currentSection };
	if (!isRecord(raw)) return base;
	base.breakpoint = pickNumber(raw.breakpoint, base.breakpoint);
	base.railWidth = pickNumber(raw.railWidth, base.railWidth);
	base.railPadding = pickNumber(raw.railPadding, base.railPadding);
	base.gap = pickNumber(raw.gap, base.gap);
	base.leftBorderWidth = pickNumber(raw.leftBorderWidth, base.leftBorderWidth);
	base.middleDividerWidth = pickNumber(raw.middleDividerWidth, base.middleDividerWidth);
	base.fallbackRows = pickNumber(raw.fallbackRows, base.fallbackRows);
	base.minColumnsWithBorder = pickNumber(raw.minColumnsWithBorder, base.minColumnsWithBorder);
	base.attachMs = pickNumber(raw.attachMs, base.attachMs);
	base.tabsEnabled = pickBoolean(raw.tabsEnabled, base.tabsEnabled ?? true);
	if (typeof raw.defaultTab === "string" && raw.defaultTab.trim()) {
		base.defaultTab = raw.defaultTab.trim();
	} else if (typeof raw.defaultTab === "number") {
		base.defaultTab = String(raw.defaultTab);
	}
	return base;
}

function mergeGitGraphSection(currentSection: CuteGitGraphLayout, raw: unknown): CuteGitGraphLayout {
	const base = { ...currentSection };
	if (!isRecord(raw)) return base;
	base.enabled = pickBoolean(raw.enabled, base.enabled);
	base.defaultExpanded = pickBoolean(raw.defaultExpanded, base.defaultExpanded);
	base.maxCommits = pickNumber(raw.maxCommits, base.maxCommits);
	base.ttlMs = pickNumber(raw.ttlMs, base.ttlMs);
	base.minWidth = pickNumber(raw.minWidth, base.minWidth);
	return base;
}

function mergeToolsSection(currentSection: CuteToolsLayout, raw: unknown): CuteToolsLayout {
	const base = { ...currentSection };
	if (!isRecord(raw)) return base;
	base.enabled = pickBoolean(raw.enabled, base.enabled);
	base.minWidth = pickNumber(raw.minWidth, base.minWidth);
	return base;
}

export function mergeLayout(raw: unknown, baseSource: CuteLayout = DEFAULTS): CuteLayout {
	const base: CuteLayout = {
		sidebar: { ...baseSource.sidebar },
		footer: { ...baseSource.footer },
		hud: { ...baseSource.hud },
		todos: { ...baseSource.todos },
		welcome: { ...baseSource.welcome },
		editor: { ...baseSource.editor },
		scroll: { ...baseSource.scroll },
		gitGraph: { ...baseSource.gitGraph },
		tools: { ...baseSource.tools },
		terminal: { ...baseSource.terminal },
	};
	if (!isRecord(raw)) return base;
	base.sidebar = mergeSidebar(base.sidebar, raw.sidebar);
	base.footer = mergeSection(base.footer, raw.footer);
	base.hud = mergeSection(base.hud, raw.hud);
	base.todos = mergeSection(base.todos, raw.todos);
	base.welcome = mergeSection(base.welcome, raw.welcome);
	base.editor = mergeSection(base.editor, raw.editor);
	base.scroll = mergeSection(base.scroll, raw.scroll);
	base.gitGraph = mergeGitGraphSection(base.gitGraph, raw.gitGraph);
	base.tools = mergeToolsSection(base.tools, raw.tools);
	base.terminal = mergeSection(base.terminal, raw.terminal);
	return base;
}

// Tunables live in config/, NOT in themes/: Pi treats every *.json under
// themes/ as a theme file and rejects ours ("expected an object with a
// colors map"). The themes/ location stays as a legacy fallback so existing
// local installs keep working until they update the package.
// User overrides in ~/.pi/agent/cute.json or ~/.pi/agent/cute/CinlodevCute.layout.json
// layer on top of package defaults and persist across package updates.
function isPackageClone(dir: string): boolean {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		return pkg?.name === "pi-cinlodev-cute";
	} catch {
		return false;
	}
}

function candidateLayoutFiles(): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();

	const add = (filePath: string) => {
		const resolved = path.resolve(filePath);
		if (!seen.has(resolved)) {
			seen.add(resolved);
			candidates.push(resolved);
		}
	};

	// 1. Package defaults (repo clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
		add(path.join(packageDir, "config", CUTE_LAYOUT_FILENAME));
		add(path.join(packageDir, "themes", CUTE_LAYOUT_FILENAME));
	} catch {}

	// 2. User-level global overrides (~/.pi/agent, outside git, persistent across package updates)
	try {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		add(path.join(agentDir, "cute.json"));
		add(path.join(agentDir, "cinlodev-cute.json"));
		add(path.join(agentDir, "cute", CUTE_LAYOUT_FILENAME));
		add(path.join(agentDir, "cute", "layout.json"));
		add(path.join(agentDir, "cinlodev-cute", CUTE_LAYOUT_FILENAME));
		add(path.join(agentDir, "cinlodev-cute", "layout.json"));
	} catch {}

	// 3. Workspace / Project-level overrides (cwd, only when outside package clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
		const cwd = path.resolve(process.cwd());
		if (cwd !== packageDir && !isPackageClone(cwd)) {
			add(path.join(cwd, ".pi", "cute.json"));
			add(path.join(cwd, ".pi", "cinlodev-cute.json"));
		}
	} catch {}

	return candidates;
}

let cached: CuteLayout | null = null;

/**
 * Load tunable layout numbers, cached in memory. Falls back to the compiled
 * defaults when the JSON file is missing or unparsable, so widgets keep
 * rendering with the current visual instead of throwing.
 *
 * Layers package defaults, user-level overrides (~/.pi/agent), and project overrides.
 */
export function loadCuteLayout(): CuteLayout {
	if (cached) return cached;
	let current: CuteLayout = mergeLayout(undefined, DEFAULTS);
	for (const file of candidateLayoutFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!isRecord(parsed)) continue;
			const data = "layout" in parsed ? parsed.layout : parsed;
			current = mergeLayout(data, current);
		} catch {}
	}
	cached = current;
	return cached;
}

/** Clear the in-memory cache (tests and follow-up slices). */
export function resetCuteLayoutCache(): void {
	cached = null;
}

/**
 * True when running inside a Herdr-managed pane. Herdr sets HERDR_ENV=1
 * (plus HERDR_PANE_ID); the pane id alone is accepted as a fallback.
 */
export function isHerdrSession(env: Record<string, string | undefined> = process.env): boolean {
	return env.HERDR_ENV === "1" || typeof env.HERDR_PANE_ID === "string";
}

/**
 * Columns to keep clear on each screen edge so overlay chrome that does not
 * resize the pty (e.g. Herdr's bar) never eats our borders. Herdr-only
 * reserves apply solely under isHerdrSession; everything clamps to >= 0.
 */
export function resolveEdgeInsets(
	terminal: CuteTerminalLayout,
	env: Record<string, string | undefined> = process.env,
): { left: number; right: number } {
	const inHerdr = isHerdrSession(env);
	const left = Math.max(0, Math.floor(terminal.insetLeft + (inHerdr ? terminal.herdrInsetLeft : 0)));
	const right = Math.max(0, Math.floor(terminal.insetRight + (inHerdr ? terminal.herdrInsetRight : 0)));
	return { left, right };
}

/**
 * Tunes the TUI instance wheel scroll speed.
 * Pi's default wheelScrollLines is 1 (moves only 1 line per notch, which feels terribly slow).
 * We adjust it to the layout value (default 3 lines per notch).
 */
export function tuneTuiScroll(tui: any): void {
	if (!tui) return;
	const layout = loadCuteLayout();
	const lines = Math.max(1, Math.floor(layout.scroll?.wheelScrollLines ?? 3));
	if (typeof tui.wheelScrollLines === "number") {
		tui.wheelScrollLines = lines;
	}
}
