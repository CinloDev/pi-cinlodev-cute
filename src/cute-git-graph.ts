import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import * as cp from "node:child_process";
import { cuteGlyphs, safeFg } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { loadCuteLayout } from "./cute-layout.ts";
import { readGitBranch } from "./cute-paths.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";

const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

/**
 * Colorizes a single line from `git log --graph --oneline --decorate`
 * with Dracula syntax roles:
 * - Graph nodes (*) in pink (accent)
 * - Graph edges (|, \, /) in cyan/celeste (syntaxFunction)
 * - Hashes in gold/orange (syntaxNumber)
 * - Ref decorations in mint / secondary / type
 * - Messages in text
 */
export function colorizeGitGraphLine(line: string, theme?: Theme): string {
	if (!theme || !line.trim()) return line;

	// 1. Pure graph connection lines (e.g. "|\\  ", "|/  ", "|   ")
	if (/^[\\/|_\s]+$/.test(line)) {
		return line.replace(/([\\/|_]+)/g, (m) => safeFg(theme, "syntaxFunction", m, "cyan"));
	}

	// 2. Commit line: (graph characters with *) (hash) (optional refs in parens) (subject)
	const m = /^([*\\/|_\s]*[*][*\\/|_\s]*)\s+([0-9a-f]{7,40})\s*(?:\(([^)]+)\))?\s*(.*)$/.exec(line);
	if (!m) {
		// Fallback: color any graph characters at the start
		return line.replace(/^([*\\/|_\s]+)/, (graph) =>
			graph
				.replace(/(\*)/g, (s) => safeFg(theme, "accent", s, "pink"))
				.replace(/([\\/|_]+)/g, (s) => safeFg(theme, "syntaxFunction", s, "cyan")),
		);
	}

	const graphPart = m[1];
	const hash = m[2];
	const refs = m[3];
	const subject = m[4];

	const coloredGraph = graphPart.replace(/(\*)|([\\/|_]+)/g, (_m, star, edge) => {
		if (star) return safeFg(theme, "accent", star, "pink");
		return safeFg(theme, "syntaxFunction", edge, "cyan");
	});

	const coloredHash = safeFg(theme, "syntaxNumber", hash, "yellow");

	let coloredRefs = "";
	if (refs) {
		const openParen = safeFg(theme, "syntaxPunctuation", "(", "muted");
		const closeParen = safeFg(theme, "syntaxPunctuation", ")", "muted");
		const refItems = refs
			.split(",")
			.map((item) => {
				const trimmed = item.trim();
				if (trimmed.includes("HEAD")) {
					return safeFg(theme, "mint", trimmed, "green");
				}
				if (trimmed.includes("origin") || trimmed.includes("upstream")) {
					return safeFg(theme, "secondary", trimmed, "magenta");
				}
				return safeFg(theme, "syntaxType", trimmed, "yellow");
			})
			.join(safeFg(theme, "syntaxPunctuation", ", ", "muted"));
		coloredRefs = ` ${openParen}${refItems}${closeParen}`;
	}

	const coloredSubject = subject ? ` ${safeFg(theme, "text", subject)}` : "";

	return `${coloredGraph} ${coloredHash}${coloredRefs}${coloredSubject}`;
}

export interface GitStatusCounts {
	staged: number;
	modified: number;
	untracked: number;
	conflicts: number;
	linesAdded: number;
	linesDeleted: number;
	isClean: boolean;
}

export function parseGitNumstat(output: string): { linesAdded: number; linesDeleted: number } {
	let linesAdded = 0;
	let linesDeleted = 0;
	const lines = output
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.trim().length > 0);

	for (const line of lines) {
		const parts = line.split("\t");
		if (parts.length >= 2) {
			const a = parseInt(parts[0], 10);
			const d = parseInt(parts[1], 10);
			if (!isNaN(a)) linesAdded += a;
			if (!isNaN(d)) linesDeleted += d;
		}
	}
	return { linesAdded, linesDeleted };
}

export function parseGitStatusPorcelain(output: string): Omit<GitStatusCounts, "linesAdded" | "linesDeleted"> {
	let staged = 0;
	let modified = 0;
	let untracked = 0;
	let conflicts = 0;

	const lines = output
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.length >= 2);

	for (const line of lines) {
		const x = line[0];
		const y = line[1];

		if (x === "?" && y === "?") {
			untracked++;
			continue;
		}
		if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
			conflicts++;
			continue;
		}
		if (x !== " " && x !== "?") {
			staged++;
		}
		if (y !== " " && y !== "?") {
			modified++;
		}
	}

	const isClean = staged === 0 && modified === 0 && untracked === 0 && conflicts === 0;
	return { staged, modified, untracked, conflicts, isClean };
}

export function formatGitStatusBadges(counts: GitStatusCounts, theme?: Theme): string {
	if (!theme) {
		return counts.isClean ? "clean" : "modified";
	}

	if (counts.isClean) {
		return safeFg(theme, "mint", "✔ clean", "green");
	}

	const items: string[] = [];
	if (counts.conflicts > 0) {
		items.push(safeFg(theme, "error", `✖ ${counts.conflicts} conflict`, "red"));
	}
	if (counts.modified > 0) {
		items.push(safeFg(theme, "warning", `● ${counts.modified} mod`, "yellow"));
	}
	if (counts.staged > 0) {
		items.push(safeFg(theme, "mint", `+${counts.staged} staged`, "green"));
	}
	if (counts.untracked > 0) {
		items.push(safeFg(theme, "secondary", `?${counts.untracked} untracked`, "magenta"));
	}

	const dot = safeFg(theme, "syntaxPunctuation", " · ", "muted");
	return items.join(dot);
}

export interface GitStatusCache {
	counts: GitStatusCounts;
	readAt: number;
	cwd: string;
}

