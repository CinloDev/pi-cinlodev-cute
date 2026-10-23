import type { TUI } from "@earendil-works/pi-tui";
import type { CinlodevTodoMirror } from "../todos.ts";
import type { CinlodevGitGraphCard, CinlodevWorkingTreeCard } from "../cute-git-graph.ts";
import type { CinlodevToolsCard } from "../cute-tools.ts";
import type { CinlodevEngramCard, CinlodevEngramHandoffCard } from "../cute-engram.ts";
import type { CinlodevPersistentMemoryCard } from "../cute-persistent-memory.ts";
import type { CinlodevProjectTreeCard } from "../cute-tree.ts";
import { resetGitFileChangesCache } from "../cute-git-graph.ts";
import { resetUsageCache } from "../cute-usage.ts";

export interface FooterRegistryState {
	todoHooksInstalled: boolean;
	latestTodoTui?: TUI;
	latestTodoMirror?: CinlodevTodoMirror;
	latestGitGraph?: CinlodevGitGraphCard;
	latestWorkingTree?: CinlodevWorkingTreeCard;
	latestToolsCard?: CinlodevToolsCard;
	latestEngramCard?: CinlodevEngramCard;
	latestEngramHandoff?: CinlodevEngramHandoffCard;
	latestPersistentMemory?: CinlodevPersistentMemoryCard;
	latestMemoryGraph?: CinlodevPersistentMemoryCard;
	latestProjectTree?: CinlodevProjectTreeCard;
}

export const footerRegistry: FooterRegistryState = {
	todoHooksInstalled: false,
};

export function getLatestTodoMirror(): CinlodevTodoMirror | undefined {
	return footerRegistry.latestTodoMirror;
}

export function invalidateSidebarGitAndTree(): void {
	resetGitFileChangesCache();
	resetUsageCache();
	footerRegistry.latestGitGraph?.invalidate();
	footerRegistry.latestWorkingTree?.invalidate();
	footerRegistry.latestPersistentMemory?.invalidate();
	footerRegistry.latestMemoryGraph?.invalidate();
	footerRegistry.latestProjectTree?.invalidate();
	footerRegistry.latestToolsCard?.invalidate();
	footerRegistry.latestTodoTui?.requestRender();
}
