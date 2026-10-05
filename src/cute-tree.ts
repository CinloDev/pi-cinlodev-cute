import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { bolden, cuteGlyphs, cutePalette, frameFg, safeFg } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";
import { detectProjectName } from "./cute-engram.ts";
import { herdrAvailable, launchInHerdrTab } from "./cute-notify.ts";
import { fetchGitFileChanges } from "./cute-git-graph.ts";

export interface TreeNode {
	name: string;
	relPath: string;
	absPath: string;
	isDirectory: boolean;
	children?: TreeNode[];
	itemCount?: number;
	extension?: string;
}

export interface TreeHitbox {
	lineIndex: number;
	type: "header-editor" | "toggle-dir" | "open-file";
	node?: TreeNode;
	startX?: number;
	endX?: number;
}

const DEFAULT_IGNORED_NAMES = new Set([
	".git",
	"node_modules",
	"dist",
	".cache",
	".next",
	"coverage",
	".turbo",
	"build",
]);

/**
 * Recursively scans directory tree returning sorted directories then files.
 * Skips standard build and dependency directories by default.
 */
export function scanDirectoryTree(
	dirPath: string,
	maxDepth = 5,
	currentDepth = 0,
	ignoredNames?: Set<string>,
	rootPath?: string,
	expandedDirs?: Set<string>,
): TreeNode[] {
	const ignored = ignoredNames ?? DEFAULT_IGNORED_NAMES;
	const root = rootPath ?? dirPath;

	try {
		if (!fs.existsSync(dirPath)) return [];
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		const dirs: TreeNode[] = [];
		const files: TreeNode[] = [];

		for (const entry of entries) {
			if (ignored.has(entry.name)) continue;

			const absPath = path.join(dirPath, entry.name);
			const relPath = path.relative(root, absPath);
			const isDirectory = entry.isDirectory();

			if (isDirectory) {
				let itemCount = 0;
				let children: TreeNode[] | undefined;

				if (currentDepth < maxDepth && (!expandedDirs || expandedDirs.has(relPath))) {
					children = scanDirectoryTree(absPath, maxDepth, currentDepth + 1, ignored, root, expandedDirs);
					itemCount = children.length;
				} else {
					try {
						const subEntries = fs.readdirSync(absPath);
						itemCount = subEntries.filter((name) => !ignored.has(name)).length;
					} catch {}
				}

				dirs.push({
					name: entry.name,
					relPath,
					absPath,
					isDirectory: true,
					children,
					itemCount,
				});
			} else {
				const ext = path.extname(entry.name).toLowerCase().replace(/^\./, "");
				files.push({
					name: entry.name,
					relPath,
					absPath,
					isDirectory: false,
					extension: ext,
				});
			}
		}

		dirs.sort((a, b) => a.name.localeCompare(b.name));
		files.sort((a, b) => a.name.localeCompare(b.name));
		return [...dirs, ...files];
	} catch {
		return [];
	}
}

function isExecutableInPath(name: string): boolean {
	const pathEnv = process.env.PATH || "";
	for (const dir of pathEnv.split(":")) {
		try {
			const full = path.join(dir, name);
			if (fs.existsSync(full) && (fs.statSync(full).mode & 0o111)) {
				return true;
			}
		} catch {}
	}
	return false;
}

export function detectTerminal(): string {
	if (process.env.TERMINAL && isExecutableInPath(process.env.TERMINAL)) {
		return process.env.TERMINAL;
	}
	for (const term of ["foot", "alacritty", "ghostty", "kitty"]) {
		if (isExecutableInPath(term)) {
			return term;
		}
	}
	return process.env.TERMINAL || "foot";
}

/**
 * Non-blocking editor launcher for project tree explorer.
 * Resolves $VISUAL / $EDITOR / nvim and spawns detached terminal window.
 */
