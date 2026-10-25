import fs from "node:fs";
import path from "node:path";
import { truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderBoxCard, type CardTheme } from "../card-frame.ts";
import { openExternalFile } from "../editor-launcher.ts";

export interface TreeNode {
	name: string;
	relPath: string;
	absPath: string;
	isDirectory: boolean;
	children?: TreeNode[];
	itemCount?: number;
	extension?: string;
}

export interface VisibleTreeRow {
	node: TreeNode;
	prefix: string;
	depth: number;
}

export interface TreeCardHitbox {
	lineIndex: number;
	node?: TreeNode;
	type: "header" | "dir" | "file";
}

export const DEFAULT_IGNORED_NAMES = new Set([
	".git",
	"node_modules",
	"dist",
	".cache",
	".next",
	"coverage",
	".turbo",
	"build",
]);

export function scanDirectoryTree(
	dirPath: string,
	maxDepth = 4,
	currentDepth = 0,
	ignoredNames: Set<string> = DEFAULT_IGNORED_NAMES,
	rootPath?: string,
	expandedDirs?: Set<string>,
): TreeNode[] {
	const root = rootPath ?? dirPath;

	try {
		if (!fs.existsSync(dirPath)) return [];
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		const dirs: TreeNode[] = [];
		const files: TreeNode[] = [];

		for (const entry of entries) {
			if (ignoredNames.has(entry.name)) continue;

			const absPath = path.join(dirPath, entry.name);
			const relPath = path.relative(root, absPath);
			const isDirectory = entry.isDirectory();

			if (isDirectory) {
				let itemCount = 0;
				let children: TreeNode[] | undefined;

				if (currentDepth < maxDepth && (!expandedDirs || expandedDirs.has(relPath))) {
					children = scanDirectoryTree(absPath, maxDepth, currentDepth + 1, ignoredNames, root, expandedDirs);
					itemCount = children.length;
				} else {
					try {
						const subEntries = fs.readdirSync(absPath);
						itemCount = subEntries.filter((name) => !ignoredNames.has(name)).length;
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

export function flattenVisibleTree(
	nodes: TreeNode[],
	expandedDirs: Set<string>,
	parentPrefix = "",
	depth = 0,
): VisibleTreeRow[] {
	const rows: VisibleTreeRow[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;
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

export class ProjectTreeCard implements Component {
	private readonly cwd: string;
	private readonly theme?: CardTheme;
	private expandedDirs: Set<string>;
	private scrollOffset = 0;
	private cachedTree?: TreeNode[];
	private lastScanTime = 0;
	private visibleRowsCache: VisibleTreeRow[] = [];
	private hitboxes: TreeCardHitbox[] = [];

	constructor(cwd: string, theme?: CardTheme) {
		this.cwd = cwd;
		this.theme = theme;
		this.expandedDirs = new Set<string>();
		this.handleRailClick = this.handleRailClick.bind(this);
		this.handleRailWheel = this.handleRailWheel.bind(this);
		this.handleMouse = this.handleMouse.bind(this);
		this.initDefaultExpanded();
	}

	private initDefaultExpanded(): void {
		try {
			if (fs.existsSync(path.join(this.cwd, "lib"))) this.expandedDirs.add("lib");
			else if (fs.existsSync(path.join(this.cwd, "src"))) this.expandedDirs.add("src");
		} catch {}
	}

	invalidate(): void {
		this.cachedTree = undefined;
		this.lastScanTime = 0;
	}

	digest(): string {
		return `${this.scrollOffset}:${[...this.expandedDirs].sort().join(",")}`;
	}

	getExpandedDirs(): Set<string> {
		return new Set(this.expandedDirs);
	}

	toggleDir(relPath: string): void {
		if (this.expandedDirs.has(relPath)) {
			this.expandedDirs.delete(relPath);
		} else {
			this.expandedDirs.add(relPath);
		}
		this.invalidate();
	}

	private getTree(): TreeNode[] {
		const now = Date.now();
		if (!this.cachedTree || now - this.lastScanTime > 3000) {
			this.cachedTree = scanDirectoryTree(this.cwd, 5, 0, undefined, undefined, this.expandedDirs);
			this.lastScanTime = now;
		}
		return this.cachedTree;
	}

	handleRailClick(lineIndex: number, button?: string): boolean {
		if (button === "right") {
			if (this.expandedDirs.size > 0) {
				this.expandedDirs.clear();
			} else {
				const scan = scanDirectoryTree(this.cwd, 2);
				for (const node of scan) {
					if (node.isDirectory) this.expandedDirs.add(node.relPath);
				}
			}
			this.invalidate();
			return true;
		}

		if (lineIndex === 0) {
			openExternalFile(this.cwd, this.cwd);
			return true;
		}

		const hit = this.hitboxes.find((h) => h.lineIndex === lineIndex);
		if (hit) {
			if (hit.type === "dir" && hit.node) {
				this.toggleDir(hit.node.relPath);
				return true;
			}
			if (hit.type === "file" && hit.node) {
				openExternalFile(hit.node.absPath, this.cwd);
				return true;
			}
		}

		return false;
	}

	handleRailWheel(delta: number): boolean {
		if (delta === 0) return false;
		const maxOffset = Math.max(0, this.visibleRowsCache.length - 10);
		const newOffset = Math.min(maxOffset, Math.max(0, this.scrollOffset + (delta > 0 ? 1 : -1)));
		if (newOffset !== this.scrollOffset) {
			this.scrollOffset = newOffset;
			return true;
		}
		return false;
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean; render?: boolean } | undefined {
		if (event.type === "click") {
			const handled = this.handleRailClick(event.y, event.button);
			if (handled) return { handled: true, render: true };
		} else if (event.type === "wheel") {
			const handled = this.handleRailWheel(event.wheelDelta ?? 0);
			if (handled) return { handled: true, render: true };
		}
		return undefined;
	}

	render(width: number, availableHeight?: number): string[] {
		const tree = this.getTree();
		const rows = flattenVisibleTree(tree, this.expandedDirs);
		this.visibleRowsCache = rows;

		const maxViewLines = typeof availableHeight === "number" ? Math.max(6, availableHeight - 4) : 18;
		const maxScroll = Math.max(0, rows.length - maxViewLines);
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		const slice = rows.slice(this.scrollOffset, this.scrollOffset + maxViewLines);
		const body: string[] = [];

		if (rows.length === 0) {
			body.push("Directorio vacío");
		} else {
			for (const row of slice) {
				if (row.node.isDirectory) {
					const isExp = this.expandedDirs.has(row.node.relPath);
					const icon = isExp ? "▾ " : "▸ ";
					const count = row.node.itemCount !== undefined ? ` (${row.node.itemCount})` : "";
					body.push(`${row.prefix}${icon}${row.node.name}${count}`);
				} else {
					body.push(`${row.prefix}${row.node.name}`);
				}
			}
		}

		const hint = rows.length > maxViewLines
			? `${this.scrollOffset + 1}-${Math.min(rows.length, this.scrollOffset + maxViewLines)}/${rows.length}`
			: `${rows.length} elementos`;

		const cardLines = renderBoxCard("Project Tree", body, width, this.theme, { hint });

		this.hitboxes = [{ lineIndex: 0, type: "header" }];
		let searchFrom = 1;
		for (const row of slice) {
			for (let idx = searchFrom; idx < cardLines.length - 1; idx++) {
				if (cardLines[idx]?.includes(row.node.name)) {
					this.hitboxes.push({
						lineIndex: idx,
						node: row.node,
						type: row.node.isDirectory ? "dir" : "file",
					});
					searchFrom = idx + 1;
					break;
				}
			}
		}

		return cardLines;
	}
}
