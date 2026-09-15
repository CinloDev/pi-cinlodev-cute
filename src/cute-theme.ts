import type { Theme } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCuteColors } from "./cute-colors.ts";

/**
 * Safe theme.fg wrapper in the welcome.ts style: on unknown keys fall back
 * to another theme color, and to raw text only as a last resort. Keeps
 * widgets rendering instead of throwing when a theme misses a key.
 */
export function safeFg(theme: Theme, key: string, text: string, fallback = "text"): string {
	if (key.startsWith("#") && /^#[0-9a-fA-F]{6}$/.test(key)) {
		const r = parseInt(key.slice(1, 3), 16);
		const g = parseInt(key.slice(3, 5), 16);
		const b = parseInt(key.slice(5, 7), 16);
		return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
	}
	try {
		return theme.fg(key as any, text);
	} catch {
		try {
			return theme.fg(fallback as any, text);
		} catch {
			return text;
		}
	}
}

/** Frame/border segments via the "border" theme color. */
export function frameFg(theme: Theme, text: string): string {
	return safeFg(theme, "border", text);
}

/**
 * Pastel-pink block cursor (#FFB1DD bg over #1A1218 fg) derived from theme keys,
 * so callers hold no hardcoded 38;2/48;2 sequences. The background ANSI is
 * derived from the pinkBright foreground ANSI, keeping the same hex in both
 * truecolor and 256-color modes without consuming a dedicated bg slot.
 * Throws when the theme misses the "pinkBright" or "cursorText" keys.
 */
export function cursorStyle(theme: Theme, text: string): string {
	const fgDark = theme.getFgAnsi("cursorText" as any);
	const bgPink = theme.getFgAnsi("pinkBright" as any).replace("[38;", "[48;");
	return `${bgPink}${fgDark}${text}\x1b[0m`;
}

/**
 * Shared Cinlodev CUTE palette bound to theme keys.
 * Single source of truth for footer + todos so neither file
 * duplicates hardcoded ANSI. Hexes match themes/CinlodevCute.json:
 * border #8e44ad, pinkBright #FFB1DD, accent #F095C8,
 * heading #E0C27A, warning #F2B86D, text #F6EFF3,
 * muted #A78E9B, dim #76616B, green #B4E7C7, cursorText #1A1218.
 */
export interface CutePalette {
	border(text: string): string;
	pinkBright(text: string): string;
	pinkAccent(text: string): string;
	gold(text: string): string;
	yellow(text: string): string;
	text(text: string): string;
	muted(text: string): string;
	dim(text: string): string;
	mint(text: string): string;
}

/** Frame style presets for configurable glyphs. Double is the current visual. */
export type CuteFrameStyle = "double" | "single" | "rounded" | "ascii";

export interface CuteGlyphs {
	frameStyle: CuteFrameStyle;
	tl: string;
	tr: string;
	bl: string;
	br: string;
	h: string;
	v: string;
	dividerL: string;
	dividerR: string;
	separator: string;
	dot: string;
	brand: string;
	profileIcon: string;
	spinnerFrames: string[];
	petalFrames: string[];
	branch: string;
	gaugeFilled: string;
	gaugeEmpty: string;
}

const DOUBLE_GLYPHS: CuteGlyphs = {
	frameStyle: "double",
	tl: "╔",
	tr: "╗",
	bl: "╚",
	br: "╝",
	h: "═",
	v: "║",
	dividerL: "╠",
	dividerR: "╣",
	separator: "│",
	dot: "·",
	brand: "◆",
	profileIcon: "👤",
	spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	petalFrames: ["✿", "❀", "❁", "✾"],
	branch: "\ue0a0",
	gaugeFilled: "▰",
	gaugeEmpty: "▱",
};

const FRAME_PRESETS: Record<CuteFrameStyle, Pick<CuteGlyphs, "tl" | "tr" | "bl" | "br" | "h" | "v" | "dividerL" | "dividerR">> = {
	double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║", dividerL: "╠", dividerR: "╣" },
	single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", dividerL: "├", dividerR: "┤" },
	rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", dividerL: "├", dividerR: "┤" },
	ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", dividerL: "+", dividerR: "+" },
};

