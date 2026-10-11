import type { Theme } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCuteColors } from "../cute-colors.ts";

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
 * Bold helper in the safeFg style: prefers the theme's own bold renderer
 * and falls back to raw ANSI bold so widgets keep rendering on
 * minimal/mock themes. Used sparingly (markdown headings) for a
 * slightly heavier typeface without changing any color.
 */
export function bolden(theme: Theme | undefined, text: string): string {
	if (theme) {
		try {
			const out = (theme as unknown as { bold?: (s: string) => string }).bold?.(text);
			if (typeof out === "string" && out.length > 0) return out;
		} catch {}
	}
	return `\x1b[1m${text}\x1b[22m`;
}

/**
 * Installs Dracula-style Markdown styling hooks on the global Theme instance:
 * - `theme.bold(text)` styles bold text in bright pastel pink (#FFB1DD)
 *   instead of terminal white, giving markdown emphasis distinctive elegance.
 */
export function installCuteMarkdownThemeHook(themeInstance?: unknown): void {
	const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
	const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");
	const target: any =
		themeInstance ?? (globalThis as any)[THEME_KEY] ?? (globalThis as any)[THEME_KEY_OLD];
	if (!target || typeof target !== "object") return;
	if (target.__cuteBoldHookInstalled) return;
	target.__cuteBoldHookInstalled = true;

	const origBold = typeof target.bold === "function" ? target.bold.bind(target) : (s: string) => `\x1b[1m${s}\x1b[22m`;
	target.bold = function (text: string) {
		const bolded = origBold(text);
		// If text already contains an explicit color sequence, leave it intact
		if (/\x1b\[38;2;|\x1b\[3[1-7]m/.test(text)) {
			return bolded;
		}
		const pink = safeFg(target, "pinkBright", text, "accent");
		return `\x1b[1m${pink}\x1b[22m`;
	};
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
	orange(text: string): string;
	coral(text: string): string;
}

/** Frame style presets for configurable glyphs. Double is the current visual. */
export type CuteFrameStyle = "double" | "single" | "rounded" | "ascii";
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
		mint: (s) => safeFg(theme, "mint", s, "green"),
		orange: (s) => safeFg(theme, "orange", s, "warning"),
		coral: (s) => safeFg(theme, "red", s, "error"),
	};
}

export function stripAnsi(text: string): string {
	return text.replace(/\[[0-9;]*[a-zA-Z]|\][^]*(?:\\|\x07)|_[^]*\\/g, "");
}
