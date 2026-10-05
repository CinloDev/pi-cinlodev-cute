import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import * as cp from "node:child_process";
import * as path from "node:path";
import { cuteGlyphs, safeFg, bolden } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { loadCuteLayout } from "./cute-layout.ts";
import { readGitBranch } from "./cute-paths.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";
import { detectTerminal, launchEditor } from "./cute-tree.ts";
import { herdrAvailable, launchInHerdrTab, isTestEnvironment } from "./cute-notify.ts";

const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

/**
 * Shared state between the Git Graph card and Working Tree / Diff card in the GIT tab.
 */
interface GitTabState {
	selectedBranch: string | null;
	viewMode: "graph" | "branches";
}

let gitTabState: GitTabState = {
	selectedBranch: null,
	viewMode: "graph",
};

export function getGitTabSelectedBranch(): string | null {
	return gitTabState.selectedBranch;
}

export function setGitTabSelectedBranch(branch: string | null, tui?: TUI): void {
	gitTabState.selectedBranch = branch;
	tui?.requestRender();
}

export function getGitTabViewMode(): "graph" | "branches" {
	return gitTabState.viewMode;
}

export function setGitTabViewMode(mode: "graph" | "branches", tui?: TUI): void {
	gitTabState.viewMode = mode;
	tui?.requestRender();
}

export function resetGitTabState(): void {
	gitTabState = {
		selectedBranch: null,
		viewMode: "graph",
	};
}

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

export interface GitFileChange {
	path: string;
	status: "modified" | "added" | "deleted" | "untracked" | "conflict";
	statusCode: string;
	linesAdded: number;
	linesDeleted: number;
}

export function fetchGitFileChanges(cwd: string): GitFileChange[] {
	try {
		const statusOut = cp.execFileSync("git", ["status", "--porcelain=v1"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1500,
		});

		const numstatMap = new Map<string, { added: number; deleted: number }>();
		try {
			const numstatOut = cp.execFileSync("git", ["diff", "HEAD", "--numstat"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1500,
			});
			for (const line of numstatOut.split("\n")) {
				const parts = line.trim().split("\t");
				if (parts.length >= 3) {
					const a = parseInt(parts[0], 10) || 0;
					const d = parseInt(parts[1], 10) || 0;
					const filePath = parts.slice(2).join("\t").trim();
					numstatMap.set(filePath, { added: a, deleted: d });
				}
			}
		} catch {}

		const files: GitFileChange[] = [];
		for (const line of statusOut.split("\n")) {
			if (line.length < 3) continue;
			const statusCode = line.slice(0, 2);
			const filePath = line.slice(3).trim();
			const x = statusCode[0];
			const y = statusCode[1];

			let status: GitFileChange["status"] = "modified";
			if (x === "?" && y === "?") status = "untracked";
			else if (x === "A" || y === "A") status = "added";
			else if (x === "D" || y === "D") status = "deleted";
			else if (x === "U" || y === "U") status = "conflict";

			const num = numstatMap.get(filePath) || { added: 0, deleted: 0 };
			files.push({
				path: filePath,
				statusCode: statusCode.trim(),
				status,
				linesAdded: num.added,
				linesDeleted: num.deleted,
			});
		}
		return files;
	} catch {
		return [];
	}
}

export interface GitGraphCache {
	rawLines: string[];
	readAt: number;
	cwd: string;
}

let cachedGraph: GitGraphCache | undefined;