const ASCII_FALLBACK: CuteGlyphs = {
	frameStyle: "ascii",
	tl: "+",
	tr: "+",
	bl: "+",
	br: "+",
	h: "-",
	v: "|",
	dividerL: "+",
	dividerR: "+",
	separator: "|",
	dot: ".",
	brand: "*",
	profileIcon: "@",
	spinnerFrames: ["-", "\\", "|", "/"],
	petalFrames: ["*", "+", "o", "x"],
	branch: ">",
	gaugeFilled: "#",
	gaugeEmpty: "-",
};

export type CutePetalPreset = "petals" | "cats" | "kittens" | "sparkles" | "stars" | "hearts" | "ascii";

export const PETAL_PRESETS: Record<string, string[]> = {
	petals: ["✿", "❀", "❁", "✾"],
	flowers: ["✿", "❀", "❁", "✾"],
	cats: ["/•᷅•᷄\\੭", "/◕᷅◕᷄\\੭", "/˘᷅˘᷄\\੭", "/•᷅◕᷄\\੭"],
	kittens: ["/×᷅×᷄\\੭", "/-᷅-᷄\\੭", "/^᷅^᷄\\੭", "/o᷅o᷄\\੭"],
	sparkles: ["✦", "✧", "★", "☆"],
	stars: ["✶", "✷", "✸", "✹"],
	hearts: ["♡", "♥", "ღ", "❦"],
	ascii: ["*", "+", "o", "x"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickGlyph(source: unknown, fallback: string): string {
	return typeof source === "string" && source.length > 0 ? source : fallback;
}

function normalizeFrameStyle(source: unknown): CuteFrameStyle {
	return source === "single" || source === "rounded" || source === "ascii" ? source : "double";
}

/** Merge a parsed `glyphs` JSON value over the base glyphs (defaults to DOUBLE_GLYPHS). */
function mergeGlyphs(raw: unknown, baseGlyphs: CuteGlyphs = DOUBLE_GLYPHS): CuteGlyphs {
	const base: CuteGlyphs = {
		...baseGlyphs,
		spinnerFrames: [...baseGlyphs.spinnerFrames],
		petalFrames: [...baseGlyphs.petalFrames],
	};
	if (!isRecord(raw)) return base;
	const rawRecord = raw as Record<string, unknown>;

	if (typeof rawRecord.frameStyle === "string") {
		const frameStyle = normalizeFrameStyle(rawRecord.frameStyle);
		base.frameStyle = frameStyle;
		const preset = FRAME_PRESETS[frameStyle];
		const frameKeys = ["tl", "tr", "bl", "br", "h", "v", "dividerL", "dividerR"] as const;
		for (const key of frameKeys) {
			base[key] = preset[key] ?? ASCII_FALLBACK[key];
		}
	}

	const frameKeys = ["tl", "tr", "bl", "br", "h", "v", "dividerL", "dividerR"] as const;
	for (const key of frameKeys) {
		const explicit = rawRecord[key];
		if (typeof explicit === "string" && explicit.length > 0) {
			base[key] = explicit;
		}
	}

	const accessoryKeys = [
		"separator",
		"dot",
		"brand",
		"profileIcon",
		"branch",
		"gaugeFilled",
		"gaugeEmpty",
	] as const;
	for (const key of accessoryKeys) {
		const explicit = rawRecord[key];
		if (typeof explicit === "string" && explicit.length > 0) {
			base[key] = explicit;
		}
	}

	// Preset lookup for animation frames (preset / petalPreset)
	const presetKey = typeof rawRecord.preset === "string" ? rawRecord.preset.toLowerCase() : (
		typeof rawRecord.petalPreset === "string" ? rawRecord.petalPreset.toLowerCase() : undefined
	);
	if (presetKey && presetKey in PETAL_PRESETS) {
		base.petalFrames = [...PETAL_PRESETS[presetKey]];
	}

	const rawFrames = rawRecord.spinnerFrames;
	if (Array.isArray(rawFrames)) {
		const cleaned = rawFrames.filter((f): f is string => typeof f === "string" && f.length > 0);
		if (cleaned.length > 0) base.spinnerFrames = cleaned;
	}

	const rawPetals = rawRecord.petalFrames;
	if (Array.isArray(rawPetals)) {
		const cleaned = rawPetals.filter((f): f is string => typeof f === "string" && f.length > 0);
		if (cleaned.length > 0) base.petalFrames = cleaned;
	}

	// ASCII fallback: any empty frame/box key left blank resolves to ASCII.
	for (const key of ["tl", "tr", "bl", "br", "h", "v", "dividerL", "dividerR", "separator"] as const) {
		if (!base[key]) base[key] = ASCII_FALLBACK[key];
	}
	if (!base.dot) base.dot = ASCII_FALLBACK.dot;
	if (!base.brand) base.brand = ASCII_FALLBACK.brand;
	if (!base.profileIcon) base.profileIcon = ASCII_FALLBACK.profileIcon;
	if (!base.branch) base.branch = ASCII_FALLBACK.branch;
	if (!base.gaugeFilled) base.gaugeFilled = ASCII_FALLBACK.gaugeFilled;
	if (!base.gaugeEmpty) base.gaugeEmpty = ASCII_FALLBACK.gaugeEmpty;
	if (base.spinnerFrames.length === 0) base.spinnerFrames = [...ASCII_FALLBACK.spinnerFrames];
	if (base.petalFrames.length === 0) base.petalFrames = [...ASCII_FALLBACK.petalFrames];
	return base;
}

let cachedGlyphs: CuteGlyphs | null = null;

function isPackageClone(dir: string): boolean {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		return pkg?.name === "pi-cinlodev-cute";
	} catch {
		return false;
	}
}

function candidateGlyphsFiles(): string[] {
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
		add(path.join(packageDir, "themes", "CinlodevCute.json"));
		add(path.join(packageDir, "config", "CinlodevCute.glyphs.json"));
		add(path.join(packageDir, "themes", "CinlodevCute.glyphs.json"));
	} catch {}

	// 2. User-level global overrides (~/.pi/agent, outside git, persistent across package updates)
	try {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		add(path.join(agentDir, "cute.json"));
		add(path.join(agentDir, "cinlodev-cute.json"));
		add(path.join(agentDir, "cute", "CinlodevCute.glyphs.json"));
		add(path.join(agentDir, "cute", "glyphs.json"));
		add(path.join(agentDir, "cinlodev-cute", "CinlodevCute.glyphs.json"));
		add(path.join(agentDir, "cinlodev-cute", "glyphs.json"));
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

function resolveBaseGlyphs(): CuteGlyphs {
	let current: CuteGlyphs = mergeGlyphs(undefined, DOUBLE_GLYPHS);
	for (const file of candidateGlyphsFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!isRecord(parsed)) continue;
			let glyphs = "glyphs" in parsed ? parsed.glyphs : parsed;
			if (isRecord(parsed) && "preset" in parsed && isRecord(glyphs) && !("preset" in glyphs)) {
				glyphs = { ...glyphs, preset: parsed.preset };
			}
			current = mergeGlyphs(glyphs, current);
		} catch {}
	}
	return current;
}

