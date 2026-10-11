/**
 * Project Tree & File Explorer for CUTE Sidebar.
 * Facade module re-exporting from domain modules in src/tree/ for backwards compatibility.
 */

export {
	type TreeNode,
	type TreeHitbox,
	type VisibleTreeRow,
	DEFAULT_IGNORED_NAMES,
	scanDirectoryTree,
	getFileIcon,
	flattenVisibleTree,
	collectAllDirRelPaths,
} from "./tree/tree-scanner.ts";

export {
	isExecutableInPath,
	detectTerminal,
	launchEditor,
} from "./tree/tree-launchers.ts";

export {
	CinlodevProjectTreeCard,
} from "./tree/tree-card.ts";
