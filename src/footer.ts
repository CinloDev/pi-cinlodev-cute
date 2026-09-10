import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { installSidebar, sidebarPart } from "./sidebar.ts";
import { CinlodevTodoMirror } from "./todos.ts";

const execAsync = promisify(exec);

// Cinlodev CUTE Palette ANSI TrueColor codes
const C_VIOLET = "\x1b[38;2;142;68;173m";   // #8e44ad - Dividers & subtle borders
const C_PINK_BRIGHT = "\x1b[38;2;255;177;221m"; // #FFB1DD - Petal / Glyph accent
const C_PINK_ACCENT = "\x1b[38;2;240;149;200m"; // #F095C8 - Brand text
const C_GOLD = "\x1b[38;2;224;194;122m";      // #E0C27A - Thinking / Highlights
const C_YELLOW = "\x1b[38;2;242;184;109m";    // #F2B86D - Git dirty warning
const C_TEXT = "\x1b[38;2;246;239;243m";      // #F6EFF3 - Primary text
const C_MUTED = "\x1b[38;2;167;142;155m";     // #A78E9B - Secondary labels
const C_DIM = "\x1b[38;2;118;97;107m";        // #76616B - Dim / empty gauge
const RESET = "\x1b[39m";

let todoHooksInstalled = false;
let latestTodoTui: TUI | undefined;

const SEPARATOR = `${C_VIOLET}│${RESET}`;
const GAUGE_CELLS = 6;
const GAUGE_FILLED = "▰";
const GAUGE_EMPTY = "▱";

function shortModelName(modelId: string): string {
	const parts = modelId.split("/");
	return parts.length > 1 ? parts[parts.length - 1] : modelId;
}

function sessionCost(ctx: ExtensionContext): number {
	let total = 0;
	try {
		for (const entry of (ctx.sessionManager?.getEntries() ?? []) as any[]) {
			if (entry.type === "message" && entry.message?.role === "assistant") {
				total += entry.message.usage?.cost?.total ?? 0;
			}
		}
	} catch {}
	return total;
}

function formatCost(total: number): string {
	return `$${total >= 1 ? total.toFixed(2) : total.toFixed(3)}`;
}

function renderGauge(percent: number | null): string {
	if (percent === null) {
		return `${C_DIM}${GAUGE_EMPTY.repeat(GAUGE_CELLS)}${RESET}`;
	}
	const clamped = Math.max(0, Math.min(100, percent));
	const filledCount = Math.round((clamped / 100) * GAUGE_CELLS);
	const emptyCount = GAUGE_CELLS - filledCount;

	const filledStr = `${C_PINK_BRIGHT}${GAUGE_FILLED.repeat(filledCount)}${RESET}`;
	const emptyStr = `${C_DIM}${GAUGE_EMPTY.repeat(emptyCount)}${RESET}`;
	return filledStr + emptyStr;
}

export class CinlodevCuteFooter implements Component {
	private readonly pi: ExtensionAPI;
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly footerData: ReadonlyFooterDataProvider;
	private dirtyCount: number | undefined;
	private lastDirtyCheck = 0;
	private unsubscribeBranch: (() => void) | undefined;

	constructor(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	) {
		this.pi = pi;
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.footerData = footerData;
		if (footerData.onBranchChange) {
			this.unsubscribeBranch = footerData.onBranchChange(() => {
				this.refreshDirty();
				this.tui.requestRender();
			});
		}
		this.refreshDirty();
	}

	private refreshDirty(): void {
		const now = Date.now();
		if (now - this.lastDirtyCheck < 4000) return;
		this.lastDirtyCheck = now;

		const cwd = this.ctx.cwd ?? process.cwd();
		execAsync(`git -C "${cwd}" status --porcelain`)
			.then(({ stdout }) => {
				const trimmed = stdout.trim();
				const count = trimmed.length === 0 ? 0 : trimmed.split("\n").length;
				if (this.dirtyCount !== count) {
					this.dirtyCount = count;
					this.tui.requestRender();
				}
			})
			.catch(() => {
				this.dirtyCount = undefined;
			});
	}