let cachedStatus: GitStatusCache | undefined;

export function fetchGitStatus(cwd: string, ttlMs = 4000): GitStatusCounts {
	const now = Date.now();
	if (cachedStatus && cachedStatus.cwd === cwd && now - cachedStatus.readAt < ttlMs) {
		return cachedStatus.counts;
	}

	try {
		const output = cp.execFileSync("git", ["status", "--porcelain=v1"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1500,
		});

		let linesAdded = 0;
		let linesDeleted = 0;
		try {
			const numstatOut = cp.execFileSync("git", ["diff", "HEAD", "--numstat"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1500,
			});
			const numstat = parseGitNumstat(numstatOut);
			linesAdded = numstat.linesAdded;
			linesDeleted = numstat.linesDeleted;
		} catch {}

		const counts: GitStatusCounts = {
			...parseGitStatusPorcelain(output),
			linesAdded,
			linesDeleted,
		};
		cachedStatus = { counts, readAt: now, cwd };
		return counts;
	} catch {
		const fallback: GitStatusCounts = {
			staged: 0,
			modified: 0,
			untracked: 0,
			conflicts: 0,
			linesAdded: 0,
			linesDeleted: 0,
			isClean: true,
		};
		cachedStatus = { counts: fallback, readAt: now, cwd };
		return fallback;
	}
}

export function resetGitStatusCache(): void {
	cachedStatus = undefined;
}

export interface GitGraphCache {
	rawLines: string[];
	readAt: number;
	cwd: string;
}

let cachedGraph: GitGraphCache | undefined;

export function fetchGitLogGraph(cwd: string, maxCommits = 6, ttlMs = 4000): string[] {
	const now = Date.now();
	if (cachedGraph && cachedGraph.cwd === cwd && now - cachedGraph.readAt < ttlMs) {
		return cachedGraph.rawLines;
	}

	try {
		const output = cp.execFileSync(
			"git",
			["log", "--graph", "--oneline", "--decorate", "-n", String(maxCommits)],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2000,
			},
		);

		const rawLines = output
			.replace(/\r\n/g, "\n")
			.split("\n")
			.filter((l) => l.trim().length > 0);

		cachedGraph = { rawLines, readAt: now, cwd };
		return rawLines;
	} catch {
		cachedGraph = { rawLines: [], readAt: now, cwd };
		return [];
	}
}

export function resetGitGraphCache(): void {
	cachedGraph = undefined;
}

/**
 * Interactive Git Graph card for the Cinlodev CUTE sidebar rail.
 * - Shows an interactive Dracula-styled git graph in the rail.
 * - Collapsible: click anywhere on the card to toggle between 1-line compact summary
 *   and full ASCII commit tree.
 */
export class CinlodevGitGraphCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private expanded: boolean;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
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
		// 1. Try reading the active SessionChanges from gentle-shell (via shared sidebar state symbol)
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

		// 2. Fallback to repository git diff lines
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

	invalidate(): void {
		resetGitGraphCache();
		resetGitStatusCache();
	}

	render(width: number): string[] {
		const cfg = loadCuteLayout().gitGraph;
		if (!cfg.enabled) return [];

		const cwd = this.ctx.cwd ?? process.cwd();
		const rawLines = fetchGitLogGraph(cwd, cfg.maxCommits, cfg.ttlMs);
		if (!rawLines.length) return [];

		const safeWidth = Math.max(cfg.minWidth, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║
		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);

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

		// 1. Collapsed mode: single line summary with branch and status badge
		if (!this.expanded) {
			const titleText = `${branchGlyph} git`;
			const styledTitle = `${theme ? safeFg(theme, "accent", branchGlyph, "pink") : branchGlyph} ${theme ? safeFg(theme, "heading", "git") : "git"}`;
			const fillTop = Math.max(0, safeWidth - 4 - calcVisibleWidth(titleText) - 1);
			const top = `${frame(`${g.tl}${g.h} `)}${styledTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
			const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

			// Extract first commit summary without verbose ref decorations
			const firstLine = rawLines[0] ?? "";
			const commitMatch = /^[*\\/|_\s]*([0-9a-f]{7,40})(?:\s*\([^)]*\))?\s*(.*)$/.exec(firstLine);
			const hash = commitMatch ? commitMatch[1] : "";
			const subject = commitMatch ? commitMatch[2] : "";
			const commitText = hash ? (subject ? `${hash} ${subject}` : hash) : "latest";

			const summaryLeft = `${branch} · ${commitText}`;
			return [top, boxLine(summaryLeft, statusBadge), bottom];
		}

		// 2. Expanded mode: full tree with top status badge row and Dracula highlighting
		const titleText = `${branchGlyph} git graph`;
		const styledTitle = `${theme ? safeFg(theme, "accent", branchGlyph, "pink") : branchGlyph} ${theme ? safeFg(theme, "heading", "git graph") : "git graph"}`;
		const fillTop = Math.max(0, safeWidth - 4 - calcVisibleWidth(titleText) - 1);
		const top = `${frame(`${g.tl}${g.h} `)}${styledTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];

		// Spacing between top border and branch row
		lines.push(boxLine(""));

		// Live branch and status badge row
		lines.push(boxLine(branch, statusBadge));

		// Spacing between branch row and git graph tree
		lines.push(boxLine(""));

		for (const line of rawLines) {
			const colorized = colorizeGitGraphLine(line, theme);
			lines.push(boxLine(colorized));
		}

		// Changes row placed cleanly BELOW the branches with spacing from tree
		const changesRow = this.getChangesRow(status, innerWidth);
		if (changesRow) {
			lines.push(boxLine(""));
			lines.push(boxLine(changesRow));
		}

		lines.push(bottom);

		return lines;
	}
}
