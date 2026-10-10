import type { TUI } from "@earendil-works/pi-tui";
import type { CinlodevTodoMirror } from "../todos.ts";
import type { CinlodevGitGraphCard, CinlodevWorkingTreeCard } from "../cute-git-graph.ts";
import type { CinlodevToolsCard } from "../cute-tools.ts";
import type { CinlodevUsageCard } from "../cute-usage.ts";
import type { CinlodevEngramCard, CinlodevEngramHandoffCard } from "../cute-engram.ts";
import type { CinlodevMemoryGraphCard } from "../cute-memory-graph.ts";
import type { CinlodevProjectTreeCard } from "../cute-tree.ts";
import { resetGitFileChangesCache } from "../cute-git-graph.ts";

export interface FooterRegistryState {
	todoHooksInstalled: boolean;
	latestTodoTui?: TUI;
	latestTodoMirror?: CinlodevTodoMirror;
	latestGitGraph?: CinlodevGitGraphCard;
	latestWorkingTree?: CinlodevWorkingTreeCard;
	latestToolsCard?: CinlodevToolsCard;
	latestUsageCard?: CinlodevUsageCard;
	latestEngramCard?: CinlodevEngramCard;
	latestEngramHandoff?: CinlodevEngramHandoffCard;
	latestMemoryGraph?: CinlodevMemoryGraphCard;
	latestProjectTree?: CinlodevProjectTreeCard;
}

export const footerRegistry: FooterRegistryState = {
	todoHooksInstalled: false,
};

export function getLatestTodoMirror(): CinlodevTodoMirror | undefined {
	return footerRegistry.latestTodoMirror;
}

export function toggleUsageCard(): boolean {
	return footerRegistry.latestUsageCard?.toggle() ?? false;
}

export function isUsageCardVisible(): boolean {
	return footerRegistry.latestUsageCard?.isVisible() ?? false;
}

export function getLatestUsageCard(): CinlodevUsageCard | undefined {
	return footerRegistry.latestUsageCard;
}

export function invalidateSidebarGitAndTree(): void {
	resetGitFileChangesCache();
	footerRegistry.latestGitGraph?.invalidate();
	footerRegistry.latestWorkingTree?.invalidate();
	footerRegistry.latestProjectTree?.invalidate();
	footerRegistry.latestToolsCard?.invalidate();
	footerRegistry.latestTodoTui?.requestRender();
}