export function fetchGitLogGraph(cwd: string, maxCommits = 20, ttlMs = 4000): string[] {
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

export function shortenRelativeTime(rel: string): string {
	return rel
		.replace(/ minutes? ago/, "m")
		.replace(/ hours? ago/, "h")
		.replace(/ days? ago/, "d")
		.replace(/ weeks? ago/, "w")
		.replace(/ months? ago/, "mo")
		.replace(/ seconds? ago/, "s");
}

export interface GitBranchItem {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
	tracking?: string;
	ahead?: number;
	behind?: number;
	gone?: boolean;
	relativeDate?: string;
}

interface GitBranchesCache {
	branches: GitBranchItem[];
	readAt: number;
	cwd: string;
}

let cachedBranches: GitBranchesCache | undefined;

export function fetchGitBranches(cwd: string, ttlMs = 3000): GitBranchItem[] {
	const now = Date.now();
	if (cachedBranches && cachedBranches.cwd === cwd && now - cachedBranches.readAt < ttlMs) {
		return cachedBranches.branches;
	}

	try {
		const out = cp.execFileSync(
			"git",
			[
				"for-each-ref",
				"--sort=-committerdate",
				"--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:relative)",
				"refs/heads/",
				"refs/remotes/",
			],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2000,
			},
		);

		const currentBranch = readGitBranch(cwd);
		const localBranches: GitBranchItem[] = [];
		const remoteOnlyBranches: GitBranchItem[] = [];
		const localNames = new Set<string>();

		const lines = out.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
		for (const line of lines) {
			const parts = line.split("\t");
			if (parts.length < 2) continue;
			const fullRef = parts[0].trim();
			const shortRef = parts[1].trim();
			if (!shortRef || shortRef === "origin" || fullRef.endsWith("/HEAD") || shortRef.endsWith("/HEAD")) continue;

			const tracking = parts[2]?.trim() || undefined;
			const track = parts[3]?.trim() || "";
			const relDate = parts[4]?.trim() || "";

			let ahead: number | undefined;
			let behind: number | undefined;
			const aheadM = /ahead (\d+)/.exec(track);
			if (aheadM) ahead = parseInt(aheadM[1], 10);
			const behindM = /behind (\d+)/.exec(track);
			if (behindM) behind = parseInt(behindM[1], 10);
			const gone = track.includes("gone");

			const isRemote = fullRef.startsWith("refs/remotes/");
			if (!isRemote) {
				localNames.add(shortRef);
				localBranches.push({
					name: shortRef,
					isCurrent: shortRef === currentBranch,
					isRemote: false,
					tracking,
					ahead,
					behind,
					gone,
					relativeDate: shortenRelativeTime(relDate),
				});
			} else {
				const remoteShort = shortRef.replace(/^origin\//, "");
				if (!localNames.has(remoteShort) && !localNames.has(shortRef)) {
					remoteOnlyBranches.push({
						name: shortRef,
						isCurrent: false,
						isRemote: true,
						relativeDate: shortenRelativeTime(relDate),
					});
				}
			}
		}

		localBranches.sort((a, b) => {
			if (a.isCurrent) return -1;
			if (b.isCurrent) return 1;
			return 0;
		});

		const result = [...localBranches, ...remoteOnlyBranches];
		cachedBranches = { branches: result, readAt: now, cwd };
		return result;
	} catch {
		const fallback: GitBranchItem[] = [{ name: readGitBranch(cwd), isCurrent: true, isRemote: false }];
		cachedBranches = { branches: fallback, readAt: now, cwd };
		return fallback;
	}
}

export function resetGitBranchesCache(): void {
	cachedBranches = undefined;
}

export interface BranchDiffFile {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "unknown";
	statusCode: string;
	linesAdded: number;
	linesDeleted: number;
}

export interface BranchDiffSummary {
	branch: string;
	baseBranch: string;
	files: BranchDiffFile[];
	totalAdded: number;
	totalDeleted: number;
}

interface BranchDiffCache {
	summary: BranchDiffSummary;
	readAt: number;
	key: string;
}

let cachedBranchDiff: BranchDiffCache | undefined;

export function fetchBranchDiff(cwd: string, targetBranch: string, ttlMs = 3000): BranchDiffSummary {
	const current = readGitBranch(cwd);
	const key = `${cwd}::${current}::${targetBranch}`;
	const now = Date.now();
	if (cachedBranchDiff && cachedBranchDiff.key === key && now - cachedBranchDiff.readAt < ttlMs) {
		return cachedBranchDiff.summary;
	}

	try {
		let numstatOut = "";
		let isDirectDiff = false;
		try {
			numstatOut = cp.execFileSync("git", ["diff", `HEAD...${targetBranch}`, "--numstat"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2500,
			});
		} catch {}

		if (!numstatOut.trim()) {
			try {
				numstatOut = cp.execFileSync("git", ["diff", "HEAD", targetBranch, "--numstat"], {
					cwd,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
					timeout: 2500,
				});
				isDirectDiff = true;
			} catch {}
		}

		let nameStatusOut = "";
		try {
			nameStatusOut = cp.execFileSync(
				"git",
				isDirectDiff ? ["diff", "HEAD", targetBranch, "--name-status"] : ["diff", `HEAD...${targetBranch}`, "--name-status"],
				{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2500 },
			);
		} catch {}

		const statusMap = new Map<string, string>();
		for (const line of nameStatusOut.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parts = trimmed.split(/\s+/);
			if (parts.length >= 2) {
				const code = parts[0];
				const filePath = parts.slice(1).join(" ");
				statusMap.set(filePath, code);
			}
		}

		let totalAdded = 0;
		let totalDeleted = 0;
		const files: BranchDiffFile[] = [];

		for (const line of numstatOut.split("\n")) {
			const parts = line.trim().split("\t");
			if (parts.length >= 3) {
				const a = parseInt(parts[0], 10) || 0;
				const d = parseInt(parts[1], 10) || 0;
				const filePath = parts.slice(2).join("\t").trim();
				totalAdded += a;
				totalDeleted += d;
				const code = statusMap.get(filePath) || "M";
				let status: BranchDiffFile["status"] = "modified";
				if (code.startsWith("A")) status = "added";
				else if (code.startsWith("D")) status = "deleted";
				else if (code.startsWith("R")) status = "renamed";

				files.push({
					path: filePath,
					status,
					statusCode: code,
					linesAdded: a,
					linesDeleted: d,
				});
			}
		}

		const summary: BranchDiffSummary = {
			branch: targetBranch,
			baseBranch: current,
			files,
			totalAdded,
			totalDeleted,
		};
		cachedBranchDiff = { summary, readAt: now, key };
		return summary;
	} catch {
		const fallback: BranchDiffSummary = {
			branch: targetBranch,
			baseBranch: current,
			files: [],
			totalAdded: 0,
			totalDeleted: 0,
		};
		cachedBranchDiff = { summary: fallback, readAt: now, key };
		return fallback;
	}
}

export function resetBranchDiffCache(): void {
	cachedBranchDiff = undefined;
}

export function launchGitDiff(branch: string, cwd?: string): boolean {
	if (isTestEnvironment()) return true;
	const workingDir = cwd || process.cwd();
	const title = `diff: ${branch}`;
	const cmd = `git diff HEAD...${branch} | less -R`;

	// 1. If running inside Herdr, open as a focused full-screen tab
	if (herdrAvailable()) {
		if (launchInHerdrTab(cmd, title, workingDir)) {
			return true;
		}
	}

	// 2. Fallback to external terminal
	try {
		const terminal = detectTerminal();
		const termBin = path.basename(terminal).toLowerCase();
		const termTitle = `CUTE Diff: HEAD...${branch}`;

		let args: string[];
		switch (termBin) {
			case "foot":
				args = ["--app-id=cute-diff", "-T", termTitle, "sh", "-c", cmd];
				break;
			case "alacritty":
				args = ["--class", "cute-diff,cute-diff", "-t", termTitle, "-e", "sh", "-c", cmd];
				break;
			case "kitty":
				args = ["--class=cute-editor", "-T", termTitle, "sh", "-c", cmd];
				break;
			case "ghostty":
				args = ["--class=cute-diff", "-e", "sh", "-c", cmd];
				break;
			default:
				args = ["-e", "sh", "-c", cmd];
				break;
		}

		const child = cp.spawn(terminal, args, {
			detached: true,
			stdio: "ignore",
			cwd: workingDir,
		});
		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		return false;
	}
}

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

export function formatFilePathWithDracula(filePath: string, c: { dim: (s: string) => string; cyan: (s: string) => string }): string {
	const lastSlash = filePath.lastIndexOf("/");
	if (lastSlash === -1) {
		return c.cyan(filePath);
	}
	const dir = filePath.slice(0, lastSlash + 1);
	const base = filePath.slice(lastSlash + 1);
	return `${c.dim(dir)}${c.cyan(base)}`;
}

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
	private fileHitboxes: Array<{ lineIndex: number; filePath: string }> = [];

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

	handleRailClick(lineIndex: number, _button?: string, localX?: number): boolean {
		const selectedBranch = getGitTabSelectedBranch();
		if (selectedBranch) {
			if (lineIndex === 0 && typeof localX === "number") {
				if (this.hitboxClose && localX >= this.hitboxClose.start && localX <= this.hitboxClose.end) {
					setGitTabSelectedBranch(null, this.tui);
					this.scrollOffset = 0;
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
				launchEditor(hit.filePath, cwd);
				return true;
			}
			return true;
		}

		if (lineIndex > 0) {
			const hit = this.fileHitboxes.find((h) => h.lineIndex === lineIndex);
			if (hit) {
				const cwd = this.ctx?.cwd ?? process.cwd();
				launchEditor(hit.filePath, cwd);
				return true;
			}
		}

		return this.handleClick(lineIndex);
	}

	invalidate(): void {
		resetGitStatusCache();
		resetBranchDiffCache();
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
			allRows.push({ line: "", right: "", isDivider: true });

			if (diff.files.length === 0) {
				allRows.push({ line: `✔ ${c.mint("Sin diferencias con HEAD")}`, right: "" });
			} else {
				for (const f of diff.files) {
					let badge = c.yellow("M");
					if (f.status === "added") badge = c.mint("A");
					else if (f.status === "deleted") badge = c.coral("D");
					else if (f.status === "renamed") badge = c.cyan("R");

					const rightParts: string[] = [];
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
						this.fileHitboxes.push({ lineIndex: currentIdx, filePath: r.filePath });
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
		allRows.push({ line: "", right: "", isDivider: true });

		for (const f of files) {
			let badge = c.yellow("M");
			if (f.status === "added") badge = c.mint("A");
			else if (f.status === "deleted") badge = c.coral("D");
			else if (f.status === "untracked") badge = c.pink("?");
			else if (f.status === "conflict") badge = c.coral("U");

			const rightParts: string[] = [];
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
					this.fileHitboxes.push({ lineIndex: currentIdx, filePath: r.filePath });
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
