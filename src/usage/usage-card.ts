import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	getQuotaThreshold,
	cleanPoolLabel,
	formatRelativeReset,
} from "./usage-thresholds.ts";
import {
	getCachedAccounts,
	getUsageLastError,
	triggerUsageRefresh,
	resetUsageCache,
} from "./usage-client.ts";

/**
 * Sidebar Quota / Usage Card for pi-cinlodev-cute.
 * - Non-blocking ambient component.
 * - Toggled via Alt+Q shortcut or /usage-card command.
 * - Focuses on ONE account at a time by its Prefix (no email displayed).
 * - Renders the account's 4 quota bars with Context-style gauges (▰▰▰▱▱).
 * - Clicking the card or scrolling the mouse wheel cycles through accounts.
 */
export class CinlodevUsageCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private visible = false;
	private selectedIndex = 0;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	isVisible(): boolean {
		return this.visible;
	}

	setVisible(visible: boolean): void {
		if (this.visible !== visible) {
			this.visible = visible;
			if (this.visible) {
				triggerUsageRefresh(this.ctx, this.tui, 0); // Force fresh check on open
			}
			this.tui.requestRender();
		}
	}

	toggle(): boolean {
		this.setVisible(!this.visible);
		return this.visible;
	}

	cycleAccount(direction: 1 | -1 = 1): void {
		const cached = getCachedAccounts();
		if (!cached || !cached.length) return;
		const len = cached.length;
		this.selectedIndex = (this.selectedIndex + direction + len) % len;
		this.tui.requestRender();
	}

	handleClick(_localIndex?: number, button?: string): boolean {
		// Right click steps backward, left click advances forward
		const direction = button === "right" ? -1 : 1;
		this.cycleAccount(direction);
		return true;
	}

	handleWheel(wheelDelta: number): boolean {
		if (wheelDelta === 0) return false;
		const direction = wheelDelta > 0 ? 1 : -1;
		this.cycleAccount(direction);
		return true;
	}

	invalidate(): void {
		resetUsageCache();
	}

	render(width: number): string[] {
		// When hidden, take up 0 space in the sidebar rail
		if (!this.visible) return [];

		triggerUsageRefresh(this.ctx, this.tui, 15000);

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

		// Standard boxLine: strictly guarantees total visible width = safeWidth
		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		const cached = getCachedAccounts();

		// If no cached data yet and fetching
		if (!cached) {
			const titleGlyph = g.brand || "✿";
			const titleStr = `${c.pink(titleGlyph)} ${c.gold("Quotas")} ${c.dim("Alt+Q")}`;
			const titleLen = calcVisibleWidth(titleStr);
			const fillTop = Math.max(0, safeWidth - 5 - titleLen);
			const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
			const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

			const lines: string[] = [top];
			const lastError = getUsageLastError();
			if (lastError) {
				lines.push(boxLine(c.coral("⚠ Sin conexión con CLIProxyAPI")));
				lines.push(boxLine(c.dim("Verificá auth.json o puerto 8317")));
			} else {
				lines.push(boxLine(c.dim("Cargando cuotas…")));
			}
			lines.push(bottom);
			return lines;
		}

		if (!cached.length) {
			const titleGlyph = g.brand || "✿";
			const titleStr = `${c.pink(titleGlyph)} ${c.gold("Quotas")} ${c.dim("Alt+Q")}`;
			const titleLen = calcVisibleWidth(titleStr);
			const fillTop = Math.max(0, safeWidth - 5 - titleLen);
			const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
			const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

			return [top, boxLine(c.muted("No hay cuentas activas registradas")), bottom];
		}

		// Ensure valid account index
		if (this.selectedIndex >= cached.length) {
			this.selectedIndex = 0;
		}

		const currentAccount = cached[this.selectedIndex];
		const titleGlyph = g.brand || "✿";

		// Title shows provider and prefix: "✿ antigravity · <prefix> ▾ Alt+Q" (NO EMAIL!)
		const titleStr = `${c.pink(titleGlyph)} ${c.gold(currentAccount.provider)} ${c.mint(`· ${currentAccount.prefix}`)} ${c.dim("▾")} ${c.dim("Alt+Q")}`;
		const titleLen = calcVisibleWidth(titleStr);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];

		// Render all quota pools of the selected account (typically 4 for Antigravity, 1 for Codex, 3 for OpenCode)
		for (let i = 0; i < currentAccount.pools.length; i++) {
			const p = currentAccount.pools[i];

			// Format color by remaining percentage using 4-tier dynamic semáforo
			const pct = Math.round(p.availablePercent);
			const threshold = getQuotaThreshold(p.availablePercent, c);

			// Clean label for models (e.g. "Gemini 5h", "Claude/GPT Weekly")
			const cleanLabel = cleanPoolLabel(p.label);
			const poolHeaderLeft = `${threshold.color("●")} ${c.text(cleanLabel)}`;

			const resetStr = formatRelativeReset(p.resetAt);
			const pctFormatted = `\x1b[1m${threshold.color(`${pct}%`)}\x1b[22m`;
			const poolHeaderRight = resetStr ? `${pctFormatted} ${c.muted("·")} ${c.dim(resetStr)}` : pctFormatted;

			lines.push(boxLine(poolHeaderLeft, poolHeaderRight));

			// Gauge bar matching Context card style: full-width gaugeFilled and gaugeEmpty
			const cellWidth = Math.max(1, calcVisibleWidth(g.gaugeFilled));
			const barCells = Math.max(4, Math.floor(innerWidth / cellWidth));
			const filledCount = Math.round((pct / 100) * barCells);
			const emptyCount = Math.max(0, barCells - filledCount);
			const barStr = `${threshold.color(g.gaugeFilled.repeat(filledCount))}${c.dim(g.gaugeEmpty.repeat(emptyCount))}`;

			lines.push(boxLine(barStr));
		}

		lines.push(bottom);
		return lines;
	}
}
