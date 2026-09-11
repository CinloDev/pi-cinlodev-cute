import type { Theme } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Safe theme.fg wrapper in the welcome.ts style: on unknown keys fall back
 * to another theme color, and to raw text only as a last resort. Keeps
 * widgets rendering instead of throwing when a theme misses a key.
 */
export function safeFg(theme: Theme, key: string, text: string, fallback = "text"): string {
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
		if (cwd !== packageDir) {
			add(path.join(cwd, ".pi", "cute.json"));
			add(path.join(cwd, ".pi", "cinlodev-cute.json"));
			add(path.join(cwd, "config", "CinlodevCute.glyphs.json"));
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
			const glyphs = "glyphs" in parsed ? parsed.glyphs : parsed;
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