	render(width: number): string[] {
		this.refreshDirty();
		const safeWidth = Math.max(20, width);

		// 1. Brand segment: ✿ Cinlodev CUTE
		const brandSegment = `${C_PINK_BRIGHT}✿${RESET} ${C_PINK_ACCENT}Cinlodev CUTE${RESET}`;

		// 2. Git branch & dirty badge:  branch ±N
		const branch = this.footerData.getGitBranch() || "no-git";
		const dirtyBadge =
			this.dirtyCount && this.dirtyCount > 0 ? ` ${C_YELLOW}±${this.dirtyCount}${RESET}` : "";
		const gitSegment = `${C_TEXT} ${branch}${RESET}${dirtyBadge}`;

		// 3. Model & thinking level: model (thinking)
		const rawModel = this.ctx.model?.id ?? "no-model";
		const displayModel = shortModelName(rawModel);
		const thinking = this.pi.getThinkingLevel();
		const thinkingLabel =
			thinking && thinking !== "off" ? ` ${C_GOLD}(${thinking})${RESET}` : "";
		const modelSegment = `${C_TEXT}${displayModel}${RESET}${thinkingLabel}`;

		// 4. Context gauge: ctx ▰▰▱▱▱▱ 10%
		const usage = this.ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		const percentStr = percent !== null ? `${Math.round(percent)}%` : "?%";
		const gaugeStr = renderGauge(percent);
		const contextSegment = `${C_MUTED}ctx${RESET} ${gaugeStr} ${C_TEXT}${percentStr}${RESET}`;

		// 5. Session Cost: $0.000
		const costStr = formatCost(sessionCost(this.ctx));
		const costSegment = `${C_TEXT}${costStr}${RESET}`;

		// 6. Optional extension statuses (e.g. MCP servers, background jobs)
		const extraStatuses: string[] = [];
		try {
			const statusesMap = this.footerData.getExtensionStatuses?.();
			if (statusesMap) {
				for (const [, text] of statusesMap) {
					if (text && text.trim().length > 0) {
						extraStatuses.push(`${C_MUTED}${text.trim()}${RESET}`);
					}
				}
			}
		} catch {}

		// Build segments array
		let segments = [
			brandSegment,
			gitSegment,
			modelSegment,
			contextSegment,
			costSegment,
			...extraStatuses,
		];

		const joinLine = (segs: string[]) => segs.join(` ${SEPARATOR} `);
		let line = joinLine(segments);

		// If it overflows terminal width, progressively compact
		if (visibleWidth(line) > safeWidth) {
			// 1. Drop extra statuses first
			while (segments.length > 5 && visibleWidth(line) > safeWidth) {
				segments.pop();
				line = joinLine(segments);
			}
		}
		if (visibleWidth(line) > safeWidth) {
			// 2. Compact git branch if long
			const compactBranch =
				branch.length > 18 ? `${branch.slice(0, 17)}…` : branch;
			const compactGit = `${C_TEXT} ${compactBranch}${RESET}${dirtyBadge}`;
			segments = [brandSegment, compactGit, modelSegment, contextSegment, costSegment];
			line = joinLine(segments);
		}
		if (visibleWidth(line) > safeWidth) {
			// 3. Drop cost segment
			segments = [segments[0], segments[1], modelSegment, contextSegment];
			line = joinLine(segments);
		}
		if (visibleWidth(line) > safeWidth) {
			// 4. Drop context segment
			segments = [segments[0], segments[1], modelSegment];
			line = joinLine(segments);
		}
		if (visibleWidth(line) > safeWidth) {
			// 5. Shorten brand to ✿ Cinlodev
			const shortBrand = `${C_PINK_BRIGHT}✿${RESET} ${C_PINK_ACCENT}Cinlodev${RESET}`;
			segments = [shortBrand, segments[1]];
			line = joinLine(segments);
		}

		return [truncateToWidth(line, safeWidth, "…")];
	}

