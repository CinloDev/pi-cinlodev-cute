import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadCuteStrings } from "./cute-strings.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { safeFg, stripAnsi, transformTranscriptLines } from "./cute-theme.ts";

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
	const top = color("╔═" + titleStr + "═".repeat(fillLen) + "╗");
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
 * Checks whether a transcript component is a bash execution
 * (either interactive BashExecutionComponent or ToolExecutionComponent with toolName: "bash").
 */
export function isBashComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name === "BashExecutionComponent" || (typeof (child as any).command === "string" && Array.isArray((child as any).outputLines))) return true;
	if (name === "ToolExecutionComponent" && (child as any).toolName === "bash") return true;
	if ((child as any).toolName === "bash") return true;
	return false;
}

export function isSpacer(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	return name === "Spacer";
}

/**
 * Strips empty lines and horizontal border divider lines (e.g. ─── or ═══)
 * from raw bash component output so it nests cleanly inside our card.
 */
export function cleanBashLines(rawLines: string[]): string[] {
	return rawLines.filter((line) => {
		const plain = stripAnsi(line).trim();
		if (plain === "") return false;
		if (/^[─═\-]+$/.test(plain)) return false;
		return true;
	});
}

/**
 * Format a transcript child component:
 * Frames user messages in the CUTE golden box with ❀, bash executions
 * in the sunset orange box with >_ bash, while allowing
 * other components (assistant messages, non-bash tools) to render naturally.
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

	// Bash execution (single child fallback)
	if (isBashComponent(child)) {
		const rawLines = child.render(width - 4);
		const cleaned = cleanBashLines(rawLines);
		return frameCategoryBox(cleaned.length ? cleaned : rawLines, ">_ bash", colors.bashMessage, width, theme);
	}

	// All other components (Assistant, Tools, Notices) pass through transformTranscriptLines
	// so Gentle AI cards (review start/consent/completed), warning notices, and tools adopt
	// double lines, the robot glyph 🤖 and themed tones (mint green / yellow / error).
	const rawLines = child.render(width);
	return transformTranscriptLines(rawLines, theme);
}

/**
 * Formats a list of transcript children with intelligent grouping:
 * - Groups consecutive bash executions into ONE SINGLE unified sunset orange card.
 * - Formats user messages with the golden user box.
 * - Passes other components through transformTranscriptLines.
 */
export function formatTranscriptChildren(
	children: Component[],
	width: number,
	theme?: Theme,
): { lines: string[]; mouseChildren: Array<{ component: Component; height: number }> } {
	const lines: string[] = [];
	const mouseChildren: Array<{ component: Component; height: number }> = [];
	const strings = loadCuteStrings();
	const colors = loadCuteColors();
	const user = strings.welcomePersona.user || "CinloDev";

	let i = 0;
	while (i < children.length) {
		const child = children[i];
		const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";

		// 1. User Message
		if (name === "UserMessageComponent") {
			const rawLines = child.render(width - 4);
			const boxed = frameCategoryBox(rawLines, `❀ ${user}`, colors.userMessage, width, theme);
			mouseChildren.push({ component: child, height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 2. Group consecutive bash executions into ONE single unified card
		if (isBashComponent(child)) {
			const bashGroup: Component[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isBashComponent(curr)) {
					bashGroup.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isBashComponent(children[i + 1])) {
					// Intervening spacer between bash calls - consume so group stays united
					mouseChildren.push({ component: curr, height: 0 });
					i++;
				} else {
					break;
				}
			}

			const combinedLines: string[] = [];
			for (let j = 0; j < bashGroup.length; j++) {
				const comp = bashGroup[j];
				const raw = comp.render(width - 4);
				const cleaned = cleanBashLines(raw);
				if (cleaned.length > 0) {
					if (combinedLines.length > 0) {
						combinedLines.push(""); // subtle separation between commands
					}
					combinedLines.push(...cleaned);
				}
			}

			const cardLines = frameCategoryBox(
				combinedLines.length ? combinedLines : ["$"],
				">_ bash",
				colors.bashMessage,
				width,
				theme,
			);

			// Distribute mouse heights across the grouped children
			const avgHeight = Math.max(1, Math.floor(cardLines.length / bashGroup.length));
			for (let j = 0; j < bashGroup.length; j++) {
				const compHeight =
					j === bashGroup.length - 1
						? cardLines.length - avgHeight * (bashGroup.length - 1)
						: avgHeight;
				mouseChildren.push({ component: bashGroup[j], height: compHeight });
			}

			lines.push(...cardLines);
			continue;
		}

		// 3. Other components (assistant messages, non-bash tools, notices)
		const rawLines = child.render(width);
		const transformed = transformTranscriptLines(rawLines, theme);
		mouseChildren.push({ component: child, height: transformed.length });
		lines.push(...transformed);
		i++;
	}

	return { lines, mouseChildren };
}
