import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { installSidebar, sidebarPart } from "./sidebar.ts";
import { CinlodevTodoMirror } from "./todos.ts";
import { CinlodevGitGraphCard, CinlodevWorkingTreeCard } from "./cute-git-graph.ts";
import { CinlodevToolsCard } from "./cute-tools.ts";
import { CinlodevUsageCard, CinlodevClueCard } from "./cute-usage.ts";
import { CinlodevEngramCard, CinlodevEngramHandoffCard } from "./cute-engram.ts";
import { CinlodevPersistentMemoryCard } from "./cute-persistent-memory.ts";
import { tuneTuiScroll } from "./cute-layout.ts";
import { formatTokenCount, getContextThreshold } from "./cute-metrics.ts";
import { CinlodevProfilesExtendedCard } from "./cute-profiles.ts";
import { CinlodevProjectTreeCard } from "./cute-tree.ts";
import { CinlodevYouTubeCard } from "./cute-youtube.ts";
import { sidebarState } from "./sidebar-state.ts";

import {
	separator,
	gaugeGlyphs,
	prettifyExtraStatus,
	shortModelName,
	sessionCost,
	formatCost,
	renderGauge,
} from "./footer/footer-formatters.ts";

import {
	footerRegistry,
	getLatestTodoMirror,
	toggleUsageCard,
	isUsageCardVisible,
	getLatestUsageCard,
	invalidateSidebarGitAndTree,
} from "./footer/footer-registry.ts";

import { CinlodevCuteFooter } from "./footer/footer-component.ts";
import { CinlodevCuteContextCard } from "./footer/footer-context-card.ts";

export {
	formatTokenCount,
	getContextThreshold,
	separator,
	gaugeGlyphs,
	prettifyExtraStatus,
	shortModelName,
	sessionCost,
	formatCost,
	renderGauge,
	getLatestTodoMirror,
	toggleUsageCard,
	isUsageCardVisible,
	getLatestUsageCard,
	invalidateSidebarGitAndTree,
	CinlodevCuteFooter,
	CinlodevCuteContextCard,
};

