import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import * as cp from "node:child_process";
import { cuteGlyphs, safeFg } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { loadCuteLayout } from "./cute-layout.ts";
import { readGitBranch } from "./cute-paths.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";

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

	handleClick(_localIndex?: number): boolean {
		this.toggleExpanded();
		return true;
	}

	invalidate(): void {
		resetGitGraphCache();
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
		const dimText = (s: string): string => (theme ? safeFg(theme, "dim", s, "muted") : s);

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

		// 1. Collapsed mode: single line summary inside card
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
			const summaryRight = dimText("[click to expand]");
			return [top, boxLine(summaryLeft, summaryRight), bottom];
		}

		// 2. Expanded mode: full tree with Dracula highlighting
		const titleText = `${branchGlyph} git graph`;
		const styledTitle = `${theme ? safeFg(theme, "accent", branchGlyph, "pink") : branchGlyph} ${theme ? safeFg(theme, "heading", "git graph") : "git graph"}`;
		const fillTop = Math.max(0, safeWidth - 4 - calcVisibleWidth(titleText) - 1);
		const top = `${frame(`${g.tl}${g.h} `)}${styledTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];

		for (const line of rawLines) {
			const colorized = colorizeGitGraphLine(line, theme);
			lines.push(boxLine(colorized));
		}

		// Bottom hint row
		lines.push(boxLine("", dimText("[click to collapse]")));
		lines.push(bottom);

		return lines;
	}
}
