import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cuteGlyphs, safeFg, bolden } from "./cute-theme.ts";

export interface CuteSidebarTab {
	id: string;
	key: string;
	label: string;
	title?: string;
	cards: string[];
}

export const SIDEBAR_TAB_CARD_MAP: Record<string, string[]> = {
	main: ["footer", "context", "todo"],
	git: ["gitGraph", "workingTree"],
	agents: ["cute-agents"],
	usage: ["cute-agents"],
	prof: ["cute-profiles"],
	forge: ["cute-profiles"],
	mem: ["engram", "engramHandoff", "tools"],
	tree: ["projectTree"],
	todo: ["todo"],
};

export const CUTE_SIDEBAR_TABS: readonly CuteSidebarTab[] = [
	{ id: "main", key: "1", label: "MAIN", title: "Main Dashboard", cards: SIDEBAR_TAB_CARD_MAP.main },
	{ id: "git", key: "2", label: "GIT", title: "Git Graph & Working Tree", cards: SIDEBAR_TAB_CARD_MAP.git },
	{ id: "agents", key: "3", label: "AGENTS", title: "Orchestrator & Subagents", cards: SIDEBAR_TAB_CARD_MAP.agents },
	{ id: "prof", key: "4", label: "PROF", title: "Profiles & Clusters", cards: SIDEBAR_TAB_CARD_MAP.prof },
	{ id: "mem", key: "5", label: "MEM", title: "Memory & Tools", cards: SIDEBAR_TAB_CARD_MAP.mem },
	{ id: "tree", key: "6", label: "TREE", title: "Project Tree & Explorer", cards: SIDEBAR_TAB_CARD_MAP.tree },
	{ id: "todo", key: "7", label: "TODO", title: "Todos & Task Checklist", cards: SIDEBAR_TAB_CARD_MAP.todo },
];

export function resolveSidebarTab(tabIdOrKey?: string): CuteSidebarTab {
	if (tabIdOrKey) {
		let normalized = tabIdOrKey.toLowerCase();
		if (normalized === "forge") normalized = "prof";
		if (normalized === "usage") normalized = "agents";
		if (normalized === "projecttree" || normalized === "project-tree") normalized = "tree";
		if (normalized === "todo" || normalized === "todos" || normalized === "task" || normalized === "tasks") normalized = "todo";
		const match = CUTE_SIDEBAR_TABS.find(
			(t) => t.id === normalized || t.key === normalized || t.label.toLowerCase() === normalized
		);
		if (match) return match;
	}
	return CUTE_SIDEBAR_TABS[0];
}

export interface TabHitbox {
	id: string;
	key: string;
	label: string;
	startX: number;
	endX: number;
}

export function renderCuteSidebarTabBar(
	width: number,
	activeTabId: string,
	theme?: Theme,
	gitSyncBadge?: string,
): { line: string; divider: string; hitboxes: TabHitbox[] } {
	const activeTab = resolveSidebarTab(activeTabId);
	const hitboxes: TabHitbox[] = [];

	const dim = (s: string): string => (theme ? safeFg(theme, "dim", s) : s);
	const muted = (s: string): string => (theme ? safeFg(theme, "muted", s) : s);
	const pinkBright = (s: string): string => (theme ? safeFg(theme, "pinkBright", s) : s);
	const subtle = (s: string): string => (theme ? safeFg(theme, "borderMuted", s) : s);
	const warning = (s: string): string => (theme ? safeFg(theme, "warning", s) : s);

	const compactActive = width < 48;

	const tabVisuals = CUTE_SIDEBAR_TABS.map((tab) => {
		const isActive = tab.id === activeTab.id;
		const extraSuffix = tab.id === "git" && gitSyncBadge ? ` ${gitSyncBadge}` : "";

		if (isActive) {
			const label = compactActive
				? `[${tab.key}:${tab.label}${extraSuffix}]`
				: `[ ${tab.key}:${tab.label}${extraSuffix} ]`;
			const styled = pinkBright(bolden(theme, label));
			return { tab, isActive, styled, len: visibleWidth(label) };
		} else {
			const label = `${tab.key}:${tab.label}${extraSuffix}`;
			const badgeStyled = extraSuffix ? warning(extraSuffix) : "";
			const styled = `${dim(tab.key)}${dim(":")}${muted(tab.label)}${badgeStyled}`;
			return { tab, isActive, styled, len: visibleWidth(label) };
		}
	});

	const totalTabLen = tabVisuals.reduce((acc, t) => acc + t.len, 0);
	const gapsCount = CUTE_SIDEBAR_TABS.length - 1;
	const remaining = Math.max(0, width - totalTabLen);
	const baseGap = gapsCount > 0 ? Math.floor(remaining / gapsCount) : 0;
	let extraSpaces = gapsCount > 0 ? remaining % gapsCount : 0;

	let currentX = 0;
	const parts: string[] = [];

	for (let i = 0; i < tabVisuals.length; i++) {
		const item = tabVisuals[i];
		const startX = currentX;
		const endX = currentX + item.len;
		hitboxes.push({
			id: item.tab.id,
			key: item.tab.key,
			label: item.tab.label,
			startX,
			endX,
		});
		parts.push(item.styled);
		currentX = endX;

		if (i < gapsCount) {
			const gap = baseGap + (extraSpaces > 0 ? 1 : 0);
			if (extraSpaces > 0) extraSpaces--;
			if (gap > 0) {
				parts.push(" ".repeat(gap));
				currentX += gap;
			}
		}
	}

	if (currentX < width) {
		parts.push(" ".repeat(width - currentX));
	}

	const glyphs = cuteGlyphs(theme);
	const sepChar = glyphs.frameStyle === "ascii" || glyphs.h === "-" ? "-" : "─";
	const divider = subtle(sepChar.repeat(Math.max(0, width)));

	let line = parts.join("");
	if (width < totalTabLen || visibleWidth(line) > width) {
		line = truncateToWidth(line, Math.max(0, width));
	}

	const validHitboxes = hitboxes
		.filter((h) => h.startX < width)
		.map((h) => ({
			...h,
			endX: Math.min(h.endX, width),
		}));

	return {
		line,
		divider,
		hitboxes: validHitboxes,
	};
}
