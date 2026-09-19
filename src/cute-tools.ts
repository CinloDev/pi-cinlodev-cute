import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, safeFg } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { loadCuteLayout } from "./cute-layout.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";

export interface ToolCounts {
	read: number;
	write: number;
	bash: number;
	engram: number;
	grep: number;
	fetch: number;
	search: number;
	other: number;
	total: number;
}

export function createEmptyToolCounts(): ToolCounts {
	return {
		read: 0,
		write: 0,
		bash: 0,
		engram: 0,
		grep: 0,
		fetch: 0,
		search: 0,
		other: 0,
		total: 0,
	};
}

/**
 * Extracts and categorizes all tool executions from the session history.
 */
export function collectToolCounts(ctx?: ExtensionContext | any): ToolCounts {
	const counts = createEmptyToolCounts();
	if (!ctx) return counts;

	const branch = ctx.sessionManager?.getBranch?.() ?? [];
	for (const entry of branch) {
		if (entry.type !== "message" || !entry.message) continue;
		const msg = entry.message;

		// 1. Check assistant toolCalls in content array
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part && typeof part === "object" && part.type === "toolCall") {
					recordToolCall(counts, String(part.name || ""));
				}
			}
		}

		// 2. Fallback check for toolResult messages
		if (msg.role === "toolResult" && typeof msg.toolName === "string") {
			// Some harnesses emit toolResult directly; only count if content.toolCall was absent
			// To avoid double-counting, we prioritize assistant.content above.
		}
	}

	return counts;
}

export function recordToolCall(counts: ToolCounts, name: string): void {
	const lower = name.trim().toLowerCase();
	if (!lower) return;

	counts.total++;
	if (lower === "read") {
		counts.read++;
	} else if (lower === "write" || lower === "edit") {
		counts.write++;
	} else if (lower === "bash") {
		counts.bash++;
	} else if (lower.startsWith("mem_")) {
		counts.engram++;
	} else if (lower === "grep") {
		counts.grep++;
	} else if (lower === "fetch" || lower === "fetch_content") {
		counts.fetch++;
	} else if (lower === "search" || lower === "web_search") {
		counts.search++;
	} else {
		counts.other++;
	}
}

/**
 * Formats a single tool category pill with its distinctive CUTE color and glyph.
 */
export function formatToolPill(category: keyof Omit<ToolCounts, "total">, count: number, theme?: Theme): string {
	if (count <= 0) return "";
	if (!theme) return `${count} ${category}`;

	switch (category) {
		case "read":
			return safeFg(theme, "read", `✎ ${count} read`, "magenta");
		case "write":
			return safeFg(theme, "write", `✎ ${count} write`, "cyan");
		case "bash":
			return safeFg(theme, "bash", `>_ ${count} bash`, "green");
		case "engram":
			return safeFg(theme, "salmon", `🧠 ${count} engram`, "red");
		case "grep":
			return safeFg(theme, "warning", `🔍 ${count} grep`, "yellow");
		case "fetch":
			return safeFg(theme, "pink", `↓ ${count} fetch`, "magenta");
		case "search":
			return safeFg(theme, "secondary", `◆ ${count} search`, "magenta");
		case "other":
			return safeFg(theme, "dim", `⚙ ${count} other`, "muted");
		default:
			return "";
	}
}

/**
 * Distributes formatted tool pills into lines that fit inside the rail width.
 */
export function wrapToolPills(pills: string[], innerWidth: number): string[] {
	const validPills = pills.filter((p) => p.length > 0);
	if (!validPills.length) return [];

	const lines: string[] = [];
	let currentLinePills: string[] = [];
	let currentLineWidth = 0;

	for (const pill of validPills) {
		const pillWidth = calcVisibleWidth(pill);
		const gap = currentLinePills.length > 0 ? 3 : 0; // 3 spaces gap between pills

		if (currentLinePills.length > 0 && currentLineWidth + gap + pillWidth > innerWidth) {
			lines.push(currentLinePills.join("   "));
			currentLinePills = [pill];
			currentLineWidth = pillWidth;
		} else {
			currentLinePills.push(pill);
			currentLineWidth += gap + pillWidth;
		}
	}

	if (currentLinePills.length > 0) {
		lines.push(currentLinePills.join("   "));
	}

	return lines;
}

/**
 * Interactive Tools Telemetry card for the Cinlodev CUTE sidebar rail.
 * Shows pill badges of all tools executed by the agent in the session.
 * Stays hidden when no tools have been used yet.
 */
export class CinlodevToolsCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	invalidate(): void {
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const cfg = loadCuteLayout().tools;
		if (!cfg.enabled) return [];

		const counts = collectToolCounts(this.ctx);
		if (counts.total === 0) return [];

		const safeWidth = Math.max(cfg.minWidth, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║
		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const dimText = (s: string): string => (theme ? safeFg(theme, "dim", s, "muted") : s);

		const boxLine = (content: string): string => {
			const truncated = truncateAnsiAware(content, innerWidth);
			const visibleLen = calcVisibleWidth(truncated);
			const padLen = Math.max(0, innerWidth - visibleLen);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncated}${pad} ${frame(g.v)}`;
		};

		// Ordered category keys
		const order: Array<keyof Omit<ToolCounts, "total">> = [
			"read",
			"write",
			"bash",
			"engram",
			"grep",
			"fetch",
			"search",
			"other",
		];

		const pills = order
			.map((cat) => formatToolPill(cat, counts[cat], theme))
			.filter((p) => p.length > 0);

		if (!pills.length) return [];

		const contentLines = wrapToolPills(pills, innerWidth);

		const titleLeft = "🛠 tools";
		const styledTitleLeft = `${theme ? safeFg(theme, "heading", "🛠 tools") : "🛠 tools"}`;
		const titleRight = `${counts.total} calls`;
		const styledTitleRight = `${dimText(titleRight)} `;

		const availableSpace = safeWidth - 4 - calcVisibleWidth(titleLeft) - calcVisibleWidth(titleRight) - 2;
		const fillTop = Math.max(0, availableSpace);
		const top = `${frame(`${g.tl}${g.h} `)}${styledTitleLeft}${frame(` ${g.h.repeat(fillTop)} `)}${styledTitleRight}${frame(g.tr)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];
		for (const row of contentLines) {
			lines.push(boxLine(row));
		}
		lines.push(bottom);

		return lines;
	}
}
