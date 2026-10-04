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
import { cuteGlyphs, cutePalette, frameFg, type CutePalette } from "./cute-theme.ts";
import { CinlodevTodoMirror } from "./todos.ts";
import { CinlodevGitGraphCard, CinlodevWorkingTreeCard } from "./cute-git-graph.ts";
import { CinlodevToolsCard } from "./cute-tools.ts";
import { CinlodevUsageCard } from "./cute-usage.ts";
import { CinlodevEngramCard, CinlodevEngramHandoffCard } from "./cute-engram.ts";
import { formatProfileDisplay, loadCuteStrings, matchBracketProfile } from "./cute-strings.ts";
import { loadCuteLayout, tuneTuiScroll } from "./cute-layout.ts";
import { formatCwd, quoteGitCwd } from "./cute-paths.ts";
import { formatTokenCount, getContextThreshold } from "./cute-metrics.ts";
import { listAvailableProfiles, switchProfile, type ProfileItem, CinlodevProfilesExtendedCard } from "./cute-profiles.ts";
import { CinlodevAgentsCard } from "./cute-agents.ts";

export { formatTokenCount, getContextThreshold };

const execAsync = promisify(exec);

// Cinlodev CUTE colors come from themes/CinlodevCute.json via cutePalette()
// (border, pinkBright, accent, heading, warning, text, muted, dim). No hardcodes.

let todoHooksInstalled = false;
let latestTodoTui: TUI | undefined;
let latestGitGraph: CinlodevGitGraphCard | undefined;
let latestWorkingTree: CinlodevWorkingTreeCard | undefined;
let latestToolsCard: CinlodevToolsCard | undefined;
let latestUsageCard: CinlodevUsageCard | undefined;
let latestEngramCard: CinlodevEngramCard | undefined;
let latestEngramHandoff: CinlodevEngramHandoffCard | undefined;
let latestAgentsCard: CinlodevAgentsCard | undefined;

export function toggleUsageCard(): boolean {
	return latestUsageCard?.toggle() ?? false;
}

export function isUsageCardVisible(): boolean {
	return latestUsageCard?.isVisible() ?? false;
}

