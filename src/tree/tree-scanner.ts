import fs from "node:fs";
import path from "node:path";

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

export interface VisibleTreeRow {
	node: TreeNode;
	prefix: string;
	depth: number;
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

export function getFileIcon(extension?: string): string {
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

export function flattenVisibleTree(
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

export function collectAllDirRelPaths(nodes: TreeNode[], result: Set<string> = new Set()): Set<string> {
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
