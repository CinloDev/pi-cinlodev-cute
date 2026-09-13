import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadCuteStrings } from "./cute-strings.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { safeFg, stripAnsi } from "./cute-theme.ts";

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
	for (const char of plain) {
		const cp = char.codePointAt(0) ?? 0;
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
		} else if (cp >= 0x20) {
			width += 1;
		}
	}
	return width;
}

/**
 * Truncates a string to fit within a given visible terminal width.
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
	const top = color("╔═") + titleStr + color("═".repeat(fillLen) + "╗");
	const bot = color("╚" + "═".repeat(safeWidth - 2) + "╝");

	const body = lines.map((line) => {
		const truncated = truncateToVisibleWidth(line, innerWidth);
		const w = calcVisibleWidth(truncated);
		const pad = " ".repeat(Math.max(0, innerWidth - w));
		return color("║") + " " + truncated + pad + " " + color("║");
	});

	return [top, ...body, bot];
}

/**
 * Format a transcript child component:
 * Frames user messages in the CUTE golden box with ❀, while allowing
 * all other components (assistant messages, tools, bash) to render naturally
 * without restrictive extra outer boxes.
 */
export function formatTranscriptChild(
	child: Component,
	width: number,
	theme?: Theme,
): string[] {
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	const strings = loadCuteStrings();
	const colors = loadCuteColors();
	const user = strings.welcomePersona.user || "CinloDev";

	// User Message (configurable via colors.userMessage, default 'heading' / #E0C27A)
	if (name === "UserMessageComponent") {
		const rawLines = child.render(width - 4);
		return frameCategoryBox(rawLines, `❀ ${user}`, colors.userMessage, width, theme);
	}

	// All other components (Assistant, Bash, Tools, Notices) render naturally
	return child.render(width);
}
