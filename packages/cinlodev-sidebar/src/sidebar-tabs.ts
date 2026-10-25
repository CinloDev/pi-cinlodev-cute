import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CardTheme } from "./card-frame.ts";

export interface SidebarTab {
	id: string;
	key: string;
	label: string;
	title: string;
	cards: string[];
}

export const SIDEBAR_TAB_CARD_MAP: Record<string, string[]> = {
	main: ["status", "todo"],
	git: ["gitGraph", "workingTree"],
	mem: ["engram", "tools"],
	tree: ["projectTree"],
};

export const SIDEBAR_TABS: readonly SidebarTab[] = [
	{ id: "main", key: "1", label: "MAIN", title: "Principal", cards: SIDEBAR_TAB_CARD_MAP.main },
	{ id: "git", key: "2", label: "GIT", title: "Git Graph & Working Tree", cards: SIDEBAR_TAB_CARD_MAP.git },
	{ id: "mem", key: "3", label: "MEM", title: "Memoria & Herramientas", cards: SIDEBAR_TAB_CARD_MAP.mem },
	{ id: "tree", key: "4", label: "TREE", title: "Árbol de Proyecto", cards: SIDEBAR_TAB_CARD_MAP.tree },
];

export function resolveSidebarTab(tabIdOrKey?: string): SidebarTab {
	if (tabIdOrKey) {
		const normalized = tabIdOrKey.toLowerCase().trim();
		const match = SIDEBAR_TABS.find(
			(t) => t.id === normalized || t.key === normalized || t.label.toLowerCase() === normalized,
		);
		if (match) return match;
	}
	return SIDEBAR_TABS[0]!;
}

export interface TabHitbox {
	id: string;
	key: string;
	label: string;
	startX: number;
	endX: number;
}

export interface TabBarRenderResult {
	line: string;
	divider: string;
	hitboxes: TabHitbox[];
}

export function renderSidebarTabBar(
	width: number,
	activeTabId: string,
	theme?: CardTheme,
): TabBarRenderResult {
	const activeTab = resolveSidebarTab(activeTabId);
	const hitboxes: TabHitbox[] = [];

	const dim = (s: string) => (theme?.fg ? theme.fg("dim", s) : s);
	const muted = (s: string) => (theme?.fg ? theme.fg("muted", s) : s);
	const accent = (s: string) => (theme?.fg ? (theme?.bold ? theme.bold(theme.fg("accent", s)) : theme.fg("accent", s)) : s);
	const borderMuted = (s: string) => (theme?.fg ? theme.fg("border", s) : s);

	const compactActive = width < 42;

	const tabVisuals = SIDEBAR_TABS.map((tab) => {
		const isActive = tab.id === activeTab.id;
		if (isActive) {
			const text = compactActive ? `[${tab.key}:${tab.label}]` : `[ ${tab.key}:${tab.label} ]`;
			const styled = accent(text);
			return { tab, isActive, styled, len: visibleWidth(text) };
		}
		const text = `${tab.key}:${tab.label}`;
		const styled = `${dim(tab.key)}${dim(":")}${muted(tab.label)}`;
		return { tab, isActive, styled, len: visibleWidth(text) };
	});

	const totalTabLen = tabVisuals.reduce((acc, t) => acc + t.len, 0);
	const gapsCount = SIDEBAR_TABS.length - 1;
	const remaining = Math.max(0, width - totalTabLen);
	const baseGap = gapsCount > 0 ? Math.floor(remaining / gapsCount) : 0;
	let extraSpaces = gapsCount > 0 ? remaining % gapsCount : 0;

	let currentX = 0;
	const parts: string[] = [];

	for (let i = 0; i < tabVisuals.length; i++) {
		const item = tabVisuals[i]!;
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

	const line = truncateToWidth(parts.join(""), width, "");
	const divider = borderMuted("─".repeat(Math.max(1, width)));

	return { line, divider, hitboxes };
}
