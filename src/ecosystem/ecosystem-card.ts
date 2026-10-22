import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	type EcosystemToolInfo,
	getCachedEcosystem,
	triggerEcosystemDetection,
	resetEcosystemCache,
} from "./ecosystem-client.ts";

/**
 * Formats a single tool item with cute palette colors.
 */
export function formatEcosystemPill(
	tool: EcosystemToolInfo,
	theme?: Theme
): string {
	const c = cutePalette(theme!);
	let nameColored: string;
	switch (tool.accent) {
		case "cyan":
			nameColored = theme ? safeFg(theme, "write", tool.name, "cyan") : tool.name;
			break;
		case "pink":
			nameColored = c.pinkAccent(tool.name);
			break;
		case "mint":
			nameColored = c.mint(tool.name);
			break;
		case "purple":
			nameColored = theme ? safeFg(theme, "secondary", tool.name, "magenta") : tool.name;
			break;
		case "gold":
			nameColored = c.gold(tool.name);
			break;
		default:
			nameColored = c.text(tool.name);
	}

	if (!tool.available) {
		return `${c.dim("○")} ${c.dim(tool.name)} ${c.dim("-")}`;
	}

	const bullet = c.mint("●");
	const verFormatted = c.text(`v${tool.version}`);
	return `${bullet} ${nameColored} ${verFormatted}`;
}

/**
 * CinlodevEcosystemCard:
 * - Ambient component displayed in CUTE Sidebar (MEM tab).
 * - Displays active runtime and satellite tools versions (pi, cute, gentle-ai, engram, herdr).
 * - Non-blocking asynchronous version polling with memory cache.
 * - Double-line Dracula / CUTE frame styling.
 */
export class CinlodevEcosystemCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private expanded = false;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	invalidate(): void {
		resetEcosystemCache();
		triggerEcosystemDetection(() => this.tui.requestRender());
	}

	toggleExpanded(): boolean {
		this.expanded = !this.expanded;
		this.tui.requestRender();
		return this.expanded;
	}

	handleClick(_localIndex?: number, _button?: string): boolean {
		this.toggleExpanded();
		return true;
	}

	render(width: number): string[] {
		// Trigger passive detection in background if not yet cached
		triggerEcosystemDetection(() => this.tui.requestRender());

		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const palette = cutePalette(this.theme);
		const c = {
			...palette,
			pink: (s: string): string => palette.pinkAccent(s),
		};

		// Standard boxLine guarantees total visible width = safeWidth
		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		const titleGlyph = g.brand || "✿";
		const titleStr = `${c.pink(titleGlyph)} ${c.gold("Stack")} ${c.muted("·")} ${c.pinkAccent("Ecosistema")}`;
		const titleLen = calcVisibleWidth(titleStr);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const cached = getCachedEcosystem();
		if (!cached) {
			const lines: string[] = [top];
			lines.push(boxLine(c.dim("Detectando herramientas…")));
			lines.push(bottom);
			return lines;
		}

		const lines: string[] = [top];
		const tools = cached.tools;

		if (this.expanded) {
			// Expanded view: 1 tool per line with detailed status
			for (const tool of tools) {
				const pill = formatEcosystemPill(tool, theme);
				const statusText = tool.available ? c.mint("instalado") : c.dim("no disponible");
				lines.push(boxLine(pill, statusText));
			}
		} else {
			// Compact view: 1 tool per line (vertical list)
			for (const tool of tools) {
				const pill = formatEcosystemPill(tool, theme);
				lines.push(boxLine(pill));
			}
		}

		lines.push(bottom);
		return lines;
	}
}
