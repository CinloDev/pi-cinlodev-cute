import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg, stripAnsi } from "../cute-theme.ts";

export interface CuteFrameOptions {
	title?: string;
	toneKey?: string;
	width: number;
}

/**
 * Calculates visible terminal column width, ignoring ANSI sequences and
 * accounting for 2-column wide characters and emojis (e.g. 🤖, 🌷).
 */
export function calcVisibleWidth(text: string): number {
	const plain = stripAnsi(text);
	let width = 0;
	let lastCharWidth = 0;
	for (const char of plain) {
		const cp = char.codePointAt(0) ?? 0;
		if (cp === 0xfe0f) {
			// Emoji variation selector promotes a 1-column symbol (like ☁ \u2601) to 2 columns in terminal
			if (lastCharWidth === 1) {
				width += 1;
				lastCharWidth = 2;
			}
			continue;
		}
		if (cp >= 0xfe00 && cp <= 0xfe0e) {
			// Other variation selectors are 0-width
			continue;
		}
		if (
			(cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
			(cp >= 0x2e80 && cp <= 0xa4cf) || // CJK Radicals, Kangxi, CJK Unified Ideographs
			(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
			(cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
			(cp >= 0xfe10 && cp <= 0xfe19) || // Vertical forms
			(cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
			(cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x1f300 && cp <= 0x1faff) // Emojis, Symbols (🤖, 🌷, etc.)
		) {
			width += 2;
			lastCharWidth = 2;
		} else if (cp >= 0x20) {
			width += 1;
			lastCharWidth = 1;
		}
	}
	return width;
}

/**
 * Truncates a string to fit within a given visible terminal width.
 * NOTE: not ANSI-safe (it can sever escape sequences mid-way); prefer
 * truncateAnsiAware for any line that may carry colors.
 */
export function truncateToVisibleWidth(text: string, maxWidth: number): string {
	if (calcVisibleWidth(text) <= maxWidth) return text;
	let current = "";
	for (const char of text) {
		if (calcVisibleWidth(current + char) > maxWidth) break;
		current += char;
	}
	return current;
}

/**
 * Escape sequences that must travel as atomic zero-width units: CSI colors,
 * OSC / iTerm2 inline images, and Kitty keyboard/graphics (APC) sequences.
 * Image attachments can smuggle these into read lines; counting or cutting
 * them breaks the frame.
 */
export const ESCAPE_ATOM = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\/g;
export const ESCAPE_ATOM_SINGLE = /^(?:\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\)$/;

/**
 * ANSI-aware truncation: escape sequences travel as atomic zero-width units
 * so they are never severed, and only plain text consumes the width budget.
 * When the cut lands inside colored text a reset is appended so color never
 * bleeds into the frame border or the padded fill.
 */
export function truncateAnsiAware(text: string, maxWidth: number): string {
	if (calcVisibleWidth(text) <= maxWidth) return text;
	const parts = text.split(/(\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\)/g);
	let out = "";
	let cut = false;
	for (const part of parts) {
		if (!part) continue;
		if (ESCAPE_ATOM_SINGLE.test(part)) {
			out += part;
			continue;
		}
		for (const char of part) {
			if (calcVisibleWidth(out + char) > maxWidth) {
				cut = true;
				break;
			}
			out += char;
		}
		if (cut) break;
	}
	ESCAPE_ATOM.lastIndex = 0;
	if (cut && ESCAPE_ATOM.test(text)) out += "\x1b[39m";
	return out;
}

/**
 * Frames an array of content lines in a symmetric double-line CUTE card:
 * ╔═ Title ══════════════════════════════════════════════════════════════╗
 * ║ content                                                              ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 * Guarantees exact width on every line, closing the quadrant symmetrically.
 */
export function frameCategoryBox(
	rawLines: string[],
	title: string,
	toneKey: string,
	width: number,
	theme?: Theme,
): string[] {
	const color = (s: string): string => (theme ? safeFg(theme, toneKey, s) : s);
	const safeWidth = Math.max(30, width);
	const innerWidth = safeWidth - 4; // ║ + space + content + space + ║

	// Clean leading and trailing empty lines
	const lines = [...rawLines];
	while (lines.length && stripAnsi(lines[0] ?? "").trim() === "") lines.shift();
	while (lines.length && stripAnsi(lines[lines.length - 1] ?? "").trim() === "") lines.pop();
	if (!lines.length) return [];

	const titleStr = title ? ` ${title} ` : "";
	const titleWidth = calcVisibleWidth(titleStr);
	// ╔═ (2) + titleStr (titleWidth) + ═.repeat(fillLen) + ╗ (1) = safeWidth
	// fillLen = safeWidth - titleWidth - 3
	const fillLen = Math.max(0, safeWidth - titleWidth - 3);
	const top = color("╔═" + titleStr + "═".repeat(fillLen) + "╗");
	const bot = color("╚" + "═".repeat(safeWidth - 2) + "╝");

	const body = lines.map((line) => {
		const truncated = truncateAnsiAware(line, innerWidth);
		const w = calcVisibleWidth(truncated);
		const pad = " ".repeat(Math.max(0, innerWidth - w));
		return color("║") + " " + truncated + pad + " " + color("║");
	});

	return [top, ...body, bot];
}

/**
 * Highlights plain uncolored text segments inside a line that may already
 * contain ANSI sequences (like markdown bold, links, list markers, OSC 133 semantic zones).
 * Preserves text that is already styled with foreground color or control escapes,
 * and passes plain text through the highlighter function.
 */
export function highlightUncoloredSegments(line: string, highlightFn: (text: string) => string): string {
	const ANSI_SPLIT = /(\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\)/g;
	const parts = line.split(ANSI_SPLIT);
	let hasActiveColor = false;
	let out = "";

	for (const part of parts) {
		if (!part) continue;
		if (ESCAPE_ATOM_SINGLE.test(part)) {
			if (/\x1b\[38;2;|\x1b\[3[0-7]m/.test(part)) {
				hasActiveColor = true;
			} else if (/\x1b\[39m|\x1b\[0m/.test(part)) {
				hasActiveColor = false;
			}
			out += part;
			continue;
		}

		if (hasActiveColor) {
			out += part;
		} else {
			out += highlightFn(part);
		}
	}
	return out;
}