export function getLatestUsageCard(): CinlodevUsageCard | undefined {
	return latestUsageCard;
}

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

	const threshold = getContextThreshold(clamped, c);
	const filledStr = threshold.color(gauge.filled.repeat(filledCount));
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
	private isProfileExpanded = false;
	private clickTargets: Array<{ lineIndex: number; action: () => void | Promise<void> }> = [];

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

		const cost = formatCost(sessionCost(this.ctx));

		this.clickTargets = [];
		const availableProfiles = listAvailableProfiles(this.ctx.cwd);
		const activeProfileFromList = availableProfiles.find((p) => p.active);

		let profileStatusRaw: string | null = null;
		const otherStatuses: string[] = [];
		try {
			const statusesMap = this.footerData.getExtensionStatuses?.();
			if (statusesMap) {
				for (const [key, text] of statusesMap) {
					if (!text || text.trim().length === 0) continue;
					const pretty = prettifyExtraStatus(text, this.theme);
					if (
						key === "sdd-profile" ||
						text.includes("🤖") ||
						matchBracketProfile(text) !== null
					) {
						profileStatusRaw = pretty;
					} else {
						otherStatuses.push(pretty);
					}
				}
			}
		} catch {}

		const hasProfiles = availableProfiles.length > 0 || profileStatusRaw !== null;
		const activeName =
			activeProfileFromList?.name ||
			(profileStatusRaw ? profileStatusRaw.replace(/^[🤖\s]+/, "").trim() : "default");

		const lines: string[] = [
			top,
			boxLine(cLabel("Project"), cText(shortCwd)),
			boxLine(cLabel("Branch"), `${cText(`${cardBranchGlyph} ${branch}`)}${dirtyBadge}`),
			boxLine(cLabel("Model"), `${cAccent(displayModel)}${thinkingStr}`),
		];

		if (otherStatuses.length > 0 || hasProfiles) {
			lines.push(frameFg(theme, `${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));
			for (const status of otherStatuses.slice(0, loadCuteLayout().footer.extraMax)) {
				lines.push(boxLine(cMuted(status)));
			}

			if (hasProfiles) {
				const arrow = this.isProfileExpanded ? "▾" : "▸";
				const profileGlyph = cuteGlyphs(theme).profileIcon || "🤖";
				const profileHeaderLeft = `${profileGlyph} ${cMuted(activeName)}`;
				const profileHeaderRight = cAccent(arrow);

				this.clickTargets.push({
					lineIndex: lines.length,
					action: () => {
						this.isProfileExpanded = !this.isProfileExpanded;
						this.tui.requestRender();
					},
				});
				lines.push(boxLine(profileHeaderLeft, profileHeaderRight));

				if (this.isProfileExpanded && availableProfiles.length > 0) {
					for (const p of availableProfiles) {
						this.clickTargets.push({
							lineIndex: lines.length,
							action: async () => {
								await this.selectProfile(p.name);
							},
						});

						if (p.active) {
							lines.push(boxLine(cAccent(`  ● ${p.name}`), cAccent("(activo)")));
						} else {
							lines.push(boxLine(cMuted(`  ○ ${p.name}`)));
						}
					}
				}
			}
		}

		lines.push(bottom);
		return lines;
	}

	isProfileDropdownOpen(): boolean {
		return this.isProfileExpanded;
	}

	closeProfileDropdown(): void {
		if (this.isProfileExpanded) {
			this.isProfileExpanded = false;
			this.tui.requestRender();
		}
	}

	private async selectProfile(name: string): Promise<void> {
		this.isProfileExpanded = false;
		await switchProfile(name, this.ctx, this.pi, this.ctx.cwd);
		this.tui.requestRender();
	}

	handleCardClick(localLineIndex: number): boolean {
		const target = this.clickTargets.find((t) => t.lineIndex === localLineIndex);
		if (target) {
			const res = target.action();
			if (res && typeof (res as any).then === "function") {
				(res as Promise<void>).then(() => {
					this.tui.requestRender();
				});
			}
			return true;
		}
		return false;
	}

	invalidate(): void {}

	dispose(): void {
		if (this.unsubscribeBranch) {
			this.unsubscribeBranch();
			this.unsubscribeBranch = undefined;
		}
	}
}

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
		// The active token count is rendered bold in the threshold color (mint -> gold -> orange -> coral)
		// so it grows and changes visually alongside the gauge bar.
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

export function installCinlodevFooter(ctx: ExtensionContext, pi: ExtensionAPI): void {
	if (!ctx.hasUI) return;
	if (!todoHooksInstalled) {
		todoHooksInstalled = true;
		const refreshTodos = () => {
			try {
				latestGitGraph?.invalidate();
				latestWorkingTree?.invalidate();
				latestToolsCard?.invalidate();
				latestUsageCard?.invalidate();
				latestEngramCard?.invalidate();
				latestEngramHandoff?.invalidate();
				latestAgentsCard?.invalidate();
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
		const contextCard = new CinlodevCuteContextCard(ctx, theme);
		const engramCard = new CinlodevEngramCard(ctx, tui, theme);
		const engramHandoff = new CinlodevEngramHandoffCard(ctx, tui, theme);
		const usageCard = new CinlodevUsageCard(ctx, tui, theme);
		const agentsCard = new CinlodevAgentsCard(ctx, tui, theme, pi);
		const gitGraph = new CinlodevGitGraphCard(ctx, tui, theme);
		const workingTree = new CinlodevWorkingTreeCard(ctx, tui, theme);
		const toolsCard = new CinlodevToolsCard(ctx, tui, theme);
		const todos = new CinlodevTodoMirror(ctx, tui, theme);
		latestTodoTui = tui;
		latestGitGraph = gitGraph;
		latestWorkingTree = workingTree;
		latestToolsCard = toolsCard;
		latestUsageCard = usageCard;
		latestEngramCard = engramCard;
		latestEngramHandoff = engramHandoff;
		latestAgentsCard = agentsCard;
		const rail = {
			render: (width: number) => bottom.renderSidebarCard(width),
			invalidate: () => bottom.invalidate(),
			handleRailClick: (lineIndex: number) => bottom.handleCardClick(lineIndex),
			isProfileDropdownOpen: () => bottom.isProfileDropdownOpen(),
			closeProfileDropdown: () => bottom.closeProfileDropdown(),
		};
		const contextRail = {
			render: (width: number) => contextCard.render(width),
			invalidate: () => contextCard.invalidate(),
		};
		const engramRail = {
			render: (width: number) => engramCard.render(width),
			invalidate: () => engramCard.invalidate(),
			handleRailClick: (lineIndex: number) => engramCard.handleClick(lineIndex),
		};
		const usageRail = {
			render: (width: number) => usageCard.render(width),
			invalidate: () => usageCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string) => usageCard.handleClick(lineIndex, button),
			handleRailWheel: (delta: number) => usageCard.handleWheel(delta),
		};
		const gitGraphRail = {
			render: (width: number) => gitGraph.render(width),
			invalidate: () => gitGraph.invalidate(),
			handleRailClick: (lineIndex: number) => gitGraph.handleClick(lineIndex),
		};
		const workingTreeRail = {
			render: (width: number) => workingTree.render(width),
			invalidate: () => workingTree.invalidate(),
			handleRailClick: (lineIndex: number) => workingTree.handleClick(lineIndex),
		};
		const engramHandoffRail = {
			render: (width: number) => engramHandoff.render(width),
			invalidate: () => engramHandoff.invalidate(),
			handleRailClick: () => engramHandoff.handleClick(),
		};
		const toolsRail = {
			render: (width: number) => toolsCard.render(width),
			invalidate: () => toolsCard.invalidate(),
		};
		const agentsRail = {
			render: (width: number) => agentsCard.render(width),
			invalidate: () => agentsCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				agentsCard.handleClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => agentsCard.handleWheel(delta),
		};
		const profilesCard = new CinlodevProfilesExtendedCard(tui, theme, undefined, ctx, pi);
		const profilesRail = {
			render: (width: number) => profilesCard.render(width),
			invalidate: () => profilesCard.invalidate?.(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				profilesCard.handleRailClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => profilesCard.handleRailWheel(delta),
		};
		const part = sidebarPart(tui, "footer", bottom, rail);
		const contextPart = sidebarPart(tui, "context", { render: () => [] }, contextRail);
		const engramPart = sidebarPart(tui, "engram", { render: () => [] }, engramRail);
		const engramHandoffPart = sidebarPart(tui, "engramHandoff", { render: () => [] }, engramHandoffRail);
		const usagePart = sidebarPart(tui, "usage", { render: () => [] }, usageRail);
		const agentsPart = sidebarPart(tui, "cute-agents", { render: () => [] }, agentsRail);
		const gitGraphPart = sidebarPart(tui, "gitGraph", { render: () => [] }, gitGraphRail);
		const workingTreePart = sidebarPart(tui, "workingTree", { render: () => [] }, workingTreeRail);
		const toolsPart = sidebarPart(tui, "tools", { render: () => [] }, toolsRail);
		const profilesPart = sidebarPart(tui, "cute-profiles", { render: () => [] }, profilesRail);
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
				contextPart.dispose?.();
				engramPart.dispose?.();
				usagePart.dispose?.();
				agentsPart.dispose?.();
				gitGraphPart.dispose?.();
				workingTreePart.dispose?.();
				engramHandoffPart.dispose?.();
				toolsPart.dispose?.();
				profilesPart.dispose?.();
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