export function launchEditor(targetPath?: string, cwd?: string): boolean {
	const editor = process.env.VISUAL || process.env.EDITOR || "nvim";
	const filePath = targetPath ? targetPath : ".";
	const workingDir = cwd || process.cwd();
	const title = `nvim: ${path.basename(filePath)}`;

	// 1. If running inside Herdr, open as a focused full-screen tab
	if (herdrAvailable()) {
		if (launchInHerdrTab(`${editor} ${filePath}`, title, workingDir)) {
			return true;
		}
	}

	// 2. Fallback to external terminal (foot, alacritty, kitty, ghostty)
	try {
		const terminal = detectTerminal();
		const termBin = path.basename(terminal).toLowerCase();
		const winTitle = `CUTE: ${path.basename(filePath)}`;

		let args: string[];
		switch (termBin) {
			case "foot":
				args = ["--app-id=cute-editor", "-T", winTitle, editor, filePath];
				break;
			case "alacritty":
				args = ["--class", "cute-editor,cute-editor", "-t", winTitle, "-e", editor, filePath];
				break;
			case "kitty":
				args = ["--class=cute-editor", "-T", winTitle, editor, filePath];
				break;
			case "ghostty":
				args = ["--class=cute-editor", "-e", editor, filePath];
				break;
			default:
				args = ["-e", editor, filePath];
				break;
		}

		// Spawn terminal with editor directly detached so it works in any Wayland/X11 environment
		const child = spawn(terminal, args, {
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

function getFileIcon(extension?: string): string {
	switch (extension?.toLowerCase()) {
		case "ts":
		case "tsx":
		case "js":
		case "jsx":
		case "mjs":
		case "cjs":
			return "📄";
		case "json":
		case "yaml":
		case "yml":
		case "toml":
			return "⚙️";
		case "md":
		case "txt":
		case "markdown":
			return "📝";
		case "css":
		case "scss":
		case "sass":
		case "less":
			return "🎨";
		case "html":
		case "htm":
			return "🌐";
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "svg":
		case "ico":
		case "webp":
			return "🖼️";
		case "sh":
		case "bash":
		case "zsh":
			return "💻";
		case "lock":
			return "🔒";
		default:
			return "📄";
	}
}

interface VisibleTreeRow {
	node: TreeNode;
	prefix: string;
	depth: number;
}

function flattenVisibleTree(
	nodes: TreeNode[],
	expandedDirs: Set<string>,
	parentPrefix = "",
	depth = 0,
): VisibleTreeRow[] {
	const rows: VisibleTreeRow[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isLast = i === nodes.length - 1;
		const branch = isLast ? "└── " : "├── ";
		const prefix = parentPrefix + branch;
		rows.push({ node, prefix, depth });

		if (node.isDirectory && expandedDirs.has(node.relPath) && node.children && node.children.length > 0) {
			const childParentPrefix = parentPrefix + (isLast ? "    " : "│   ");
			const childRows = flattenVisibleTree(node.children, expandedDirs, childParentPrefix, depth + 1);
			rows.push(...childRows);
		}
	}
	return rows;
}

function collectAllDirRelPaths(nodes: TreeNode[], result: Set<string> = new Set()): Set<string> {
	for (const node of nodes) {
		if (node.isDirectory) {
			result.add(node.relPath);
			if (node.children) {
				collectAllDirRelPaths(node.children, result);
			}
		}
	}
	return result;
}

/**
 * Interactive Project Tree & Explorer Card for the CUTE Sidebar.
 */
export class CinlodevProjectTreeCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private readonly cwd: string;
	private expandedDirs: Set<string>;
	private scrollOffset = 0;
	private hitboxes: TreeHitbox[] = [];
	private selectedRelPath?: string;
	private cachedTree?: TreeNode[];
	private lastScanTime = 0;

	private lastTargetContentLines?: number;

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme, cwd?: string) {
		this.ctx = ctx;
		this.tui = tui ?? ({ requestRender: () => {} } as any);
		this.theme = theme;
		this.cwd = cwd ?? ctx?.cwd ?? process.cwd();
		this.expandedDirs = new Set<string>();
		this.initDefaultExpanded();
	}

	private initDefaultExpanded(): void {
		try {
			if (fs.existsSync(path.join(this.cwd, "src"))) {
				this.expandedDirs.add("src");
			}
		} catch {}
	}

	invalidate(): void {
		this.cachedTree = undefined;
		this.lastScanTime = 0;
	}

	getHitboxes(): TreeHitbox[] {
		return [...this.hitboxes];
	}

	getExpandedDirs(): Set<string> {
		return new Set(this.expandedDirs);
	}

	setExpanded(relPath: string, expanded: boolean): void {
		if (expanded) {
			this.expandedDirs.add(relPath);
		} else {
			this.expandedDirs.delete(relPath);
		}
		this.cachedTree = undefined;
		this.lastScanTime = 0;
		this.tui?.requestRender();
	}

	expandAll(): void {
		const tree = scanDirectoryTree(this.cwd);
		collectAllDirRelPaths(tree, this.expandedDirs);
		this.cachedTree = undefined;
		this.lastScanTime = 0;
		this.tui?.requestRender();
	}

	collapseAll(): void {
		this.expandedDirs.clear();
		this.cachedTree = undefined;
		this.lastScanTime = 0;
		this.tui?.requestRender();
	}

	private getTree(): TreeNode[] {
		const now = Date.now();
		if (!this.cachedTree || now - this.lastScanTime > 3000) {
			this.cachedTree = scanDirectoryTree(this.cwd, 5, 0, undefined, undefined, this.expandedDirs);
			this.lastScanTime = now;
		}
		return this.cachedTree;
	}

	handleRailClick(lineIndex: number, button?: string, localX?: number): boolean {
		if (button === "right") {
			if (this.expandedDirs.size > 0) {
				this.collapseAll();
			} else {
				this.expandAll();
			}
			return true;
		}

		if (lineIndex === 0) {
			launchEditor(undefined, this.cwd);
			return true;
		}

		const hit = this.hitboxes.find(
			(h) =>
				h.lineIndex === lineIndex &&
				(localX === undefined || h.startX === undefined || (localX >= h.startX && localX <= (h.endX ?? 999))),
		);

		if (hit) {
			if (hit.type === "header-editor") {
				launchEditor(undefined, this.cwd);
				return true;
			}
			if (hit.type === "toggle-dir" && hit.node) {
				if (this.expandedDirs.has(hit.node.relPath)) {
					this.expandedDirs.delete(hit.node.relPath);
				} else {
					this.expandedDirs.add(hit.node.relPath);
				}
				this.cachedTree = undefined;
				this.lastScanTime = 0;
				this.tui?.requestRender();
				return true;
			}
			if (hit.type === "open-file" && hit.node) {
				this.selectedRelPath = hit.node.relPath;
				launchEditor(hit.node.absPath, this.cwd);
				this.tui?.requestRender();
				return true;
			}
		}

		return false;
	}

	handleClick(lineIndex?: number, button?: string, localX?: number): boolean {
		return this.handleRailClick(lineIndex ?? 0, button, localX);
	}

	getMaxVisibleRows(totalRows: number): number {
		if (typeof this.lastTargetContentLines === "number") {
			if (totalRows > this.lastTargetContentLines) {
				return Math.max(1, this.lastTargetContentLines - 1);
			}
			return this.lastTargetContentLines;
		}
		const termRows = (this.tui as any)?.terminal?.rows;
		if (typeof termRows === "number" && termRows >= 15) {
			const targetContentLines = Math.max(10, termRows - 11);
			if (totalRows > targetContentLines) {
				return targetContentLines - 1;
			}
			return targetContentLines;
		}
		return 24;
	}

	handleWheel(delta: number): boolean {
		if (delta === 0) return false;
		const tree = this.getTree();
		const allRows = flattenVisibleTree(tree, this.expandedDirs);
		const maxVisibleRows = this.getMaxVisibleRows(allRows.length);
		if (allRows.length <= maxVisibleRows) return false;

		const maxOffset = Math.max(0, allRows.length - maxVisibleRows);
		const newOffset = Math.min(maxOffset, Math.max(0, this.scrollOffset + (delta > 0 ? 1 : -1)));
		if (newOffset !== this.scrollOffset) {
			this.scrollOffset = newOffset;
			this.tui?.requestRender();
			return true;
		}
		return false;
	}

	handleRailWheel(delta: number): boolean {
		return this.handleWheel(delta);
	}

	render(width: number, availableHeight?: number): string[] {
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;
		const theme = this.theme;
		const g = cuteGlyphs(theme);
		const colors = loadCuteColors();
		const palette = cutePalette(theme ?? ({} as any));

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const c = {
			pink: (s: string): string => (theme ? safeFg(theme, "accent", s, "pink") : s),
			gold: (s: string): string => (theme ? safeFg(theme, "heading", s, "yellow") : s),
			yellow: (s: string): string => (theme ? safeFg(theme, "warning", s, "yellow") : s),
			coral: (s: string): string => (theme ? safeFg(theme, "red", s, "red") : s),
			mint: (s: string): string => (theme ? safeFg(theme, "mint", s, "green") : s),
			cyan: (s: string): string => (theme ? safeFg(theme, "write", s, "cyan") : s),
			text: (s: string): string => (theme ? safeFg(theme, "text", s) : s),
			dim: (s: string): string => (theme ? safeFg(theme, "dim", s) : s),
			muted: (s: string): string => (theme ? safeFg(theme, "muted", s) : s),
		};

		this.hitboxes = [];

		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		const projectName = detectProjectName(this.cwd) || path.basename(this.cwd) || "project";
		const editorRaw = path.basename(process.env.VISUAL || process.env.EDITOR || "nvim");

		const fullBadgeRaw = `[ ↗ ${editorRaw} ]`;
		const compactBadgeRaw = "[ ↗ ]";
		const useCompactBadge = safeWidth < 38;
		const activeBadgeRaw = useCompactBadge ? compactBadgeRaw : fullBadgeRaw;
		const activeBadgeStyled = useCompactBadge
			? `${c.dim("[")} ${c.pink("↗")} ${c.dim("]")}`
			: `${c.dim("[")} ${c.pink("↗")} ${c.gold(editorRaw)} ${c.dim("]")}`;
		const activeBadgeLen = calcVisibleWidth(activeBadgeRaw);

		// Header layout: tl + h + ' ' (3) ... ' ' + h*(fill) + ' ' (fill + 2) ... badge ... ' ' + h + tr (3)
		// Total fixed overhead excluding title text and fill line: 3 + 2 + activeBadgeLen + 3 = 8 + activeBadgeLen
		const fixedOverhead = 8 + activeBadgeLen;
		const availableForTitle = Math.max(0, safeWidth - fixedOverhead);

		const flowerIcon = g.flower || "✿";
		let titleStyled = "";
		let titleRawLen = 0;

		const fullPrefixRaw = `${flowerIcon} PROYECTO · `;
		const fullPrefixLen = calcVisibleWidth(fullPrefixRaw);

		if (availableForTitle >= 18) {
			const maxProjectNameLen = availableForTitle - fullPrefixLen;
			const displayProjectName =
				calcVisibleWidth(projectName) > maxProjectNameLen
					? truncateAnsiAware(projectName, maxProjectNameLen)
					: projectName;
			titleStyled = `${c.pink(flowerIcon)} ${c.gold("PROYECTO")} ${c.dim("·")} ${c.cyan(displayProjectName)}`;
			titleRawLen = calcVisibleWidth(`${flowerIcon} PROYECTO · ${displayProjectName}`);
		} else if (availableForTitle >= 11) {
			titleStyled = `${c.pink(flowerIcon)} ${c.gold("PROYECTO")}`;
			titleRawLen = calcVisibleWidth(`${flowerIcon} PROYECTO`);
		} else if (availableForTitle >= 6) {
			titleStyled = `${c.pink(flowerIcon)} ${c.gold("TREE")}`;
			titleRawLen = calcVisibleWidth(`${flowerIcon} TREE`);
		} else if (availableForTitle >= 1) {
			titleStyled = c.pink(flowerIcon);
			titleRawLen = calcVisibleWidth(flowerIcon);
		}

		const fillLen = Math.max(0, safeWidth - (3 + titleRawLen + 2 + activeBadgeLen + 3));
		const top = `${frame(`${g.tl}${g.h} `)}${titleStyled}${frame(` ${g.h.repeat(fillLen)} `)}${activeBadgeStyled}${frame(` ${g.h}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const editorButtonStartX = safeWidth - 3 - activeBadgeLen;
		const editorButtonEndX = safeWidth - 3;
		this.hitboxes.push({
			lineIndex: 0,
			type: "header-editor",
			startX: editorButtonStartX,
			endX: editorButtonEndX,
		});

		const tree = this.getTree();
		let targetCardLines: number | undefined =
			availableHeight ||
			(this.tui?.terminal?.rows && this.tui.terminal.rows >= 15
				? Math.max(10, this.tui.terminal.rows - 11)
				: undefined);
		let isFullHeight = false;

		if (targetCardLines !== undefined) {
			isFullHeight = true;
		} else {
			targetCardLines = 26;
			isFullHeight = false;
		}

		const contentCapacity = Math.max(1, targetCardLines - 2);
		this.lastTargetContentLines = contentCapacity;

		if (tree.length === 0) {
			const emptyMsg = `${c.dim("Sin archivos en el proyecto")} · ${c.pink(flowerIcon)}`;
			if (isFullHeight) {
				const lines = [top, boxLine(emptyMsg)];
				for (let i = 1; i < contentCapacity; i++) {
					lines.push(boxLine(""));
				}
				lines.push(bottom);
				return lines;
			}
			return [top, boxLine(emptyMsg), bottom];
		}

		const allRows = flattenVisibleTree(tree, this.expandedDirs);
		const hasOverflow = allRows.length > contentCapacity;
		const maxVisibleRows = hasOverflow ? Math.max(1, contentCapacity - 1) : contentCapacity;
		const maxOffset = Math.max(0, allRows.length - maxVisibleRows);
		if (this.scrollOffset > maxOffset) {
			this.scrollOffset = maxOffset;
		}

		const visibleRows = allRows.slice(this.scrollOffset, this.scrollOffset + maxVisibleRows);
		const lines: string[] = [top];

		// Map dirty Git files and parent directories
		const gitChanges = fetchGitFileChanges(this.cwd);
		const gitStatusMap = new Map<string, string>();
		const dirtyDirSet = new Set<string>();
		for (const ch of gitChanges) {
			gitStatusMap.set(ch.path, ch.status);
			let parentDir = path.dirname(ch.path);
			while (parentDir && parentDir !== "." && parentDir !== "/") {
				dirtyDirSet.add(parentDir);
				parentDir = path.dirname(parentDir);
			}
		}

		for (const row of visibleRows) {
			const currentLineIdx = lines.length;
			const styledPrefix = c.dim(row.prefix);

			if (row.node.isDirectory) {
				const isExpanded = this.expandedDirs.has(row.node.relPath);
				const folderIcon = isExpanded ? "📂 " : "📁 ";
				const hasDirtyChildren = dirtyDirSet.has(row.node.relPath);
				const folderName = hasDirtyChildren ? c.yellow(row.node.name) : c.cyan(row.node.name);
				const countStr = typeof row.node.itemCount === "number" ? c.dim(` (${row.node.itemCount} items)`) : "";
				const rightBadge = hasDirtyChildren ? c.yellow("●") : "";
				const content = `${styledPrefix}${folderIcon}${folderName}${countStr}`;
				lines.push(boxLine(content, rightBadge));

				this.hitboxes.push({
					lineIndex: currentLineIdx,
					type: "toggle-dir",
					node: row.node,
					startX: 0,
					endX: safeWidth,
				});
			} else {
				const fileIcon = `${getFileIcon(row.node.extension)} `;
				const fileGitStatus = gitStatusMap.get(row.node.relPath);
				let rightBadge = "";
				let fileColor = c.text;
				const ext = (row.node.extension || "").toLowerCase();
				if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "mjs") {
					fileColor = c.mint;
				} else if (ext === "json" || ext === "yaml" || ext === "yml" || ext === "toml") {
					fileColor = c.gold;
				} else if (ext === "md" || ext === "txt") {
					fileColor = c.text;
				}

				if (fileGitStatus === "modified") {
					fileColor = c.yellow;
					rightBadge = c.yellow("M");
				} else if (fileGitStatus === "added") {
					fileColor = c.mint;
					rightBadge = c.mint("A");
				} else if (fileGitStatus === "untracked") {
					fileColor = c.pink;
					rightBadge = c.pink("?");
				} else if (fileGitStatus === "conflict") {
					fileColor = c.coral;
					rightBadge = c.coral("U");
				}

				const isSelected = this.selectedRelPath === row.node.relPath;
				const styledName = isSelected
					? c.pink(bolden(this.theme, row.node.name))
					: fileColor(row.node.name);
				const content = `${styledPrefix}${fileIcon}${styledName}`;
				lines.push(boxLine(content, rightBadge));

				this.hitboxes.push({
					lineIndex: currentLineIdx,
					type: "open-file",
					node: row.node,
					startX: 0,
					endX: safeWidth,
				});
			}
		}

		// Scroll indicator if there are more items
		if (hasOverflow) {
			const remainingBelow = allRows.length - (this.scrollOffset + visibleRows.length);
			const infoParts: string[] = [];
			if (this.scrollOffset > 0) infoParts.push(`▲ ${this.scrollOffset} arriba`);
			if (remainingBelow > 0) infoParts.push(`▼ ${remainingBelow} abajo`);
			const scrollIndicator = c.dim(`... ${infoParts.join(" · ")} (wheel scroll)`);
			lines.push(boxLine(scrollIndicator));
		}

		if (isFullHeight && allRows.length <= contentCapacity) {
			while (lines.length - 1 < contentCapacity) {
				lines.push(boxLine(""));
			}
		}

		lines.push(bottom);
		return lines;
	}
}