	renderSidebarCard(width: number): string[] {
		this.refreshDirty();
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;

		const border = C_VIOLET;
		const cTitle = C_PINK_BRIGHT;
		const cLabel = C_GOLD;
		const cText = C_TEXT;
		const cAccent = C_PINK_ACCENT;
		const cWarning = C_YELLOW;
		const cMuted = C_MUTED;

		const boxLine = (left: string, right = ""): string => {
			const spaceNeeded = innerWidth - visibleWidth(left) - visibleWidth(right);
			const pad = " ".repeat(Math.max(1, spaceNeeded));
			const content = truncateToWidth(left + pad + right, innerWidth);
			const fill = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
			return `${border}║${RESET} ${content}${fill} ${border}║${RESET}`;
		};

		const titleStr = `${cTitle}✿ Status${RESET}`;
		const rawTitle = "✿ Status";
		const fillTop = Math.max(0, safeWidth - 4 - visibleWidth(rawTitle) - 1);
		const top = `${border}╔═ ${titleStr} ${border}${"═".repeat(fillTop)}╗${RESET}`;
		const bottom = `${border}╚${"═".repeat(safeWidth - 2)}╝${RESET}`;

		const rawCwd = this.ctx.cwd ?? process.cwd();
		const home = process.env.HOME ?? "";
		const shortCwd = home && rawCwd.startsWith(home) ? `~${rawCwd.slice(home.length)}` : rawCwd;

		const branch = this.footerData.getGitBranch() || "no-git";
		const dirtyBadge = this.dirtyCount && this.dirtyCount > 0 ? ` ${cWarning}±${this.dirtyCount}${RESET}` : "";

		const rawModel = this.ctx.model?.id ?? "no-model";
		const displayModel = shortModelName(rawModel);
		const thinking = this.pi.getThinkingLevel();
		const thinkingStr = thinking && thinking !== "off" ? ` ${cLabel}(${thinking})${RESET}` : "";

		const usage = this.ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		const percentStr = percent !== null ? `${Math.round(percent)}%` : "?%";
		const gauge = renderGauge(percent);
		const cost = formatCost(sessionCost(this.ctx));

		const extraStatuses: string[] = [];
		try {
			const statusesMap = this.footerData.getExtensionStatuses?.();
			if (statusesMap) {
				for (const [, text] of statusesMap) {
					if (text && text.trim().length > 0) extraStatuses.push(text.trim());
				}
			}
		} catch {}

		const lines: string[] = [
			top,
			boxLine(`${cLabel}Project${RESET}`, `${cText}${shortCwd}${RESET}`),
			boxLine(`${cLabel}Branch${RESET}`, `${cText} ${branch}${RESET}${dirtyBadge}`),
			boxLine(`${cLabel}Model${RESET}`, `${cAccent}${displayModel}${RESET}${thinkingStr}`),
			boxLine(`${cLabel}Context${RESET}`, `${gauge} ${cText}${percentStr}${RESET}`),
			boxLine(`${cLabel}Cost${RESET}`, `${cText}${cost}${RESET}`),
		];

		if (extraStatuses.length > 0) {
			lines.push(`${border}╠${"═".repeat(safeWidth - 2)}╣${RESET}`);
			for (const status of extraStatuses.slice(0, 3)) {
				lines.push(boxLine(`${cMuted}${status}${RESET}`));
			}
		}

		lines.push(bottom);
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		if (this.unsubscribeBranch) {
			this.unsubscribeBranch();
			this.unsubscribeBranch = undefined;
		}
	}
}

export function installCinlodevFooter(ctx: ExtensionContext, pi: ExtensionAPI): void {
	if (!ctx.hasUI) return;
	if (!todoHooksInstalled) {
		todoHooksInstalled = true;
		const refreshTodos = () => {
			try {
				latestTodoTui?.requestRender();
			} catch {}
		};
		pi.on("session_start", refreshTodos);
		pi.on("turn_end", refreshTodos);
		pi.on("tool_execution_end", refreshTodos);
	}
	ctx.ui.setFooter((tui, theme, footerData) => {
		const bottom = new CinlodevCuteFooter(pi, ctx, tui, theme, footerData);
		const todos = new CinlodevTodoMirror(ctx, tui);
		latestTodoTui = tui;
		const rail = {
			render: (width: number) => bottom.renderSidebarCard(width),
			invalidate: () => bottom.invalidate(),
		};
		const part = sidebarPart(tui, "footer", bottom, rail);
		const todoBottom: Component & { dispose?(): void } = {
			render: (width: number) => todos.renderBottom(width),
			invalidate: () => todos.invalidate(),
		};
		const todoRail: Component & { dispose?(): void } = {
			render: (width: number) => todos.renderRail(width),
			invalidate: () => todos.invalidate(),
		};
		const todoPart = sidebarPart(tui, "todo", todoBottom, todoRail);
		const uninstall = installSidebar(tui);
		return {
			...part,
			dispose() {
				uninstall();
				part.dispose?.();
				todoPart.dispose?.();
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installCinlodevFooter(ctx, pi);
	});
}