/**
 * Reusable glyph resolver. Defaults are byte-identical to the double-line
 * literals previously hardcoded in hud/footer frames, so the default visual
 * stays unchanged. Missing keys fall back to ASCII so widgets keep rendering
 * without a Nerd Font.
 *
 * User overrides in ~/.pi/agent/cute.json or ~/.pi/agent/cute/CinlodevCute.glyphs.json
 * layer on top of package defaults and persist across package updates.
 */
export function cuteGlyphs(theme?: unknown): CuteGlyphs {
	if (!cachedGlyphs) {
		cachedGlyphs = resolveBaseGlyphs();
	}
	if (isRecord(theme) && isRecord((theme as Record<string, unknown>).glyphs)) {
		return mergeGlyphs((theme as Record<string, unknown>).glyphs, cachedGlyphs);
	}
	return cachedGlyphs;
}

/** Clear the in-memory glyph cache (tests and follow-up slices). */
export function resetCuteGlyphsCache(): void {
	cachedGlyphs = null;
}

export function cutePalette(theme: Theme): CutePalette {
	return {
		border: (s) => frameFg(theme, s),
		pinkBright: (s) => safeFg(theme, "pinkBright", s),
		pinkAccent: (s) => safeFg(theme, "accent", s),
		gold: (s) => safeFg(theme, "heading", s),
		yellow: (s) => safeFg(theme, "warning", s),
		text: (s) => safeFg(theme, "text", s),
		muted: (s) => safeFg(theme, "muted", s),
		dim: (s) => safeFg(theme, "dim", s),
		mint: (s) => safeFg(theme, "green", s),
	};
}

export function stripAnsi(text: string): string {
	return text.replace(/\[[0-9;]*[a-zA-Z]|\][^]*(?:\\|\x07)|_[^]*\\/g, "");
}

