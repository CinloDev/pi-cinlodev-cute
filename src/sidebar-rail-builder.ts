import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg, unifySidebarCardFrame } from "./cute-theme.ts";
import { loadCuteLayout } from "./cute-layout.ts";
import { CinlodevProfilesExtendedCard } from "./cute-profiles.ts";
import { CinlodevGitGraphCard, CinlodevWorkingTreeCard, getGitSyncBadge } from "./cute-git-graph.ts";
import { CinlodevEngramHandoffCard } from "./cute-engram.ts";
import { CinlodevProjectTreeCard } from "./cute-tree.ts";
import { CinlodevMemoryGraphCard } from "./cute-memory-graph.ts";
import { CinlodevYouTubeCard } from "./cute-youtube.ts";
import { measureDockMetrics } from "./sidebar-dock.ts";
import { renderCUTESidebarBanner } from "./sidebar-state.ts";
import {
	resolveSidebarTab,
	renderCuteSidebarTabBar,
	type TabHitbox,
} from "./sidebar-tabs.ts";
import type { SectionMapping } from "./sidebar-mouse.ts";

export interface RailBuildResult {
	success: boolean;
	railLines: string[];
	sectionMappings: SectionMapping[];
	tabHitboxes: TabHitbox[];
	tabBarLineIndex: number;
	tabBarDividerLineIndex: number;
}

export interface RailBuilderContext {
	state: any;
	tui: TUI;
	theme?: Theme;
	activeDock: any;
	activeTranscript: any;
	contentWidth: number;
}

/**
 * Builds the complete formatted lines of the CUTE sidebar rail:
 * - Calculates heights dynamically down to prompt line (split 50/50 for 2 cards, full height for single/todo)
 * - Lazily instantiates any unmounted cards
 * - Renders CUTE banner, TabBar, cards and hitboxes
 */
