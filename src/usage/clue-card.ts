import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	getCachedClueUsage,
	getClueUsageLastError,
	triggerClueUsageRefresh,
	resetClueUsageCache,
} from "./clue-client.ts";

/**
 * CinlodevClueCard:
 * - Ambient component displayed in CUTE Sidebar (Main tab).
 * - Shows MWAPI / Clue balance and daily token usage.
 * - Zero API key disclosure.
 * - Double-line Dracula / CUTE frame styling.
 */
export class CinlodevClueCard implements Component {
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
		resetClueUsageCache();
	}

	toggleExpanded(): boolean {
		this.expanded = !this.expanded;
		this.tui.requestRender();
		return this.expanded;
	}

	handleClick(_localIndex?: number, _button?: string): boolean {
		// Toggle detail view or force refresh on click
		triggerClueUsageRefresh(0, true, () => this.tui.requestRender());
		this.toggleExpanded();
		return true;
	}

	render(width: number): string[] {
		// Trigger passive refresh in the background (TTL 30s)
		triggerClueUsageRefresh(30000, false, () => this.tui.requestRender());

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
			warning: (s: string): string => (theme ? safeFg(theme, "warning", s, "yellow") : s),
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
		const titleStr = `${c.pink(titleGlyph)} ${c.gold("Clue")} ${c.muted("·")} ${c.pinkAccent("MWAPI")}`;
		const titleLen = calcVisibleWidth(titleStr);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const cached = getCachedClueUsage();

		if (!cached) {
			const lines: string[] = [top];
			const lastError = getClueUsageLastError();
			if (lastError) {
				lines.push(boxLine(c.coral("⚠ Sin conexión con MWAPI")));
				lines.push(boxLine(c.dim(lastError)));
			} else {
				lines.push(boxLine(c.dim("Consultando saldo…")));
			}
			lines.push(bottom);
			return lines;
		}

		const lines: string[] = [top];

		// Saldo y estado
		const balanceFormatted = `$${cached.balance.toFixed(2)} ${cached.currency}`;
		const statusBullet = cached.isValid ? c.mint("● Activo") : c.coral("○ Agotado");
		lines.push(boxLine(`${c.pinkBright("Saldo")} ${c.gold(balanceFormatted)}`, statusBullet));

		// Consumo diario
		const kTokens = (cached.todayTokens / 1000).toFixed(1);
		const todayCostFormatted = `$${cached.todayCost.toFixed(2)}`;
		lines.push(
			boxLine(
				`${c.dim("Hoy")} ${c.text(`${cached.todayRequests} reqs`)} ${c.muted("·")} ${c.text(`${kTokens}k tok`)}`,
				c.warning(todayCostFormatted)
			)
		);

		// Barra de saldo visual o gauge estético
		const cellWidth = Math.max(1, calcVisibleWidth(g.gaugeFilled));
		const barCells = Math.max(6, Math.floor(innerWidth / cellWidth));
		// Consideramos $500 como base visual de la billetera
		const pct = Math.min(100, Math.max(0, (cached.balance / 500) * 100));
		const filledCount = Math.round((pct / 100) * barCells);
		const emptyCount = Math.max(0, barCells - filledCount);
		const barStr = `${c.mint(g.gaugeFilled.repeat(filledCount))}${c.dim(g.gaugeEmpty.repeat(emptyCount))}`;
		lines.push(boxLine(barStr));

		// Si está expandido o hay modelos usados, mostramos el desglose
		if (this.expanded && cached.topModels.length > 0) {
			lines.push(boxLine(c.dim("─".repeat(innerWidth))));
			for (const m of cached.topModels) {
				const shortName = m.model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
				const costStr = `$${m.actualCost.toFixed(2)}`;
				lines.push(boxLine(`${c.muted(shortName)} ${c.dim(`(${m.requests})`)}`, c.dim(costStr)));
			}
		}

		lines.push(bottom);
		return lines;
	}
}
