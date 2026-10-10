import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, safeFg, bolden } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { loadCuteLayout } from "../cute-layout.ts";
import { readGitBranch } from "../cute-paths.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	type GitStatusCounts,
	fetchGitLogGraph,
	resetGitGraphCache,
	fetchGitStatus,
	resetGitStatusCache,
	fetchGitBranches,
	resetGitBranchesCache,
	resetBranchDiffCache,
	resetGitFileChangesCache,
} from "./git-cli.ts";
import {
	getGitTabViewMode,
	setGitTabViewMode,
	getGitTabSelectedBranch,
	setGitTabSelectedBranch,
} from "./git-state.ts";
import {
	colorizeGitGraphLine,
	formatGitStatusBadges,
} from "./git-styles.ts";

const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

/**
 * Interactive Git Graph card for the Cinlodev CUTE sidebar rail.
 * - Shows an interactive Dracula-styled git graph or branches list in the rail.
 * - Supports [ Grafo | Ramas ] view switching and branch selection for diff inspection.
 * - Full-height fixed alignment and mouse wheel internal scrolling.
 */
export class CinlodevGitGraphCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private expanded: boolean;
	private scrollOffset = 0;
	private lastMaxScrollOffset = 0;
	private hitboxGraph?: { start: number; end: number };
	private hitboxBranches?: { start: number; end: number };
	private branchHitboxes: Array<{ lineIndex: number; branch: string }> = [];

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui ?? ({ requestRender: () => {} } as any);
		this.theme = theme;
		const cfg = loadCuteLayout().gitGraph;
		this.expanded = cfg.defaultExpanded ?? true;
	}

	isExpanded(): boolean {
		return this.expanded;
	}

	toggleExpanded(): void {
		this.expanded = !this.expanded;
		this.tui.requestRender();
	}

	setExpanded(expanded: boolean): void {
		if (this.expanded !== expanded) {
			this.expanded = expanded;
			this.tui.requestRender();
		}
	}

	private getChangesRow(status: GitStatusCounts, innerWidth: number): string | undefined {
		try {
			const terminal = this.tui?.terminal as unknown as Record<symbol, any> | undefined;
			const state = terminal?.[SIDEBAR_STATE];
			const changesComp = state?.parts?.get("changes");
			if (changesComp && typeof changesComp.render === "function") {
				const rendered = changesComp.render(innerWidth);
				if (Array.isArray(rendered) && rendered.length > 0) {
					const first = rendered[0].trim();
					if (first) return first;
				}
			}
		} catch {}

		if (status.linesAdded > 0 || status.linesDeleted > 0) {
			const theme = this.theme;
			const pen = theme ? safeFg(theme, "accent", "✎", "pink") : "✎";
			const addStr = theme ? safeFg(theme, "mint", `+${status.linesAdded}`, "green") : `+${status.linesAdded}`;
			const delStr = theme ? safeFg(theme, "red", `−${status.linesDeleted}`, "red") : `−${status.linesDeleted}`;
			const fileCount = status.modified + status.staged;
			const noun = fileCount === 1 ? "file" : "files";
			return `${pen} ${fileCount} ${noun} · ${addStr} ${delStr}`;
		}

		return undefined;
	}

	handleClick(_localIndex?: number): boolean {
		this.toggleExpanded();
		return true;
	}

	handleRailWheel(wheelDelta: number): boolean {
		if (wheelDelta !== 0) {
			const step = wheelDelta > 0 ? 2 : -2;
			if (this.lastMaxScrollOffset > 0) {
				const next = Math.max(0, Math.min(this.lastMaxScrollOffset, this.scrollOffset + step));
				if (next !== this.scrollOffset) {
					this.scrollOffset = next;
					this.tui?.requestRender();
					return true;
				}
				return true;
			}
		}
		return false;
	}

	handleRailClick(lineIndex: number, _button?: string, localX?: number): boolean {
		if (lineIndex === 0 && typeof localX === "number") {
			if (this.hitboxGraph && localX >= this.hitboxGraph.start && localX <= this.hitboxGraph.end) {
				setGitTabViewMode("graph", this.tui);
				this.scrollOffset = 0;
				return true;
			}
			if (this.hitboxBranches && localX >= this.hitboxBranches.start && localX <= this.hitboxBranches.end) {
				setGitTabViewMode("branches", this.tui);
				this.scrollOffset = 0;
				return true;
			}
		}

		const viewMode = getGitTabViewMode();
		if (viewMode === "branches") {
			const hit = this.branchHitboxes.find((h) => h.lineIndex === lineIndex);
			if (hit) {
				const cwd = this.ctx?.cwd ?? process.cwd();
				const current = readGitBranch(cwd);
				if (hit.branch === current || hit.branch === getGitTabSelectedBranch()) {
					setGitTabSelectedBranch(null, this.tui);
				} else {
					setGitTabSelectedBranch(hit.branch, this.tui);
				}
				return true;
			}
		}

		this.handleClick(lineIndex);
		return true;
	}

	invalidate(): void {
		resetGitGraphCache();
		resetGitStatusCache();
		resetGitBranchesCache();
		resetBranchDiffCache();
		resetGitFileChangesCache();
	}

	render(width: number, availableHeight?: number): string[] {
		const cfg = loadCuteLayout().gitGraph;
		if (!cfg.enabled) return [];

		const cwd = this.ctx?.cwd ?? process.cwd();
		const rawLines = fetchGitLogGraph(cwd, 30, cfg.ttlMs);
		if (!rawLines.length) return [];

		const safeWidth = Math.max(cfg.minWidth, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║
		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const c = {
			pink: (s: string): string => (theme ? safeFg(theme, "accent", s, "pink") : s),
			gold: (s: string): string => (theme ? safeFg(theme, "heading", s, "yellow") : s),
			mint: (s: string): string => (theme ? safeFg(theme, "mint", s, "green") : s),
			coral: (s: string): string => (theme ? safeFg(theme, "red", s, "red") : s),
			yellow: (s: string): string => (theme ? safeFg(theme, "warning", s, "yellow") : s),
			cyan: (s: string): string => (theme ? safeFg(theme, "write", s, "cyan") : s),
			magenta: (s: string): string => (theme ? safeFg(theme, "secondary", s, "magenta") : s),
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

		const branch = readGitBranch(cwd);
		const branchGlyph = g.branch || "";
		const status = fetchGitStatus(cwd, cfg.ttlMs);
		const statusBadge = formatGitStatusBadges(status, theme);
		const viewMode = getGitTabViewMode();

		// 1. Collapsed mode: single line summary with branch and status badge
		if (!this.expanded) {
			const titleText = `${branchGlyph} git`;
			const styledTitle = `${c.pink(branchGlyph)} ${c.gold("git")}`;
			const fillTop = Math.max(0, safeWidth - 4 - calcVisibleWidth(titleText) - 1);
			const top = `${frame(`${g.tl}${g.h} `)}${styledTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
			const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

			const firstLine = rawLines[0] ?? "";
			const commitMatch = /^[*\\/|_\s]*([0-9a-f]{7,40})(?:\s*\([^)]*\))?\s*(.*)$/.exec(firstLine);
			const hash = commitMatch ? commitMatch[1] : "";
			const subject = commitMatch ? commitMatch[2] : "";
			const commitText = hash ? (subject ? `${hash} ${subject}` : hash) : "latest";

			const summaryLeft = `${branch} · ${commitText}`;
			return [top, boxLine(summaryLeft, statusBadge), bottom];
		}

		// 2. Expanded mode: Header calculation with [ Grafo | Ramas ] view toggle
		const gLabel = "Grafo";
		const bLabel = "Ramas";
		const useCompactToggle = safeWidth < 38;
		const toggleRaw = useCompactToggle ? "[ G | R ]" : `[ ${gLabel} | ${bLabel} ]`;
		const toggleLen = calcVisibleWidth(toggleRaw);

		const gStyled = viewMode === "graph"
			? (useCompactToggle ? c.pink("G") : c.pink(bolden(theme, gLabel)))
			: (useCompactToggle ? c.dim("G") : c.dim(gLabel));
		const bStyled = viewMode === "branches"
			? (useCompactToggle ? c.pink("R") : c.pink(bolden(theme, bLabel)))
			: (useCompactToggle ? c.dim("R") : c.dim(bLabel));
		const toggleStyled = `${c.dim("[")} ${gStyled} ${c.dim("|")} ${bStyled} ${c.dim("]")}`;

		const fixedOverhead = 8 + toggleLen;
		const availableForTitle = Math.max(0, safeWidth - fixedOverhead);
		const fullTitleText = "git graph";
		const maxTitleLen = Math.max(4, availableForTitle - 2);
		const displayTitle = calcVisibleWidth(fullTitleText) > maxTitleLen ? truncateAnsiAware(fullTitleText, maxTitleLen) : fullTitleText;
		const titleStyled = `${c.pink(branchGlyph)} ${c.gold(displayTitle)}`;
		const titleRawLen = calcVisibleWidth(`${branchGlyph} ${displayTitle}`);

		const fillLen = Math.max(0, safeWidth - (3 + titleRawLen + 2 + toggleLen + 3));
		const top = `${frame(`${g.tl}${g.h} `)}${titleStyled}${frame(` ${g.h.repeat(fillLen)} `)}${toggleStyled}${frame(` ${g.h}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const toggleStart = safeWidth - 3 - toggleLen;
		const splitOffset = useCompactToggle ? 4 : 2 + calcVisibleWidth(gLabel) + 1;
		this.hitboxGraph = { start: toggleStart, end: toggleStart + splitOffset };
		this.hitboxBranches = { start: toggleStart + splitOffset + 1, end: safeWidth - 3 };
		this.branchHitboxes = [];

		const isFixed = typeof availableHeight === "number" && availableHeight > 5;
		const targetCardLines = isFixed ? availableHeight : undefined;
		const contentCapacity = isFixed ? Math.max(1, targetCardLines! - 2) : 9999;

		// 2.1 BRANCHES VIEW
		if (viewMode === "branches") {
			const branches = fetchGitBranches(cwd, 3000);
			const selectedBranch = getGitTabSelectedBranch();
			const allRows: Array<{ line: string; right: string; branch?: string }> = [];

			const headerCount = `${c.yellow(`● ${branches.length}`)} ${c.dim("ramas en repo")}`;
			allRows.push({ line: headerCount, right: statusBadge });

			for (const b of branches) {
				const isSelected = selectedBranch === b.name;
				let prefixIcon = b.isCurrent ? c.mint("") : (isSelected ? c.pink("▶") : c.dim("●"));
				let nameColor = b.isCurrent ? c.mint : (isSelected ? c.pink : (b.isRemote ? c.magenta : c.cyan));
				let displayName = b.name;
				if (b.isRemote) {
					displayName = b.name.replace(/^origin\//, "rem/");
				}

				const rightParts: string[] = [];
				if (b.isCurrent) {
					rightParts.push(c.mint("actual"));
				} else if (isSelected) {
					rightParts.push(c.pink("diff"));
				} else {
					if (b.ahead && b.ahead > 0) rightParts.push(c.yellow(`↑${b.ahead}`));
					if (b.behind && b.behind > 0) rightParts.push(c.coral(`↓${b.behind}`));
					if (b.gone) rightParts.push(c.coral("gone"));
					if (b.relativeDate && rightParts.length === 0) {
						rightParts.push(c.dim(b.relativeDate));
					}
				}
				const rightStr = rightParts.join(" ");
				const lineStr = `${prefixIcon} ${nameColor(displayName)}`;
				allRows.push({ line: lineStr, right: rightStr, branch: b.name });
			}

			const hasOverflow = isFixed && allRows.length > contentCapacity;
			const maxVisibleRows = hasOverflow ? Math.max(1, contentCapacity - 1) : Math.min(allRows.length, contentCapacity);
			const maxOffset = Math.max(0, allRows.length - maxVisibleRows);
			this.lastMaxScrollOffset = maxOffset;
			if (this.scrollOffset > maxOffset) {
				this.scrollOffset = maxOffset;
			}

			const visibleRows = isFixed
				? allRows.slice(this.scrollOffset, this.scrollOffset + maxVisibleRows)
				: allRows;
			const lines: string[] = [top];

			for (let i = 0; i < visibleRows.length; i++) {
				const row = visibleRows[i];
				const currentIdx = lines.length;
				lines.push(boxLine(row.line, row.right));
				if (row.branch) {
					this.branchHitboxes.push({ lineIndex: currentIdx, branch: row.branch });
				}
			}

			if (hasOverflow) {
				const remaining = Math.max(0, allRows.length - (this.scrollOffset + maxVisibleRows));
				const scrollIndicator = `${c.dim("[")} ${this.scrollOffset > 0 ? c.pink("▲") : c.dim("▲")} ${c.dim(`${this.scrollOffset + 1}..${this.scrollOffset + visibleRows.length}/${allRows.length}`)} ${remaining > 0 ? c.pink("▼") : c.dim("▼")} ${c.dim("]")}`;
				lines.push(boxLine(c.dim("ruedita para scroll"), scrollIndicator));
			}

			if (isFixed && targetCardLines) {
				while (lines.length < targetCardLines - 1) {
					lines.push(boxLine(""));
				}
			}

			lines.push(bottom);
			return lines;
		}

		// 2.2 GRAPH VIEW
		const allRows: string[] = [];

		// Spacing between top border and branch row
		allRows.push(boxLine(""));

		// Live branch and status badge row
		allRows.push(boxLine(branch, statusBadge));

		// Spacing between branch row and git graph tree
		allRows.push(boxLine(""));

		for (const line of rawLines) {
			const colorized = colorizeGitGraphLine(line, theme);
			allRows.push(boxLine(colorized));
		}

		const changesRow = this.getChangesRow(status, innerWidth);
		if (changesRow) {
			allRows.push(boxLine(""));
			allRows.push(boxLine(changesRow));
		}

		const hasOverflow = isFixed && allRows.length > contentCapacity;
		const maxVisibleRows = hasOverflow ? Math.max(1, contentCapacity - 1) : Math.min(allRows.length, contentCapacity);
		const maxOffset = Math.max(0, allRows.length - maxVisibleRows);
		this.lastMaxScrollOffset = maxOffset;
		if (this.scrollOffset > maxOffset) {
			this.scrollOffset = maxOffset;
		}

		const visibleRows = isFixed
			? allRows.slice(this.scrollOffset, this.scrollOffset + maxVisibleRows)
			: allRows;
		const lines: string[] = [top];
		for (const row of visibleRows) {
			lines.push(row);
		}

		if (hasOverflow) {
			const remaining = Math.max(0, allRows.length - (this.scrollOffset + maxVisibleRows));
			const scrollIndicator = `${c.dim("[")} ${this.scrollOffset > 0 ? c.pink("▲") : c.dim("▲")} ${c.dim(`${this.scrollOffset + 1}..${this.scrollOffset + visibleRows.length}/${allRows.length}`)} ${remaining > 0 ? c.pink("▼") : c.dim("▼")} ${c.dim("]")}`;
			lines.push(boxLine(c.dim("ruedita para scroll"), scrollIndicator));
		}

		if (isFixed && targetCardLines) {
			while (lines.length < targetCardLines - 1) {
				lines.push(boxLine(""));
			}
		}

		lines.push(bottom);
		return lines;
	}
}