export function buildSidebarRailLines(ctx: RailBuilderContext): RailBuildResult {
	const { state, tui, theme, activeDock, activeTranscript, contentWidth } = ctx;
	const layout = loadCuteLayout().sidebar;
	const netWidth = contentWidth - layout.railPadding * 2;
	const tabsEnabled = layout.tabsEnabled !== false;
	const activeTab = resolveSidebarTab(state.activeTabId ?? layout.defaultTab);
	state.activeTabId = activeTab.id;

	const targetCardKeys = !tabsEnabled
		? ["footer", "context", "engram", "gitGraph", "tools", "cute-profiles", "todo"]
		: activeTab.cards;

	const branding = renderCUTESidebarBanner(netWidth, theme);
	const bannerLinesCount = (branding && branding.length) ? branding.length + 1 : 0;
	const tabsLinesCount = tabsEnabled ? 2 : 0;
	const headerLines = 1 + bannerLinesCount + tabsLinesCount + 1;

	let availableCardHeight: number | undefined;
	let cardHeights: (number | undefined)[] = [];
	const termRows = tui.terminal?.rows ?? loadCuteLayout().sidebar.fallbackRows ?? 45;
	const dockWidth = Math.max(10, (tui.terminal?.columns ?? 100) - layout.railWidth);
	const { totalHeight: dockHeight, visibleInputBottomOffset } = measureDockMetrics(activeDock, dockWidth);
	const transcriptHeight = activeTranscript?.viewportHeight;

	const inputBottomRow = (typeof transcriptHeight === "number" && transcriptHeight > 10)
		? transcriptHeight + visibleInputBottomOffset
		: Math.max(15, termRows - dockHeight + visibleInputBottomOffset);

	const maxAllowedHeight = Math.max(10, termRows - headerLines);
	const targetHeight = inputBottomRow - headerLines;
	const totalTargetHeight = Math.min(maxAllowedHeight, Math.max(10, targetHeight));

	if (targetCardKeys.length === 1) {
		availableCardHeight = totalTargetHeight;
		cardHeights = [totalTargetHeight];
	} else if (targetCardKeys.length === 2) {
		const interCardGap = 1;
		const availableForCards = Math.max(14, totalTargetHeight - interCardGap);
		const half = Math.floor(availableForCards / 2);
		const secondHalf = availableForCards - half;
		cardHeights = [half, secondHalf];
	} else if (targetCardKeys.includes("todo")) {
		let priorLines = 0;
		for (const key of targetCardKeys) {
			if (key === "todo") break;
			const comp = state.parts.get(key);
			const raw = [...(comp?.render(netWidth) ?? [])];
			while (raw.length && raw[raw.length - 1]?.trim() === "") raw.pop();
			if (raw.length > 0) {
				priorLines += raw.length + 1;
			}
		}
		const remainingForTodo = Math.max(loadCuteLayout().todos.railMaxRows, totalTargetHeight - priorLines);
		availableCardHeight = remainingForTodo;
		const todoIndex = targetCardKeys.indexOf("todo");
		cardHeights[todoIndex] = remainingForTodo;
	}

	const sectionData = targetCardKeys
		.map((key, index) => {
			let component = state.parts.get(key);
			if (
				!component &&
				(key === "cute-profiles" || key === "cute-profiles-extended" || key === "profiles")
			) {
				component =
					state.parts.get("cute-profiles") ||
					state.parts.get("cute-profiles-extended") ||
					state.parts.get("profiles");
				if (!component) {
					component = new CinlodevProfilesExtendedCard(tui, theme);
					state.parts.set("cute-profiles", component);
				}
			}
			if (!component && (key === "gitGraph" || key === "git-graph")) {
				component = state.parts.get("gitGraph") || state.parts.get("git-graph");
				if (!component) {
					component = new CinlodevGitGraphCard(undefined as any, tui, theme);
					state.parts.set("gitGraph", component);
				}
			}
			if (!component && (key === "workingTree" || key === "working-tree")) {
				component = state.parts.get("workingTree") || state.parts.get("working-tree");
				if (!component) {
					component = new CinlodevWorkingTreeCard(undefined as any, tui, theme);
					state.parts.set("workingTree", component);
				}
			}
			if (!component && (key === "engramHandoff" || key === "engram-handoff")) {
				component = state.parts.get("engramHandoff") || state.parts.get("engram-handoff");
				if (!component) {
					component = new CinlodevEngramHandoffCard(undefined as any, tui, theme);
					state.parts.set("engramHandoff", component);
				}
			}
			if (!component && (key === "projectTree" || key === "project-tree")) {
				component = state.parts.get("projectTree") || state.parts.get("project-tree");
				if (!component) {
					component = new CinlodevProjectTreeCard(undefined as any, tui, theme);
					state.parts.set("projectTree", component);
				}
			}
			if (!component && (key === "memoryGraph" || key === "memory-graph")) {
				component = state.parts.get("memoryGraph") || state.parts.get("memory-graph");
				if (!component) {
					component = new CinlodevMemoryGraphCard(undefined, tui, theme);
					state.parts.set("memoryGraph", component);
				}
			}
			if (!component && (key === "youtubePlayer" || key === "youtube-player" || key === "yt")) {
				component = state.parts.get("youtubePlayer") || state.parts.get("youtube-player") || state.parts.get("yt");
				if (!component) {
					component = new CinlodevYouTubeCard(tui, theme);
					state.parts.set("youtubePlayer", component);
				}
			}
			const renderHeight = (targetCardKeys.length === 1 || targetCardKeys.length === 2 || key === "projectTree" || key === "project-tree" || key === "todo")
				? (cardHeights[index] ?? availableCardHeight)
				: undefined;
			const rawLines = [...(component?.render(netWidth, renderHeight as any) ?? [])];
			while (rawLines.length && rawLines[rawLines.length - 1]?.trim() === "") rawLines.pop();
			const lines =
				key !== "footer" &&
				key !== "context" &&
				key !== "todo" &&
				key !== "engram" &&
				key !== "engramHandoff" &&
				key !== "engram-handoff" &&
				key !== "usage" &&
				key !== "gitGraph" &&
				key !== "workingTree" &&
				key !== "working-tree" &&
				key !== "tools" &&
				key !== "cute-profiles" &&
				key !== "cute-profiles-extended" &&
				key !== "profiles" &&
				key !== "memoryGraph" &&
				key !== "memory-graph" &&
				key !== "projectTree" &&
				key !== "project-tree" &&
				key !== "youtubePlayer" &&
				key !== "youtube-player" &&
				key !== "yt"
					? rawLines.map((line) => unifySidebarCardFrame(line, theme))
					: rawLines;
			return { key, component, lines };
		})
		.filter((s) => s.lines.length > 0);

	let railLines: string[] = [""];
	const sectionMappings: SectionMapping[] = [];
	let tabHitboxes: TabHitbox[] = [];
	let tabBarLineIndex = -1;
	let tabBarDividerLineIndex = -1;

	if (!tabsEnabled) {
		if (sectionData.length && branding.length) {
			railLines.push(...branding.map((line) => " ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding)));
			railLines.push("");
		}

		for (let i = 0; i < sectionData.length; i++) {
			if (i > 0) {
				railLines.push("");
			}
			const s = sectionData[i];
			const startLine = railLines.length;
			for (const line of s.lines) {
				railLines.push(" ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding));
			}
			sectionMappings.push({
				key: s.key,
				component: s.component,
				startLine,
				lineCount: s.lines.length,
			});
		}

		if (!railLines.length || !sectionData.length || railLines.some((line) => visibleWidth(line) > contentWidth)) {
			return { success: false, railLines: [], sectionMappings: [], tabHitboxes: [], tabBarLineIndex: -1, tabBarDividerLineIndex: -1 };
		}
		return { success: true, railLines, sectionMappings, tabHitboxes: [], tabBarLineIndex: -1, tabBarDividerLineIndex: -1 };
	}

	// Tabs enabled flow
	if (branding.length) {
		railLines.push(...branding.map((line) => " ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding)));
		railLines.push("");
	}

	const cwd = (tui as any)?.cwd ?? process.cwd();
	const gitSyncBadge = getGitSyncBadge(cwd);
	const { line: tabLine, divider: dividerLine, hitboxes } = renderCuteSidebarTabBar(netWidth, activeTab.id, theme, gitSyncBadge);
	tabBarLineIndex = railLines.length;
	railLines.push(" ".repeat(layout.railPadding) + tabLine + " ".repeat(layout.railPadding));
	tabBarDividerLineIndex = railLines.length;
	railLines.push(" ".repeat(layout.railPadding) + dividerLine + " ".repeat(layout.railPadding));
	tabHitboxes = hitboxes;

	if (sectionData.length === 0) {
		railLines.push("");
		const dim = (s: string): string => (theme ? safeFg(theme, "dim", s) : s);
		const emptyMsg = dim("Sin información disponible en esta pestaña.");
		const pad = Math.max(0, Math.floor((netWidth - visibleWidth(emptyMsg)) / 2));
		railLines.push(" ".repeat(layout.railPadding + pad) + emptyMsg);
	} else {
		railLines.push("");
		for (let i = 0; i < sectionData.length; i++) {
			if (i > 0) {
				railLines.push("");
			}
			const s = sectionData[i];
			const startLine = railLines.length;
			for (const line of s.lines) {
				railLines.push(" ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding));
			}
			sectionMappings.push({
				key: s.key,
				component: s.component,
				startLine,
				lineCount: s.lines.length,
			});
		}
	}

	if (!railLines.length || railLines.some((line) => visibleWidth(line) > contentWidth)) {
		return { success: false, railLines: [], sectionMappings: [], tabHitboxes: [], tabBarLineIndex: -1, tabBarDividerLineIndex: -1 };
	}

	return {
		success: true,
		railLines,
		sectionMappings,
		tabHitboxes,
		tabBarLineIndex,
		tabBarDividerLineIndex,
	};
}
