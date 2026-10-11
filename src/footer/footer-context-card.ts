import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, frameFg } from "../cute-theme.ts";
import { loadCuteLayout } from "../cute-layout.ts";
import { loadCuteStrings } from "../cute-strings.ts";
import { formatTokenCount, getContextThreshold } from "../cute-metrics.ts";
import { formatCost } from "./footer-formatters.ts";

export class CinlodevCuteContextCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly theme: Theme;

	constructor(ctx: ExtensionContext, theme: Theme) {
		this.ctx = ctx;
		this.theme = theme;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(loadCuteLayout().footer.cardMinWidth, width);
		const innerWidth = safeWidth - 4;
		const c = cutePalette(this.theme);
		const theme = this.theme;
		const g = cuteGlyphs(theme);

		const usage = this.ctx.getContextUsage?.();
		const contextWindow = usage?.contextWindow ?? this.ctx.model?.contextWindow ?? 128_000;
		const tokens = usage?.tokens ?? 0;
		const rawPercent = usage?.percent ?? (contextWindow > 0 ? (tokens / contextWindow) * 100 : 0);
		const percent = Math.max(0, Math.min(100, rawPercent));
		const percentStr = `${percent < 10 && percent > 0 ? percent.toFixed(1) : Math.round(percent)}%`;

		const threshold = getContextThreshold(percent, c);

		const boxLine = (left: string, right = ""): string => {
			const spaceNeeded = innerWidth - visibleWidth(left) - visibleWidth(right);
			const pad = right.length > 0 ? " ".repeat(Math.max(1, spaceNeeded)) : "";
			const content = truncateToWidth(left + pad + right, innerWidth);
			const fill = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
			return `${frameFg(theme, g.v)} ${content}${fill} ${frameFg(theme, g.v)}`;
		};

		const contextTitle = loadCuteStrings().contextTitle;
		const titleStr = c.pinkBright(contextTitle);
		const fillTop = Math.max(0, safeWidth - 4 - visibleWidth(contextTitle) - 1);
		const top = `${frameFg(theme, `${g.tl}${g.h} `)}${titleStr}${frameFg(theme, ` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frameFg(theme, `${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		// Metric 1: Tokens / Context Window (Left) and Health + % (Right)
		const tokenNumFormatted = formatTokenCount(tokens);
		const boldTokenNum = `\x1b[1m${threshold.color(tokenNumFormatted)}\x1b[22m`;
		const tokensStr = `${boldTokenNum} ${c.muted("/")} ${c.muted(formatTokenCount(contextWindow))} ${c.muted("tokens")}`;
		const boldRightStatusAndPercent = `\x1b[1m${threshold.color(`${threshold.label} ${percentStr}`)}\x1b[22m`;

		// Metric 2: Full-width Gauge Bar
		const cellWidth = Math.max(1, visibleWidth(g.gaugeFilled));
		const barCells = Math.max(4, Math.floor(innerWidth / cellWidth));
		const filledCount = Math.round((percent / 100) * barCells);
		const emptyCount = barCells - filledCount;
		const barStr = `${threshold.color(g.gaugeFilled.repeat(filledCount))}${c.dim(g.gaugeEmpty.repeat(emptyCount))}`;

		// Metric 3: In/Out tokens breakdown & Session Cost
		let inputTokens = 0;
		let outputTokens = 0;
		let costTotal = 0;
		try {
			for (const entry of (this.ctx.sessionManager?.getEntries() ?? []) as any[]) {
				if (entry.type === "message" && entry.message?.role === "assistant") {
					const u = entry.message.usage;
					inputTokens += (u?.input ?? 0) + (u?.cacheRead ?? 0);
					outputTokens += u?.output ?? 0;
					if (typeof u?.cost === "number") {
						costTotal += u.cost;
					} else if (u?.cost && typeof u.cost.total === "number") {
						costTotal += u.cost.total;
					}
				}
			}
		} catch {}

		const leftBreakdown = `${c.muted("▲")} ${c.text(formatTokenCount(inputTokens))} ${c.muted("in")}  ${c.muted("·")}  ${c.muted("▼")} ${c.text(formatTokenCount(outputTokens))} ${c.muted("out")}`;
		const rightCost = `${c.gold("Cost")} ${c.text(formatCost(costTotal))}`;

		return [
			top,
			boxLine(tokensStr, boldRightStatusAndPercent),
			boxLine(barStr),
			boxLine(leftBreakdown, rightCost),
			bottom,
		];
	}

	invalidate(): void {}
}
