import { ScrollView, VStack, visibleWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { getSidebarState, type SidebarRailComponent, type StandaloneSidebarState } from "./sidebar-state.ts";
import { resolveSidebarTab, renderSidebarTabBar, SIDEBAR_TABS, type TabHitbox } from "./sidebar-tabs.ts";
import type { CardTheme } from "./card-frame.ts";

export const SIDEBAR_BREAKPOINT = 120;
export const RAIL_WIDTH = 50;
export const RAIL_PADDING = 1;
export const GAP = 2;
export const CINLODEV_SIDEBAR_WRAPPER = Symbol.for("cinlodev.sidebar.layout-wrapper");
const GENTLE_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
type LayoutNode = { type: string; entries?: unknown[]; gap?: number; align?: "stretch" | "start" | "center" | "end" };
type LayoutRoot = Component & { [NODE]?: () => LayoutNode };
type Host = TUI & { mode?: string; layoutRoot?: LayoutRoot };

type RailHit = { key: string; component: SidebarRailComponent; startY: number; height: number; width: number };

type PreparedRail = {
	revision: number;
	width: number;
	activeTabId: string;
	contentWidth: number;
	active: boolean;
	lines: string[];
	hits: RailHit[];
	tabHitboxes: TabHitbox[];
	tabBarStartY: number;
};

export function installStandaloneSidebar(tui: TUI, theme?: CardTheme): () => void {
	if (!tui.terminal) return () => {};
	const host = tui as Host;
	const state = getSidebarState(tui);
	let revision = 0;
	let stopped = false;
	let railLines: string[] = [];
	let prepared: PreparedRail | undefined;
	const roots = new Set<LayoutRoot>();

	const invalidate = () => {
		revision++;
	};

	const rail: Component = {
		render: () => railLines,
		invalidate() {
			invalidate();
			for (const part of state.parts.values()) part.invalidate?.();
		},
	};

	const scroll = new ScrollView(rail, {
		follow: "none",
		primary: false,
		overscroll: "contain",
		scrollbar: "auto",
	});

	const nativeMouse = scroll.handleMouse.bind(scroll);

	const dispatchPartMouse = (event: TuiMouseEvent) => {
		const current = prepared;
		if (!current || stopped || !current.active || current.revision !== revision ||
			host.mode !== "fullscreen" || tui.terminal.columns !== current.width ||
			scroll.getContentWidth(event.width) !== current.contentWidth || event.x < RAIL_PADDING ||
			event.x >= current.contentWidth || event.y < 0 || event.y >= event.height) return undefined;

		const contentY = scroll.scrollTop + event.y;

		// 1. TabBar click or wheel
		if (current.tabBarStartY !== undefined && current.tabHitboxes) {
			const isTabBarLine = contentY === current.tabBarStartY || contentY === current.tabBarStartY + 1;
			if (event.type === "click" && (!event.button || event.button === "left" || (event.button as any) === 0) && isTabBarLine) {
				const localX = event.x - RAIL_PADDING;
				let hitTab = current.tabHitboxes.find((h) => localX >= h.startX && localX < h.endX);
				if (!hitTab && current.tabHitboxes.length > 0) {
					for (let i = 0; i < current.tabHitboxes.length; i++) {
						const h = current.tabHitboxes[i]!;
						const next = current.tabHitboxes[i + 1];
						if (next && localX >= h.endX && localX < next.startX) {
							const mid = (h.endX + next.startX) / 2;
							hitTab = localX < mid ? h : next;
							break;
						}
					}
					if (!hitTab) {
						if (localX < current.tabHitboxes[0]!.startX) hitTab = current.tabHitboxes[0];
						else if (localX >= current.tabHitboxes[current.tabHitboxes.length - 1]!.endX) hitTab = current.tabHitboxes[current.tabHitboxes.length - 1];
					}
				}
				if (hitTab) {
					state.activeTabId = hitTab.id;
					invalidate();
					tui.requestRender();
					return { handled: true, render: true };
				}
			} else if (event.type === "wheel" && isTabBarLine && event.wheelDelta !== 0) {
				const delta = (event.wheelDelta ?? 0) > 0 ? 1 : -1;
				const currentIndex = SIDEBAR_TABS.findIndex((t) => t.id === state.activeTabId);
				const nextIndex = (currentIndex + delta + SIDEBAR_TABS.length) % SIDEBAR_TABS.length;
				state.activeTabId = SIDEBAR_TABS[nextIndex]?.id ?? "main";
				invalidate();
				tui.requestRender();
				return { handled: true, render: true };
			}
		}

		// 2. Card hits
		const hit = current.hits.find((candidate) => contentY >= candidate.startY && contentY < candidate.startY + candidate.height);
		if (!hit || state.parts.get(hit.key) !== hit.component || event.x >= RAIL_PADDING + hit.width) return undefined;
		const localX = event.x - RAIL_PADDING;
		const localY = contentY - hit.startY;

		if (hit.component.handleMouse) {
			const res = hit.component.handleMouse({
				...event,
				x: localX,
				y: localY,
				width: hit.width,
				height: hit.height,
			});
			if (res?.handled) {
				tui.requestRender();
				return res;
			}
		}

		if (event.type === "click") {
			const railClick = hit.component.handleRailClick;
			if (typeof railClick === "function") {
				const handled = railClick.call(hit.component, localY, event.button, localX);
				if (handled) {
					tui.requestRender();
					return { handled: true, render: true };
				}
			}
		} else if (event.type === "wheel") {
			const railWheel = hit.component.handleRailWheel;
			if (typeof railWheel === "function") {
				const handled = railWheel.call(hit.component, event.wheelDelta ?? 0);
				if (handled) {
					tui.requestRender();
					return { handled: true, render: true };
				}
			}
		}

		return undefined;
	};

	scroll.handleMouse = (event) => {
		if (event.type === "wheel") {
			const sectionResult = dispatchPartMouse(event);
			if (sectionResult?.handled) return sectionResult;
			scroll.scrollBy(event.wheelDelta ?? 0);
			return {
				handled: true,
				render: true,
				target: { component: scroll, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height },
			};
		}
		return dispatchPartMouse(event) ?? nativeMouse(event);
	};

	const prepare = (width: number): boolean => {
		state.active = false;
		if (stopped || host.mode !== "fullscreen" || width < SIDEBAR_BREAKPOINT) {
			prepared = undefined;
			return false;
		}

		const activeTab = resolveSidebarTab(state.activeTabId);
		state.activeTabId = activeTab.id;
		const contentWidth = scroll.getContentWidth(RAIL_WIDTH);
		const netWidth = contentWidth - RAIL_PADDING * 2;

		const targetKeys = activeTab.cards;
		const termRows = tui.terminal?.rows ?? 45;
		const headerLinesCount = 3;
		const availableHeightForCards = Math.max(10, termRows - headerLinesCount);
		const isDualCards = targetKeys.length === 2;
		const cardHalfHeight = isDualCards ? Math.floor(Math.max(12, availableHeightForCards - 1) / 2) : undefined;

		const sections: Array<{ key: string; component: SidebarRailComponent; lines: string[] }> = [];
		const term = tui.terminal as unknown as Record<symbol, any> | undefined;
		const gentleParts = term?.[GENTLE_STATE]?.parts as Map<string, any> | undefined;

		for (const key of targetKeys) {
			let comp: SidebarRailComponent | undefined = state.parts.get(key);
			if (key === "status" && gentleParts?.has("footer")) {
				comp = gentleParts.get("footer");
			} else if (key === "todo" && gentleParts?.has("todo")) {
				comp = gentleParts.get("todo");
			}

			if (comp) {
				const renderHeight = targetKeys.length === 1 ? availableHeightForCards : (isDualCards ? cardHalfHeight : undefined);
				const rendered = [...(comp.render(netWidth, renderHeight as any) ?? [])];
				while (rendered.length && rendered[rendered.length - 1]?.trim() === "") rendered.pop();
				if (rendered.length > 0) {
					sections.push({ key, component: comp, lines: rendered });
				}
			}
		}

		railLines = [];
		const tabBar = renderSidebarTabBar(netWidth, activeTab.id, theme);
		const tabHitboxes = tabBar.hitboxes;
		const tabBarStartY = railLines.length;
		railLines.push(" ".repeat(RAIL_PADDING) + tabBar.line + " ".repeat(RAIL_PADDING));
		railLines.push(" ".repeat(RAIL_PADDING) + tabBar.divider + " ".repeat(RAIL_PADDING));
		railLines.push("");

		const hits: RailHit[] = [];
		for (const section of sections) {
			if (hits.length > 0) railLines.push("");
			const startY = railLines.length;
			railLines.push(...section.lines.map((line) => " ".repeat(RAIL_PADDING) + line + " ".repeat(RAIL_PADDING)));
			hits.push({ key: section.key, component: section.component, startY, height: section.lines.length, width: netWidth });
		}

		const active = railLines.length > 0 && railLines.every((line) => visibleWidth(line) <= contentWidth);
		prepared = {
			revision,
			width,
			activeTabId: activeTab.id,
			contentWidth,
			active,
			lines: railLines,
			hits,
			tabHitboxes,
			tabBarStartY,
		};
		state.active = active;
		return active;
	};

	const attach = () => {
		if (stopped || host.mode !== "fullscreen") { state.active = false; return; }
		try {
			const root = host.layoutRoot;
			if (!root || typeof root[NODE] !== "function" || (root[NODE] as any)?.[CINLODEV_SIDEBAR_WRAPPER]) return;
			const original = root[NODE]!;

			const replacement = () => {
				const node: any = original.call(root);
				if (!prepare(tui.terminal.columns)) {
					return node;
				}

				let headerEntry: any = undefined;
				let mainLeftComponent: Component = root;

				// If Gentle Shell installed a vstack [header, hstackHost]:
				if (node && node.type === "vstack" && Array.isArray(node.entries) && node.entries.length >= 2) {
					const secondComponent = node.entries[1]?.component;
					if (secondComponent && typeof secondComponent[NODE] === "function") {
						const subnode = secondComponent[NODE]();
						if (subnode && subnode.type === "hstack" && Array.isArray(subnode.entries) && subnode.entries.length > 0) {
							headerEntry = node.entries[0];
							if (subnode.entries[0]?.component) {
								mainLeftComponent = subnode.entries[0].component;
							}
						}
					}
				} else if (node && node.type === "hstack" && Array.isArray(node.entries) && node.entries.length >= 2) {
					if (node.entries[0]?.component) {
						mainLeftComponent = node.entries[0].component;
					}
				}

				const multitabHstack: any = {
					type: "hstack",
					gap: GAP,
					align: "stretch",
					entries: [
						{ component: mainLeftComponent, basis: 0, grow: 1, shrink: 1, minSize: 1 },
						{ component: scroll, basis: RAIL_WIDTH, grow: 0, shrink: 0, minSize: RAIL_WIDTH },
					],
				};

				if (headerEntry) {
					return {
						type: "vstack",
						gap: 0,
						align: "stretch",
						entries: [
							headerEntry,
							{
								component: {
									render: () => [],
									invalidate() {},
									[NODE]: () => multitabHstack,
								},
								basis: 0,
								grow: 1,
								shrink: 1,
								minSize: 1,
							},
						],
					};
				}

				return multitabHstack;
			};

			(replacement as any)[CINLODEV_SIDEBAR_WRAPPER] = true;
			root[NODE] = replacement;
			roots.add(root);
			tui.requestRender();
		} catch {
			state.active = false;
		}
	};

	attach();
	const timer = setInterval(attach, 150);
	timer.unref();

	return () => {
		stopped = true;
		state.active = false;
		clearInterval(timer);
		tui.requestRender();
	};
}
