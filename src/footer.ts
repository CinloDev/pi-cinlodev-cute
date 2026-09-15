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
import { cuteGlyphs, cutePalette, frameFg } from "./cute-theme.ts";
import { CinlodevTodoMirror } from "./todos.ts";
import { formatProfileDisplay, loadCuteStrings, matchBracketProfile } from "./cute-strings.ts";
import { loadCuteLayout, tuneTuiScroll } from "./cute-layout.ts";
import { formatCwd, quoteGitCwd } from "./cute-paths.ts";

const execAsync = promisify(exec);

// Cinlodev CUTE colors come from themes/CinlodevCute.json via cutePalette()
// (border, pinkBright, accent, heading, warning, text, muted, dim). No hardcodes.

let todoHooksInstalled = false;
let latestTodoTui: TUI | undefined;

function separator(theme: Theme): string {
	return frameFg(theme, cuteGlyphs(theme).separator);
}
// Layout numbers (gauge cells, widths, intervals) come from
// config/CinlodevCute.layout.json via loadCuteLayout(). No hardcodes.

function gaugeGlyphs(theme: Theme): { filled: string; empty: string } {
	const g = cuteGlyphs(theme);
	return { filled: g.gaugeFilled, empty: g.gaugeEmpty };
}

/** Render a host "[name]" status as icon plus name; other statuses pass through. */
function prettifyExtraStatus(raw: string, theme: Theme): string {
	const name = matchBracketProfile(raw);
	if (name === null) return raw.trim();
	return formatProfileDisplay(cuteGlyphs(theme).profileIcon, loadCuteStrings().profileFormat, name);
}

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
	const layout = loadCuteLayout().footer;
	return `$${total >= 1 ? total.toFixed(layout.costDecimalsAboveOne) : total.toFixed(layout.costDecimalsBelowOne)}`;
}

