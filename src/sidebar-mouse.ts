import type { TUI } from "@earendil-works/pi-tui";
import { loadCuteLayout } from "./cute-layout.ts";
import {
	CUTE_SIDEBAR_TABS,
	resolveSidebarTab,
	type TabHitbox,
} from "./sidebar-tabs.ts";

export interface SectionMapping {
	key: string;
	component: any;
	startLine: number;
	lineCount: number;
}

export interface SidebarMouseContext {
	scroll: any;
	state: any;
	tui: TUI;
	getSectionMappings: () => SectionMapping[];
	getTabHitboxes: () => TabHitbox[];
	getTabBarLineIndex: () => number;
	getTabBarDividerLineIndex: () => number;
	nativeMouse: (event: any) => any;
}

/**
 * Creates the high-performance mouse event interceptor for the CUTE sidebar rail:
 * - TabBar clicking and wheel cycling
 * - Card-specific wheel scrolling delegation (handleRailWheel)
 * - Card-specific click delegation (handleRailClick)
 * - Footer dropdown auto-closing when clicking outside
 */
export function createSidebarMouseHandler(ctx: SidebarMouseContext): (event: any) => any {
	const {
		scroll,
		state,
		tui,
		getSectionMappings,
		getTabHitboxes,
		getTabBarLineIndex,
		getTabBarDividerLineIndex,
		nativeMouse,
	} = ctx;

	return (event: any) => {
		const scrollTop = (scroll as any).currentScrollTop ?? 0;
		const targetLine = event.y + scrollTop;
		const layout = loadCuteLayout().sidebar;
		const sectionMappings = getSectionMappings();
		const tabHitboxes = getTabHitboxes();
		const tabBarLineIndex = getTabBarLineIndex();
		const tabBarDividerLineIndex = getTabBarDividerLineIndex();

		// 0. Wheel over TabBar to cycle tabs
		if (event.type === "wheel") {
			if (
				layout.tabsEnabled !== false &&
				tabBarLineIndex >= 0 &&
				(targetLine === tabBarLineIndex || targetLine === tabBarDividerLineIndex) &&
				event.wheelDelta !== 0
			) {
				const currentTab = resolveSidebarTab(state.activeTabId ?? layout.defaultTab);
				const currentIndex = CUTE_SIDEBAR_TABS.findIndex((t) => t.id === currentTab.id);
				const delta = event.wheelDelta > 0 ? 1 : -1;
				const nextIndex = (currentIndex + delta + CUTE_SIDEBAR_TABS.length) % CUTE_SIDEBAR_TABS.length;
				state.activeTabId = CUTE_SIDEBAR_TABS[nextIndex].id;
				tui.requestRender();
				return { handled: true, render: true };
			}

			// 1. Wheel scroll over interactive rail cards (fast account switcher)
			for (const mapping of sectionMappings) {
				if (targetLine >= mapping.startLine && targetLine < mapping.startLine + mapping.lineCount) {
					if (typeof mapping.component?.handleRailWheel === "function") {
						const handled = mapping.component.handleRailWheel(event.wheelDelta ?? 0);
						if (handled) {
							tui.requestRender();
							return { handled: true, render: true };
						}
					}
				}
			}

			scroll.scrollBy(event.wheelDelta ?? 0);
			return {
				handled: true,
				render: true,
				target: {
					component: scroll,
					originX: event.screenX - event.x,
					originY: event.screenY - event.y,
					width: event.width,
					height: event.height,
				},
			};
		}

		// 2. Click on rail cards or TabBar (left click / right click)
		if (event.type === "click") {
			// TabBar click handling
			if (
				layout.tabsEnabled !== false &&
				tabBarLineIndex >= 0 &&
				(targetLine === tabBarLineIndex || targetLine === tabBarDividerLineIndex) &&
				(!event.button || event.button === "left" || event.button === 0)
			) {
				const localX = event.x - layout.railPadding;
				let clickedTab = tabHitboxes.find((h) => localX >= h.startX && localX < h.endX);
				if (!clickedTab && tabHitboxes.length > 0) {
					for (let i = 0; i < tabHitboxes.length; i++) {
						const h = tabHitboxes[i];
						const next = tabHitboxes[i + 1];
						if (next && localX >= h.endX && localX < next.startX) {
							const mid = (h.endX + next.startX) / 2;
							clickedTab = localX < mid ? h : next;
							break;
						}
					}
				}
				if (clickedTab) {
					state.activeTabId = clickedTab.id;
					const footerComp = state.parts.get("footer") as any;
					if (typeof footerComp?.isProfileDropdownOpen === "function" && footerComp.isProfileDropdownOpen()) {
						footerComp.closeProfileDropdown();
					}
					tui.requestRender();
					return { handled: true, render: true };
				}
			}

			for (const mapping of sectionMappings) {
				if (targetLine >= mapping.startLine && targetLine < mapping.startLine + mapping.lineCount) {
					const localIndex = targetLine - mapping.startLine;
					if (typeof mapping.component?.handleRailClick === "function") {
						const localX = event.x - layout.railPadding;
						const handled = mapping.component.handleRailClick(localIndex, event.button, localX);
						if (handled) {
							tui.requestRender();
							return { handled: true, render: true };
						}
					}
				}
			}

			// If click was outside any interactive card element, check if dropdown should close
			const footerComp = state.parts.get("footer") as any;
			if (typeof footerComp?.isProfileDropdownOpen === "function" && footerComp.isProfileDropdownOpen()) {
				footerComp.closeProfileDropdown();
				tui.requestRender();
				return { handled: true, render: true };
			}
		}

		return nativeMouse(event);
	};
}
