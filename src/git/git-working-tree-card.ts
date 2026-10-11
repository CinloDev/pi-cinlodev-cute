import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, safeFg } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import { launchEditor } from "../cute-tree.ts";
import {
	fetchGitFileChanges,
	resetGitFileChangesCache,
	fetchGitStatus,
	resetGitStatusCache,
	fetchBranchDiff,
	resetBranchDiffCache,
} from "./git-cli.ts";
import { getGitTabSelectedBranch, setGitTabSelectedBranch } from "./git-state.ts";
import { formatFilePathWithDracula } from "./git-styles.ts";
import { launchGitDiff, launchFileDiff } from "./git-launchers.ts";

/**
 * Sidebar Working Tree / Branch Diff Card for pi-cinlodev-cute.
 * Displays dirty working tree files or active Branch Diff comparison in the GIT tab.
 * Supports full-height 50/50 alignment, internal scrolling, and diff viewer launching.
 */
export class CinlodevWorkingTreeCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private expanded = true;
	private scrollOffset = 0;
	private lastMaxScrollOffset = 0;
	private hitboxClose?: { start: number; end: number };
	private hitboxOpen?: { start: number; end: number };
	private fileHitboxes: Array<{ lineIndex: number; filePath: string; diffStartX: number }> = [];

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui ?? ({ requestRender: () => {} } as any);
		this.theme = theme;
	}

	toggleExpanded(): boolean {
		this.expanded = !this.expanded;
		this.tui.requestRender();
		return this.expanded;
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

	handleRailClick(lineIndex: number, button?: string, localX?: number): boolean {
		const selectedBranch = getGitTabSelectedBranch();
		if (selectedBranch) {
			if (lineIndex === 0 && typeof localX === "number") {
				if (this.hitboxClose && localX >= this.hitboxClose.start && localX <= this.hitboxClose.end) {
					setGitTabSelectedBranch(null, this.tui);
					this.scrollOffset = 0;
					this.lastMaxScrollOffset = 0;
					return true;
				}
				if (this.hitboxOpen && localX >= this.hitboxOpen.start && localX <= this.hitboxOpen.end) {
					const cwd = this.ctx?.cwd ?? process.cwd();
					launchGitDiff(selectedBranch, cwd);
					return true;
				}
			}
			const hit = this.fileHitboxes.find((h) => h.lineIndex === lineIndex);
			if (hit) {
				const cwd = this.ctx?.cwd ?? process.cwd();
				const isDiff = button === "right" || (typeof localX === "number" && localX >= hit.diffStartX);
				if (isDiff) {
					launchFileDiff(hit.filePath, selectedBranch, cwd);
				} else {
					launchEditor(hit.filePath, cwd);
				}
				return true;
			}
			return true;
		}

		if (lineIndex > 0) {
			const hit = this.fileHitboxes.find((h) => h.lineIndex === lineIndex);
			if (hit) {
				const cwd = this.ctx?.cwd ?? process.cwd();
				const isDiff = button === "right" || (typeof localX === "number" && localX >= hit.diffStartX);
				if (isDiff) {
					launchFileDiff(hit.filePath, null, cwd);
				} else {
					launchEditor(hit.filePath, cwd);
				}
				return true;
			}
		}

		return this.handleClick(lineIndex);
	}

	invalidate(): void {
		resetGitStatusCache();
		resetBranchDiffCache();
		resetGitFileChangesCache();
	}

	render(width: number, availableHeight?: number): string[] {
		const cwd = this.ctx?.cwd ?? process.cwd();
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;
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

		const isFixed = typeof availableHeight === "number" && availableHeight > 5;
		const targetCardLines = isFixed ? availableHeight : undefined;
		const contentCapacity = isFixed ? Math.max(1, targetCardLines! - 2) : 9999;

		const selectedBranch = getGitTabSelectedBranch();

		// 1. BRANCH DIFF INSPECTOR MODE
		if (selectedBranch) {
			const diff = fetchBranchDiff(cwd, selectedBranch, 3000);
			const closeRaw = "[ ✕ ]";
			const openRaw = "[ ↗ ]";
			const actionsRaw = `${closeRaw} ${openRaw}`;
			const actionsLen = calcVisibleWidth(actionsRaw);

			const closeStyled = `${c.dim("[")} ${c.coral("✕")} ${c.dim("]")}`;
			const openStyled = `${c.dim("[")} ${c.pink("↗")} ${c.dim("]")}`;
			const actionsStyled = `${closeStyled} ${openStyled}`;

			const fixedOverhead = 8 + actionsLen;
			const availableForTitle = Math.max(0, safeWidth - fixedOverhead);
			const folderIcon = "📁";
			const diffPrefix = `${folderIcon} Diff · `;
			const maxBranchLen = Math.max(4, availableForTitle - calcVisibleWidth(diffPrefix));
			const displayBranch = truncateAnsiAware(selectedBranch, maxBranchLen);
			const titleStyled = `${c.pink(folderIcon)} ${c.gold("Diff")} ${c.dim("·")} ${c.cyan(displayBranch)}`;
			const titleRawLen = calcVisibleWidth(`${folderIcon} Diff · ${displayBranch}`);

			const fillLen = Math.max(0, safeWidth - (3 + titleRawLen + 2 + actionsLen + 3));
			const top = `${frame(`${g.tl}${g.h} `)}${titleStyled}${frame(` ${g.h.repeat(fillLen)} `)}${actionsStyled}${frame(` ${g.h}${g.tr}`)}`;
			const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

			const actionsStart = safeWidth - 3 - actionsLen;
			this.hitboxClose = { start: actionsStart, end: actionsStart + 5 };
			this.hitboxOpen = { start: actionsStart + 6, end: safeWidth - 3 };
			this.fileHitboxes = [];

			const allRows: Array<{ line: string; right: string; isDivider?: boolean; filePath?: string }> = [];
			const summaryBadge = `${c.yellow(`● ${diff.files.length}`)} ${c.dim(diff.files.length === 1 ? "archivo" : "archivos")}`;
			const deltasTotal =
				diff.totalAdded > 0 || diff.totalDeleted > 0
					? `${c.mint(`+${diff.totalAdded}`)}  ${c.coral(`−${diff.totalDeleted}`)}`
					: "";
			allRows.push({ line: summaryBadge, right: deltasTotal });
			if (diff.files.length > 0) {
				allRows.push({ line: c.dim("click: nvim · [diff]: ver diff"), right: "" });
			}
			allRows.push({ line: "", right: "", isDivider: true });

			if (diff.files.length === 0) {
				allRows.push({ line: `✔ ${c.mint("Sin diferencias con HEAD")}`, right: "" });
			} else {
				for (const f of diff.files) {
					let badge = c.yellow("M");
					if (f.status === "added") badge = c.mint("A");
					else if (f.status === "deleted") badge = c.coral("D");
					else if (f.status === "renamed") badge = c.cyan("R");

					const diffBtn = `${c.dim("[")}${c.pink("diff")}${c.dim("]")}`;
					const rightParts: string[] = [diffBtn];
					if (f.linesAdded > 0) rightParts.push(c.mint(`+${f.linesAdded}`));
					if (f.linesDeleted > 0) rightParts.push(c.coral(`−${f.linesDeleted}`));
					const rightStr = rightParts.join(" ");

					const styledPath = formatFilePathWithDracula(f.path, c);
					allRows.push({ line: `${badge}  ${styledPath}`, right: rightStr, filePath: f.path });
				}
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
			for (const r of visibleRows) {
				if (r.isDivider) {
					lines.push(frame(`${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));
				} else {
					const currentIdx = lines.length;
					lines.push(boxLine(r.line, r.right));
					if (r.filePath) {
						const rightWidth = calcVisibleWidth(r.right);
						const diffStartX = Math.max(0, safeWidth - 2 - rightWidth - 1);
						this.fileHitboxes.push({ lineIndex: currentIdx, filePath: r.filePath, diffStartX });
					}
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

		// 2. WORKING TREE MODE
		const files = fetchGitFileChanges(cwd);
		const status = fetchGitStatus(cwd, 3000);

		const arrow = this.expanded ? "▲" : "▼";
		const titleStr = `${c.pink("📁")} ${c.gold("Working Tree")} ${c.dim(arrow)}`;
		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(titleStr) > maxTitleLen ? truncateAnsiAware(titleStr, maxTitleLen) : titleStr;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		if (files.length === 0) {
			const cleanMsg = `✔ ${c.mint("Clean")} · ${c.dim("Sin cambios pendientes")}`;
			if (isFixed && targetCardLines) {
				const lines = [top, boxLine(cleanMsg)];
				while (lines.length < targetCardLines - 1) {
					lines.push(boxLine(""));
				}
				lines.push(bottom);
				return lines;
			}
			return [top, boxLine(cleanMsg), bottom];
		}

		if (!this.expanded) {
			const modCount = files.length;
			const summary = `${c.yellow(`● ${modCount}`)} ${c.dim(modCount === 1 ? "archivo" : "archivos")}`;
			const deltas =
				status.linesAdded > 0 || status.linesDeleted > 0
					? `${c.mint(`+${status.linesAdded}`)} ${c.coral(`−${status.linesDeleted}`)}`
					: "";
			const lines = [top, boxLine(summary, deltas)];
			if (isFixed && targetCardLines) {
				while (lines.length < targetCardLines - 1) {
					lines.push(boxLine(""));
				}
			}
			lines.push(bottom);
			return lines;
		}

		const allRows: Array<{ line: string; right: string; isDivider?: boolean; filePath?: string }> = [];
		this.fileHitboxes = [];
		const summaryBadge = `${c.yellow(`● ${files.length}`)} ${c.dim(files.length === 1 ? "archivo modificado" : "archivos modificados")}`;
		const deltasTotal =
			status.linesAdded > 0 || status.linesDeleted > 0
				? `${c.mint(`+${status.linesAdded}`)}  ${c.coral(`−${status.linesDeleted}`)}`
				: "";
		allRows.push({ line: summaryBadge, right: deltasTotal });
		if (files.length > 0) {
			allRows.push({ line: c.dim("click: nvim · [diff]: ver diff"), right: "" });
		}
		allRows.push({ line: "", right: "", isDivider: true });

		for (const f of files) {
			let badge = c.yellow("M");
			if (f.status === "added") badge = c.mint("A");
			else if (f.status === "deleted") badge = c.coral("D");
			else if (f.status === "untracked") badge = c.pink("?");
			else if (f.status === "conflict") badge = c.coral("U");

			const diffBtn = `${c.dim("[")}${c.pink("diff")}${c.dim("]")}`;
			const rightParts: string[] = [diffBtn];
			if (f.linesAdded > 0) rightParts.push(c.mint(`+${f.linesAdded}`));
			if (f.linesDeleted > 0) rightParts.push(c.coral(`−${f.linesDeleted}`));
			const rightStr = rightParts.join(" ");

			const styledPath = formatFilePathWithDracula(f.path, c);
			allRows.push({ line: `${badge}  ${styledPath}`, right: rightStr, filePath: f.path });
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
		for (const r of visibleRows) {
			if (r.isDivider) {
				lines.push(frame(`${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));
			} else {
				const currentIdx = lines.length;
				lines.push(boxLine(r.line, r.right));
				if (r.filePath) {
					const rightWidth = calcVisibleWidth(r.right);
					const diffStartX = Math.max(0, safeWidth - 2 - rightWidth - 1);
					this.fileHitboxes.push({ lineIndex: currentIdx, filePath: r.filePath, diffStartX });
				}
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
}
