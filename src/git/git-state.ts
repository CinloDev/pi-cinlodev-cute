import type { TUI } from "@earendil-works/pi-tui";

export interface GitTabState {
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