export function installCinlodevFooter(ctx: ExtensionContext, pi: ExtensionAPI): void {
	if (!ctx.hasUI) return;
	if (!footerRegistry.todoHooksInstalled) {
		footerRegistry.todoHooksInstalled = true;
		const refreshTodos = () => {
			try {
				footerRegistry.latestGitGraph?.invalidate();
				footerRegistry.latestWorkingTree?.invalidate();
				footerRegistry.latestToolsCard?.invalidate();
				footerRegistry.latestUsageCard?.invalidate();
				footerRegistry.latestEngramCard?.invalidate();
				footerRegistry.latestEngramHandoff?.invalidate();
				footerRegistry.latestMemoryGraph?.invalidate();
				footerRegistry.latestTodoMirror?.invalidate();
				if (footerRegistry.latestTodoTui && (footerRegistry.latestTodoTui as any).__cuteTodoRail) {
					const state = sidebarState(footerRegistry.latestTodoTui);
					state.parts.set("todo", (footerRegistry.latestTodoTui as any).__cuteTodoRail);
				}
				footerRegistry.latestTodoTui?.requestRender();
			} catch {}
		};
		pi.on("session_start", refreshTodos);
		pi.on("turn_end", refreshTodos);
		pi.on("tool_execution_end", refreshTodos);
		pi.on("entry_appended", refreshTodos);
		pi.on("message_end", refreshTodos);
	}

	ctx.ui.setFooter((tui, theme, footerData) => {
		tuneTuiScroll(tui);
		(tui as any).__cutePi = pi;
		const bottom = new CinlodevCuteFooter(pi, ctx, tui, theme, footerData);
		const contextCard = new CinlodevCuteContextCard(ctx, theme);
		const engramCard = new CinlodevEngramCard(ctx, tui, theme);
		const engramHandoff = new CinlodevEngramHandoffCard(ctx, tui, theme);
		const persistentMemory = new CinlodevPersistentMemoryCard(ctx, tui, theme, undefined, pi);
		const memoryGraph = persistentMemory;
		const usageCard = new CinlodevUsageCard(ctx, tui, theme);
		const clueCard = new CinlodevClueCard(ctx, tui, theme);
		const gitGraph = new CinlodevGitGraphCard(ctx, tui, theme);
		const workingTree = new CinlodevWorkingTreeCard(ctx, tui, theme);
		const toolsCard = new CinlodevToolsCard(ctx, tui, theme);
		const todos = new CinlodevTodoMirror(ctx, tui, theme);

		footerRegistry.latestTodoTui = tui;
		footerRegistry.latestTodoMirror = todos;
		(tui as any).__cuteTodoMirror = todos;
		(ctx as any).__cuteTodoMirror = todos;
		(tui as any).__cuteCtx = ctx;
		footerRegistry.latestGitGraph = gitGraph;
		footerRegistry.latestWorkingTree = workingTree;
		footerRegistry.latestToolsCard = toolsCard;
		footerRegistry.latestUsageCard = usageCard;
		footerRegistry.latestEngramCard = engramCard;
		footerRegistry.latestEngramHandoff = engramHandoff;
		footerRegistry.latestPersistentMemory = persistentMemory;
		footerRegistry.latestMemoryGraph = memoryGraph;

		const rail = {
			render: (width: number) => bottom.renderSidebarCard(width),
			invalidate: () => bottom.invalidate(),
			handleRailClick: (lineIndex: number) => bottom.handleCardClick(lineIndex),
			isProfileDropdownOpen: () => bottom.isProfileDropdownOpen(),
			closeProfileDropdown: () => bottom.closeProfileDropdown(),
		};
		const contextRail = {
			render: (width: number) => contextCard.render(width),
			invalidate: () => contextCard.invalidate(),
		};
		const engramRail = {
			render: (width: number) => engramCard.render(width),
			invalidate: () => engramCard.invalidate(),
			handleRailClick: (lineIndex: number) => engramCard.handleClick(lineIndex),
		};
		const usageRail = {
			render: (width: number) => usageCard.render(width),
			invalidate: () => usageCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string) => usageCard.handleClick(lineIndex, button),
			handleRailWheel: (delta: number) => usageCard.handleWheel(delta),
		};
		const clueRail = {
			render: (width: number) => clueCard.render(width),
			invalidate: () => clueCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string) => clueCard.handleClick(lineIndex, button),
		};
		const gitGraphRail = {
			render: (width: number, availableHeight?: number) => gitGraph.render(width, availableHeight),
			invalidate: () => gitGraph.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				typeof gitGraph.handleRailClick === "function"
					? gitGraph.handleRailClick(lineIndex, button, localX)
					: gitGraph.handleClick(lineIndex),
			handleRailWheel: (delta: number) =>
				typeof gitGraph.handleRailWheel === "function" ? gitGraph.handleRailWheel(delta) : false,
		};
		const workingTreeRail = {
			render: (width: number, availableHeight?: number) => workingTree.render(width, availableHeight),
			invalidate: () => workingTree.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				typeof workingTree.handleRailClick === "function"
					? workingTree.handleRailClick(lineIndex, button, localX)
					: workingTree.handleClick(lineIndex),
			handleRailWheel: (delta: number) =>
				typeof workingTree.handleRailWheel === "function" ? workingTree.handleRailWheel(delta) : false,
		};
		const engramHandoffRail = {
			render: (width: number) => engramHandoff.render(width),
			invalidate: () => engramHandoff.invalidate(),
			handleRailClick: () => engramHandoff.handleClick(),
		};
		const memoryGraphRail = {
			render: (width: number) => memoryGraph.render(width),
			invalidate: () => memoryGraph.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				memoryGraph.handleRailClick(lineIndex, button, localX),
		};
		const toolsRail = {
			render: (width: number) => toolsCard.render(width),
			invalidate: () => toolsCard.invalidate(),
		};
		const profilesCard = new CinlodevProfilesExtendedCard(tui, theme, undefined, ctx, pi);
		const profilesRail = {
			render: (width: number, availableHeight?: number) => profilesCard.render(width, availableHeight),
			invalidate: () => profilesCard.invalidate?.(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				profilesCard.handleRailClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => profilesCard.handleRailWheel(delta),
		};
		const projectTreeCard = new CinlodevProjectTreeCard(ctx, tui, theme);
		footerRegistry.latestProjectTree = projectTreeCard;
		const projectTreeRail = {
			render: (width: number, availableHeight?: number) => projectTreeCard.render(width, availableHeight),
			invalidate: () => projectTreeCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				projectTreeCard.handleRailClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => projectTreeCard.handleWheel(delta),
		};

		const part = sidebarPart(tui, "footer", bottom, rail);
		const contextPart = sidebarPart(tui, "context", { render: () => [] }, contextRail);
		const engramPart = sidebarPart(tui, "engram", { render: () => [] }, engramRail);
		const engramHandoffPart = sidebarPart(tui, "engramHandoff", { render: () => [] }, engramHandoffRail);
		const persistentMemoryPart = sidebarPart(tui, "persistentMemory", { render: () => [] }, memoryGraphRail);
		const memoryGraphPart = sidebarPart(tui, "memoryGraph", { render: () => [] }, memoryGraphRail);
		const usagePart = sidebarPart(tui, "usage", { render: () => [] }, usageRail);
		const cluePart = sidebarPart(tui, "clue", { render: () => [] }, clueRail);
		const gitGraphPart = sidebarPart(tui, "gitGraph", { render: () => [] }, gitGraphRail);
		const workingTreePart = sidebarPart(tui, "workingTree", { render: () => [] }, workingTreeRail);
		const toolsPart = sidebarPart(tui, "tools", { render: () => [] }, toolsRail);
		const profilesPart = sidebarPart(tui, "cute-profiles", { render: () => [] }, profilesRail);
		const projectTreePart = sidebarPart(tui, "projectTree", { render: () => [] }, projectTreeRail);
		const youtubePlayerCard = new CinlodevYouTubeCard(tui, theme, ctx);
		const youtubePlayerRail = {
			render: (width: number, availableHeight?: number) => youtubePlayerCard.render(width, availableHeight),
			invalidate: () => youtubePlayerCard.invalidate(),
			handleRailClick: (lineIndex: number, button?: string, localX?: number) =>
				youtubePlayerCard.handleRailClick(lineIndex, button, localX),
			handleRailWheel: (delta: number) => youtubePlayerCard.handleRailWheel(delta),
		};
		const youtubePlayerPart = sidebarPart(tui, "youtubePlayer", { render: () => [] }, youtubePlayerRail);

		const todoBottom: Component & { dispose?(): void } = {
			render: (width: number) => todos.renderBottom(width),
			invalidate: () => todos.invalidate(),
		};
		const todoRail: Component & { dispose?(): void; handleRailWheel?(delta: number): boolean } = {
			render: (width: number, availableHeight?: number) => todos.renderRail(width, availableHeight),
			invalidate: () => todos.invalidate(),
			handleRailWheel: (delta: number) => todos.handleRailWheel(delta),
		};
		(tui as any).__cuteTodoRail = todoRail;
		const todoPart = sidebarPart(tui, "todo", todoBottom, todoRail);
		const uninstall = installSidebar(tui, theme);

		return {
			...part,
			...cluePart,
			dispose() {
				uninstall();
				part.dispose?.();
				contextPart.dispose?.();
				cluePart.dispose?.();
				engramPart.dispose?.();
				engramHandoffPart.dispose?.();
				persistentMemoryPart.dispose?.();
				memoryGraphPart.dispose?.();
				usagePart.dispose?.();
				gitGraphPart.dispose?.();
				workingTreePart.dispose?.();
				toolsPart.dispose?.();
				profilesPart.dispose?.();
				projectTreePart.dispose?.();
				youtubePlayerPart.dispose?.();
				youtubePlayerCard.dispose?.();
				todoPart.dispose?.();
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installCinlodevFooter(ctx, pi);
	});
}
