import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, safeFg } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	detectProjectName,
	formatRelativeTime,
	fetchLatestHandoff,
	type EngramHandoffRecord,
} from "./engram-client.ts";

/**
 * Sidebar Engram Handoff Snapshot Card for pi-cinlodev-cute.
 * Displays the latest session summary and active context directly below Engram in the MEM tab.
 */
export class CinlodevEngramHandoffCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private cachedHandoff: EngramHandoffRecord | null = null;
	private lastFetch = 0;
	private fetching = false;

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui ?? ({ requestRender: () => {} } as any);
		this.theme = theme;
	}

	invalidate(): void {
		this.lastFetch = 0;
		this.cachedHandoff = null;
	}

	handleClick(): boolean {
		this.invalidate();
		this.tui.requestRender();
		return true;
	}

	private triggerRefresh(project: string): void {
		const now = Date.now();
		if (this.fetching || now - this.lastFetch < 15000) return;
		this.fetching = true;
		fetchLatestHandoff(project)
			.then((record) => {
				this.cachedHandoff = record;
				this.lastFetch = Date.now();
				this.fetching = false;
				this.tui.requestRender();
			})
			.catch(() => {
				this.fetching = false;
				this.lastFetch = Date.now();
			});
	}

	render(width: number): string[] {
		const cwd = this.ctx?.cwd ?? process.cwd();
		const projectName = detectProjectName(cwd);
		this.triggerRefresh(projectName);

		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;
		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const c = {
			pink: (s: string): string => (theme ? safeFg(theme, "accent", s, "pink") : s),
			gold: (s: string): string => (theme ? safeFg(theme, "heading", s, "yellow") : s),
			cyan: (s: string): string => (theme ? safeFg(theme, "write", s, "cyan") : s),
			celeste: (s: string): string => (theme ? safeFg(theme, "write", s, "cyan") : s),
			mint: (s: string): string => (theme ? safeFg(theme, "mint", s, "green") : s),
			text: (s: string): string => (theme ? safeFg(theme, "text", s) : s),
			dim: (s: string): string => (theme ? safeFg(theme, "dim", s) : s),
			muted: (s: string): string => (theme ? safeFg(theme, "muted", s) : s),
		};

		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		const titleStr = `${c.pink("🧠")} ${c.gold("Active Handoff")}`;
		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(titleStr) > maxTitleLen ? truncateAnsiAware(titleStr, maxTitleLen) : titleStr;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		if (!this.cachedHandoff) {
			return [
				top,
				boxLine(c.dim("Sin resumen de sesión previo")),
				boxLine(c.dim("(Se registrará con /handoff)")),
				bottom,
			];
		}

		const h = this.cachedHandoff;
		const relativeDate = h.date ? formatRelativeTime(h.date) : "reciente";
		const lines: string[] = [top];
		lines.push(boxLine(`${c.cyan(`#${h.id || "?"}`)} ${c.gold(h.type || "session_summary")}`, c.muted(relativeDate)));
		lines.push(frame(`${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));

		// Breathing line after divider
		lines.push(boxLine(""));

		const colorizeText = (str: string): string => {
			return str
				.replace(/(PR\s*#\d+)/gi, (m) => c.gold(m))
				.replace(/\b(develop|main|master)\b/g, (m) => c.mint(m))
				.replace(/(->|➔)/g, () => c.pink("➔"));
		};

		const rawLines = h.rawLines && h.rawLines.length > 0 ? h.rawLines : [(h.content || h.title || "").trim()];

		for (const raw of rawLines) {
			if (!raw) continue;
			const trimmed = raw.trim();

			// 1. Bullet item
			if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
				const itemText = trimmed.replace(/^[-*•]\s*/, "");
				const maxItemLen = Math.max(0, innerWidth - 5);
				const truncated = truncateAnsiAware(itemText, maxItemLen);
				const styled = colorizeText(truncated);
				lines.push(boxLine(`  ${c.pink("•")} ${c.celeste(styled)}`));
				continue;
			}

			// 2. Section header (e.g. "Features delivered:" or "Goal:")
			if (trimmed.endsWith(":") || trimmed.startsWith("#")) {
				const cleanHdr = trimmed.replace(/^#+\s*/, "");
				lines.push(boxLine(`${c.pink("✦")} ${c.gold(cleanHdr)}`));
				continue;
			}

			// 3. Regular prose / summary headline with wrapping and Dracula highlights
			const words = trimmed.split(/\s+/);
			let cur = "";
			for (const w of words) {
				if ((cur + " " + w).trim().length > innerWidth - 2) {
					lines.push(boxLine(c.celeste(colorizeText(cur.trim()))));
					cur = w;
				} else {
					cur = (cur + " " + w).trim();
				}
			}
			if (cur) {
				lines.push(boxLine(c.celeste(colorizeText(cur.trim()))));
			}
		}

		// Breathing line before bottom
		lines.push(boxLine(""));
		lines.push(bottom);
		return lines;
	}
}
