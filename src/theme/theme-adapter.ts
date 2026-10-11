import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadCuteColors } from "../cute-colors.ts";
import { safeFg, bolden, stripAnsi } from "./theme-color.ts";
import { cuteGlyphs } from "./theme-glyphs.ts";

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
// themed frames (warning = yellow, success = green) with robot 🤖, bolds markdown headings
// outside fenced code blocks, and leaves other lines intact.
export function transformTranscriptLines(rawLines: string[], theme?: Theme): string[] {
	if (!theme || !rawLines.length) return rawLines;
	let inGentleCard = false;
	let currentTone: CuteCardTone = "success";
	let inFence = false;

	return rawLines.map((line) => {
		const plain = stripAnsi(line);
		const hasGentleTitle = plain.includes("Gentle AI");
		const isTopRule = (plain.includes("╭") || plain.includes("╔")) && hasGentleTitle;
		const isBottomRule = plain.includes("╰") || plain.includes("╚") || plain.includes("╯") || plain.includes("╝");

		if (/^\s*```/.test(plain)) inFence = !inFence;

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

		// Markdown headings get a slightly heavier typeface (bold, same color).
		// Skipped inside fenced code blocks so `#` comments in code never bolden.
		if (!inFence && /^\s*#{1,6}\s+\S/.test(plain)) {
			return bolden(theme, line);
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