// Sidebar cards (Changes, Agents, Todo) remain uniformly colored in the theme's border
// tone (no green override on diff additions or status).
export function unifySidebarCardFrame(raw: string, theme?: Theme): string {
	if (!theme) return raw;
	const g = cuteGlyphs(theme);
	const colors = loadCuteColors();
	const toConfigured: Record<string, string> = {
		"╭": g.tl,
		"╮": g.tr,
		"╰": g.bl,
		"╯": g.br,
		"│": g.v,
		"─": g.h,
	};

	let line = raw;
	// Replace ANSI-colored frame tokens with configured double-line glyphs in border tone
	line = line.replace(
		/\x1b\[[0-9;]*m[ ╭╮╰╯│─]*[╭╮╰╯│─][ ╭╮╰╯│─]*(?:\x1b\[39m|\x1b\[0m)?/g,
		(token) => {
			const open = token.match(/^\x1b\[[0-9;]*m/)?.[0] ?? "";
			const close = token.match(/(?:\x1b\[39m|\x1b\[0m)$/)?.[0] ?? "";
			const glyphs = token.slice(open.length, close ? token.length - close.length : undefined);
			const doubled = glyphs.replace(/[╭╮╰╯│─]/g, (c) => toConfigured[c] ?? c);
			return safeFg(theme, colors.sidebarBorder, doubled);
		},
	);

	// Replace remaining bare frame glyphs
	line = line.replace(/[╭╮╰╯│─]/g, (c) => safeFg(theme, colors.sidebarBorder, toConfigured[c] ?? c));

	return line;
}

export type CuteCardTone = "success" | "warning" | "error" | "border";

// Gentle AI card lines in transcript & dock: double-line frame, appropriate tone
// (warning = yellow #F2B86D, success = green #78A588, error = coral #FF718F),
// and robot glyph 🤖 replacing rose, tulip, or flower.
export function formatGentleAiCardLine(raw: string, theme?: Theme, tone: CuteCardTone = "success"): string {
	if (!theme) return raw;
	const g = cuteGlyphs(theme);
	const colors = loadCuteColors();
	const resolvedTone =
		tone === "warning"
			? colors.gentleCardWarning
			: tone === "error"
				? colors.gentleCardError
				: tone === "border"
					? colors.sidebarBorder
					: colors.gentleCardSuccess;

	const toConfigured: Record<string, string> = {
		"╭": g.tl,
		"╮": g.tr,
		"╰": g.bl,
		"╯": g.br,
		"│": g.v,
		"─": g.h,
	};

	// 1. Detectar si contiene flor de 1 columna (✿) para compensar el ancho del título
	const hadSingleColFlower = /✿\s*(?=Gentle AI)/u.test(raw);

	// 2. Reemplazar rosa, tulipán o flor por EXACTAMENTE UN robot 🤖
	let line = raw
		.replace(/(?:\u{1F339}\uFE0E|\u{1F339}|🌹|\u{1F337}|🌷|✿)\s*(?=Gentle AI)/gu, "🤖 ")
		.replace(/(?:\u{1F339}\uFE0E|\u{1F339}|🌹|\u{1F337}|🌷)/gu, "🤖");

	// 3. Reemplazar tokens ANSI de marco y pintarlos con el tono correspondiente
	line = line.replace(
		/\x1b\[[0-9;]*m[ ╭╮╰╯│─╔╗╚╝║═]*[╭╮╰╯│─╔╗╚╝║═][ ╭╮╰╯│─╔╗╚╝║═]*(?:\x1b\[39m|\x1b\[0m)?/g,
		(token) => {
			const open = token.match(/^\x1b\[[0-9;]*m/)?.[0] ?? "";
			const close = token.match(/(?:\x1b\[39m|\x1b\[0m)$/)?.[0] ?? "";
			const glyphs = token.slice(open.length, close ? token.length - close.length : undefined);
			const doubled = glyphs.replace(/[╭╮╰╯│─]/g, (c) => toConfigured[c] ?? c);
			return safeFg(theme, resolvedTone, doubled);
		},
	);

	// 4. Reemplazar cualquier glifo de marco restante fuera de ANSI
	line = line.replace(/[╭╮╰╯│─]/g, (c) => safeFg(theme, resolvedTone, toConfigured[c] ?? c));

	// 5. Si reemplazamos ✿ (1 columna) por 🤖 (2 columnas), el título creció 1 columna:
	// acortamos la regla horizontal por 1 columna para que el marco cierre perfectamente simétrico.
	if (hadSingleColFlower) {
		line = line.replace(/═{3,}/, (r) => r.slice(1));
	}

	return line;
}

// Stateful processor for transcript & dock lines: transforms Gentle AI cards into double-line
// themed frames (warning = yellow, success = mauve) with robot 🤖 while leaving other lines intact.
export function transformTranscriptLines(rawLines: string[], theme?: Theme): string[] {
	if (!theme || !rawLines.length) return rawLines;
	let inGentleCard = false;
	let currentTone: CuteCardTone = "success";

	return rawLines.map((line) => {
		const plain = stripAnsi(line);
		const hasGentleTitle = plain.includes("Gentle AI");
		const isTopRule = (plain.includes("╭") || plain.includes("╔")) && hasGentleTitle;
		const isBottomRule = plain.includes("╰") || plain.includes("╚") || plain.includes("╯") || plain.includes("╝");

		if (isTopRule) {
			inGentleCard = true;
			if (
				plain.includes("dev binary override") ||
				plain.includes("field-test only") ||
				plain.includes("warning") ||
				plain.includes("preparing")
			) {
				currentTone = "warning";
			} else if (plain.includes("failed") || plain.includes("error") || plain.includes("invalid")) {
				currentTone = "error";
			} else {
				currentTone = "success";
			}
		}

		if (inGentleCard) {
			const transformed = formatGentleAiCardLine(line, theme, currentTone);
			if (isBottomRule && !isTopRule) {
				inGentleCard = false;
				currentTone = "success";
			}
			return transformed;
		}

		return line;
	});
}

// Las cards de gentle-pi adaptadas: si es Gentle AI se formatea con robot y tono adecuado,
// de lo contrario se formatea con marco doble en tono border.
export function unifyCardFrame(raw: string, theme?: Theme): string {
	if (!theme) return raw;
	const plain = stripAnsi(raw);
	if (plain.includes("Gentle AI") || plain.includes("🤖") || /[\u{1F339}\uFE0E\u{1F339}🌹\u{1F337}🌷]/.test(raw)) {
		let tone: CuteCardTone = "success";
		if (
			plain.includes("dev binary override") ||
			plain.includes("field-test only") ||
			plain.includes("warning") ||
			plain.includes("preparing")
		) {
			tone = "warning";
		} else if (plain.includes("failed") || plain.includes("error") || plain.includes("invalid")) {
			tone = "error";
		}
		return formatGentleAiCardLine(raw, theme, tone);
	}
	return unifySidebarCardFrame(raw, theme);
}

/**
 * Intercepts ctx.ui.setHeader to protect la Gentlewoman Welcome Dashboard
 * against late overwrites from external extensions (such as gentle-pi startup-banner with setTimeout(50)),
 * while still adapting any external headers with double lines and theme tones if welcome is disabled.
 */
export function installWelcomeHeaderGuard(
	ctx: { ui?: { setHeader?: (content: any) => void } },
	isWelcomeActive: () => boolean,
): void {
	if (!ctx.ui || typeof ctx.ui.setHeader !== "function" || (ctx.ui as any).__cuteSetHeaderWrapped) {
		return;
	}
	(ctx.ui as any).__cuteSetHeaderWrapped = true;
	const origSetHeader = ctx.ui.setHeader.bind(ctx.ui);

	ctx.ui.setHeader = (content: any) => {
		// 1. If it's our own Welcome Dashboard, install it directly
		if (content && (content as any).__isCuteWelcome) {
			return origSetHeader(content);
		}

		// 2. If the user explicitly disabled welcome (/welcome off) and passed undefined
		if (!isWelcomeActive() && content === undefined) {
			return origSetHeader(undefined);
		}

		// 3. If our Welcome Dashboard is active, protect it from being overwritten
		// by foreign extensions (e.g. gentle-pi startup-banner.ts deferred setTimeout)
		if (isWelcomeActive()) {
			return;
		}

		// 4. If welcome is disabled, wrap external content to apply CUTE frames and theme tones
		if (typeof content === "function") {
			const origFactory = content;
			content = (tui: any, theme: any) => {
				const comp = origFactory(tui, theme);
				if (!comp || typeof comp.render !== "function") return comp;
				const origRender = comp.render.bind(comp);
				return {
					...comp,
					render(width: number) {
						const rawLines = origRender(width);
						return transformTranscriptLines(rawLines, theme);
					},
					dispose() {
						comp.dispose?.();
					},
				};
			};
		}

		return origSetHeader(content);
	};
}