function renderGauge(theme: Theme, percent: number | null): string {
	const c = cutePalette(theme);
	const gauge = gaugeGlyphs(theme);
	const cells = loadCuteLayout().footer.gaugeCells;
	if (percent === null) {
		return c.dim(gauge.empty.repeat(cells));
	}
	const clamped = Math.max(0, Math.min(100, percent));
	const filledCount = Math.round((clamped / 100) * cells);
	const emptyCount = cells - filledCount;

	const filledStr = c.pinkBright(gauge.filled.repeat(filledCount));
	const emptyStr = c.dim(gauge.empty.repeat(emptyCount));
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
		if (now - this.lastDirtyCheck < loadCuteLayout().footer.dirtyMs) return;
		this.lastDirtyCheck = now;

		const cwd = this.ctx.cwd ?? process.cwd();
		execAsync(`git -C ${quoteGitCwd(cwd)} status --porcelain`)
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
		const safeWidth = Math.max(loadCuteLayout().footer.minWidth, width);
		const c = cutePalette(this.theme);

		// 1. Brand segment (texts from config/CinlodevCute.strings.json via loadCuteStrings())
		const strings = loadCuteStrings();
		const user = strings.welcomePersona.user || "Cinlo";
		const brandText = strings.footerBrand.replace("{user}", user);
		const brandSegment = `${c.pinkBright(strings.footerSymbol)} ${c.pinkAccent(brandText)}`;

		// 2. Git branch & dirty badge (branch glyph via cuteGlyphs)
		const branch = this.footerData.getGitBranch() || "no-git";
		const branchGlyph = cuteGlyphs(this.theme).branch;
		const dirtyBadge =
			this.dirtyCount && this.dirtyCount > 0 ? ` ${c.yellow(`±${this.dirtyCount}`)}` : "";
		const gitSegment = `${c.text(`${branchGlyph} ${branch}`)}${dirtyBadge}`;

		// 3. Model & thinking level: model (thinking)
		const rawModel = this.ctx.model?.id ?? "no-model";
		const displayModel = shortModelName(rawModel);
		const thinking = this.pi.getThinkingLevel();
		const thinkingLabel =
			thinking && thinking !== "off" ? ` ${c.gold(`(${thinking})`)}` : "";
		const modelSegment = `${c.text(displayModel)}${thinkingLabel}`;

		// 4. Context gauge (cells via cuteGlyphs gaugeFilled/gaugeEmpty)
		const usage = this.ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		const percentStr = percent !== null ? `${Math.round(percent)}%` : "?%";
		const gaugeStr = renderGauge(this.theme, percent);
		const contextSegment = `${c.muted("ctx")} ${gaugeStr} ${c.text(percentStr)}`;

		// 5. Session Cost: $0.000
		const costStr = formatCost(sessionCost(this.ctx));
		const costSegment = `${c.text(costStr)}`;

		// 6. Optional extension statuses (e.g. MCP servers, background jobs)
		const extraStatuses: string[] = [];
		try {
			const statusesMap = this.footerData.getExtensionStatuses?.();
			if (statusesMap) {
				for (const [, text] of statusesMap) {
					if (text && text.trim().length > 0) {
						extraStatuses.push(c.muted(prettifyExtraStatus(text, this.theme)));
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

		const joinLine = (segs: string[]) => segs.join(` ${separator(this.theme)} `);
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
			const branchMax = loadCuteLayout().footer.branchMax;
			const compactBranch =
				branch.length > branchMax ? `${branch.slice(0, branchMax - 1)}…` : branch;
			const compactGit = `${c.text(`${branchGlyph} ${compactBranch}`)}${dirtyBadge}`;
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
			// 5. Shorten brand (texts from config/CinlodevCute.strings.json via loadCuteStrings())
			const shortText = strings.footerShort.replace("{user}", user);
			const shortBrand = `${c.pinkBright(strings.footerSymbol)} ${c.pinkAccent(shortText)}`;
			segments = [shortBrand, segments[1]];
			line = joinLine(segments);
		}

		return [truncateToWidth(line, safeWidth, "…")];
	}

	renderSidebarCard(width: number): string[] {
		this.refreshDirty();
		const safeWidth = Math.max(loadCuteLayout().footer.cardMinWidth, width);
		const innerWidth = safeWidth - 4;
		const c = cutePalette(this.theme);
		const theme = this.theme;

		const cTitle = (s: string) => c.pinkBright(s);
		const cLabel = (s: string) => c.gold(s);
		const cText = (s: string) => c.text(s);
		const cAccent = (s: string) => c.pinkAccent(s);
		const cWarning = (s: string) => c.yellow(s);
		const cMuted = (s: string) => c.muted(s);

		const g = cuteGlyphs(theme);
		const boxLine = (left: string, right = ""): string => {
			const spaceNeeded = innerWidth - visibleWidth(left) - visibleWidth(right);
			const pad = " ".repeat(Math.max(1, spaceNeeded));
			const content = truncateToWidth(left + pad + right, innerWidth);
			const fill = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
			return `${frameFg(theme, g.v)} ${content}${fill} ${frameFg(theme, g.v)}`;
		};

		const statusTitle = loadCuteStrings().statusTitle;
		const titleStr = cTitle(statusTitle);
		const rawTitle = statusTitle;
		const fillTop = Math.max(0, safeWidth - 4 - visibleWidth(rawTitle) - 1);
		const top = `${frameFg(theme, `${g.tl}${g.h} `)}${titleStr}${frameFg(theme, ` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frameFg(theme, `${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const rawCwd = this.ctx.cwd ?? process.cwd();
		const shortCwd = formatCwd(rawCwd);

		const branch = this.footerData.getGitBranch() || "no-git";
		const cardBranchGlyph = cuteGlyphs(theme).branch;
		const dirtyBadge = this.dirtyCount && this.dirtyCount > 0 ? ` ${cWarning(`±${this.dirtyCount}`)}` : "";

		const rawModel = this.ctx.model?.id ?? "no-model";
		const displayModel = shortModelName(rawModel);
		const thinking = this.pi.getThinkingLevel();
		const thinkingStr = thinking && thinking !== "off" ? ` ${cLabel(`(${thinking})`)}` : "";

		const usage = this.ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		const percentStr = percent !== null ? `${Math.round(percent)}%` : "?%";
		const gauge = renderGauge(theme, percent);
		const cost = formatCost(sessionCost(this.ctx));

		const extraStatuses: string[] = [];
		try {
			const statusesMap = this.footerData.getExtensionStatuses?.();
			if (statusesMap) {
				for (const [, text] of statusesMap) {
					if (text && text.trim().length > 0) extraStatuses.push(prettifyExtraStatus(text, this.theme));
				}
			}
		} catch {}

		const lines: string[] = [
			top,
			boxLine(cLabel("Project"), cText(shortCwd)),
			boxLine(cLabel("Branch"), `${cText(`${cardBranchGlyph} ${branch}`)}${dirtyBadge}`),
			boxLine(cLabel("Model"), `${cAccent(displayModel)}${thinkingStr}`),
			boxLine(cLabel("Context"), `${gauge} ${cText(percentStr)}`),
			boxLine(cLabel("Cost"), cText(cost)),
		];

		if (extraStatuses.length > 0) {
			lines.push(frameFg(theme, `${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));
			for (const status of extraStatuses.slice(0, loadCuteLayout().footer.extraMax)) {
				lines.push(boxLine(cMuted(status)));
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
		tuneTuiScroll(tui);
		const bottom = new CinlodevCuteFooter(pi, ctx, tui, theme, footerData);
		const todos = new CinlodevTodoMirror(ctx, tui, theme);
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
		const uninstall = installSidebar(tui, theme);
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
