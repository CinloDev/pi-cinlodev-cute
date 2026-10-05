import { ScrollView, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cuteGlyphs, safeFg, transformTranscriptLines, unifySidebarCardFrame } from "./cute-theme.ts";
import { formatTranscriptChild, formatTranscriptChildren } from "./cute-transcript.ts";
import { loadCuteStrings } from "./cute-strings.ts";
import { loadCuteLayout, resolveEdgeInsets, tuneTuiScroll } from "./cute-layout.ts";
import { CinlodevProfilesExtendedCard } from "./cute-profiles.ts";
import { CinlodevAgentsCard } from "./cute-agents.ts";
import { CinlodevGitGraphCard, CinlodevWorkingTreeCard } from "./cute-git-graph.ts";
import { CinlodevEngramHandoffCard } from "./cute-engram.ts";
import { CinlodevProjectTreeCard } from "./cute-tree.ts";
import {
	measureDockMetrics,
	measureDockHeight,
	getVisibleInputBottomOffset,
	findDock,
	findTranscript,
	NODE,
	type DockMetrics,
} from "./sidebar-dock.ts";
import {
	CUTE_SIDEBAR_TABS,
	SIDEBAR_TAB_CARD_MAP,
	resolveSidebarTab,
	renderCuteSidebarTabBar,
	type CuteSidebarTab,
	type TabHitbox,
} from "./sidebar-tabs.ts";
import {
	sidebarState,
	sidebarPart,
	renderCUTESidebarBanner,
	SIDEBAR_STATE_KEY,
	type SidebarState,
} from "./sidebar-state.ts";

export {
	measureDockMetrics,
	measureDockHeight,
	getVisibleInputBottomOffset,
	findDock,
	findTranscript,
	NODE,
	type DockMetrics,
	CUTE_SIDEBAR_TABS,
	SIDEBAR_TAB_CARD_MAP,
	resolveSidebarTab,
	renderCuteSidebarTabBar,
	type CuteSidebarTab,
	type TabHitbox,
	sidebarState,
	sidebarPart,
	renderCUTESidebarBanner,
	SIDEBAR_STATE_KEY,
	type SidebarState,
};

// Cinlodev CUTE sidebar colors come from the active Theme via safeFg/frameFg
// (keys resolved by themes/CinlodevCute.json to the same hex as before):
// borderSubtle #5c2c74 via "borderMuted", pink #F095C8 via "accent",
// pinkBright #FFB1DD via "pinkBright", violet frame #8e44ad via "border",
// text #F6EFF3 via "text". No hardcoded ANSI here.

// Single/rounded frame tokens map to the configured double (or ascii) preset
// via cuteGlyphs at render time, so frameStyle switches stay consistent.

type LayoutNode = { type: string; entries?: unknown[]; gap?: number; align?: string };
type LayoutRoot = Component & { [NODE]?: () => LayoutNode };
type Host = TUI & { mode?: string; layoutRoot?: LayoutRoot };

// Marker symbol to avoid double-wrapping layoutRoot
export const CUTE_LAYOUT_WRAPPER = Symbol.for("pi-cinlodev-cute.layout-wrapper");

export function installSidebar(tui: TUI, theme?: Theme): () => void {
	if (!tui.terminal) return () => {};
	tuneTuiScroll(tui);
	const host = tui as Host;
	let activeTranscript: ScrollView | undefined;
	let activeDock: any = undefined;
	const subtle = (s: string): string => (theme ? safeFg(theme, "borderMuted", s) : s);
	const pink = (s: string): string => (theme ? safeFg(theme, "accent", s) : s);
	const pinkBright = (s: string): string => (theme ? safeFg(theme, "pinkBright", s) : s);
	const railV = cuteGlyphs(theme).v;
	const state = sidebarState(tui);
	if (!state.parts.has("cute-profiles")) {
		const profilesCard = new CinlodevProfilesExtendedCard(tui, theme);
		state.parts.set("cute-profiles", profilesCard);
	}
	if (!state.parts.has("cute-agents")) {
		const agentsCard = new CinlodevAgentsCard(undefined, tui, theme);
		state.parts.set("cute-agents", agentsCard);
	}
	const cleanups: Array<() => void> = [];
	const roots = new Set<LayoutRoot>();
	let stopped = false;
	let failed = false;
	let railLines: string[] = [];
	interface SectionMapping {
		key: string;
		component: any;
		startLine: number;
		lineCount: number;
	}
	let sectionMappings: SectionMapping[] = [];
	let tabHitboxes: TabHitbox[] = [];
	let tabBarLineIndex = -1;
	let tabBarDividerLineIndex = -1;
	state.active = false;
	state.ownsHost = () => !stopped && host.mode === "fullscreen" && !!host.layoutRoot && roots.has(host.layoutRoot);

	const rail: Component = {
		render: () => railLines,
		invalidate() {
			for (const part of state.parts.values()) part.invalidate();
		},
	};

	const leftBorder: Component = {
		render(width: number) {
			const rows = Math.max(1, tui.terminal?.rows ?? loadCuteLayout().sidebar.fallbackRows);
			const line =
				width >= 2
					? `${subtle(railV)}${" ".repeat(width - 1)}`
					: subtle(railV);
			return Array(rows).fill(line);
		},
		invalidate() {},
	};

	const scroll = new ScrollView(rail, {
		follow: "none",
		primary: false,
		overscroll: "contain",
		scrollbar: "always",
		scrollbarTrackStyle: () => subtle(railV),
		scrollbarThumbStyle: (text) => (text === "█" ? pinkBright(railV) : pink(railV)),
	});

	const nativeMouse = scroll.handleMouse.bind(scroll);
	scroll.handleMouse = (event) => {
		const scrollTop = (scroll as any).currentScrollTop ?? 0;
		const targetLine = event.y + scrollTop;
		const layout = loadCuteLayout().sidebar;

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

	const prepare = (width: number): boolean => {
		state.active = false;
		const layout = loadCuteLayout().sidebar;
		if (stopped || failed || host.mode !== "fullscreen" || width < layout.breakpoint) return false;
		try {
			const contentWidth = scroll.getContentWidth(layout.railWidth);
			const netWidth = contentWidth - layout.railPadding * 2;
			const tabsEnabled = layout.tabsEnabled !== false;
			const activeTab = resolveSidebarTab(state.activeTabId ?? layout.defaultTab);
			state.activeTabId = activeTab.id;

			const targetCardKeys = !tabsEnabled
				? ["footer", "context", "engram", "gitGraph", "tools", "cute-agents", "cute-profiles", "todo"]
				: activeTab.cards;

			const branding = renderCUTESidebarBanner(netWidth, theme);
			const bannerLinesCount = (branding && branding.length) ? branding.length + 1 : 0;
			const tabsLinesCount = tabsEnabled ? 2 : 0;
			// Lines before the card: initial empty line (1) + banner lines + tab bar lines + empty line before card (1)
			const headerLines = 1 + bannerLinesCount + tabsLinesCount + 1;

			let availableCardHeight: number | undefined;
			let cardHeights: (number | undefined)[] = [];
			const termRows = tui.terminal?.rows ?? loadCuteLayout().sidebar.fallbackRows ?? 45;
			const dockWidth = Math.max(10, (tui.terminal?.columns ?? 100) - layout.railWidth);
			const { totalHeight: dockHeight, visibleInputBottomOffset } = measureDockMetrics(activeDock, dockWidth);
			const transcriptHeight = activeTranscript?.viewportHeight;

			// The input box's bottom horizontal line is at:
			// transcript.viewportHeight + visibleInputBottomOffset.
			// If transcript is not yet laid out, fall back to termRows - dockHeight + visibleInputBottomOffset.
			const inputBottomRow = (typeof transcriptHeight === "number" && transcriptHeight > 10)
				? transcriptHeight + visibleInputBottomOffset
				: Math.max(15, termRows - dockHeight + visibleInputBottomOffset);

			// availableCardHeight must never exceed termRows - headerLines so railLines never overflows terminal
			const maxAllowedHeight = Math.max(10, termRows - headerLines);
			const targetHeight = inputBottomRow - headerLines;
			const totalTargetHeight = Math.min(maxAllowedHeight, Math.max(10, targetHeight));

			if (targetCardKeys.length === 1) {
				availableCardHeight = totalTargetHeight;
				cardHeights = [totalTargetHeight];
			} else if (targetCardKeys.length === 2) {
				// 2 cards split 50/50 sharing the full rail height down to the input line
				const interCardGap = 1; // empty line between the 2 cards
				const availableForCards = Math.max(14, totalTargetHeight - interCardGap);
				const half = Math.floor(availableForCards / 2);
				const secondHalf = availableForCards - half;
				cardHeights = [half, secondHalf];
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
					if (
						!component &&
						(key === "cute-agents" || key === "agents")
					) {
						component =
							state.parts.get("cute-agents") ||
							state.parts.get("agents");
						if (!component) {
							component = new CinlodevAgentsCard(undefined, tui, theme);
							state.parts.set("cute-agents", component);
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
					const renderHeight = (targetCardKeys.length === 1 || targetCardKeys.length === 2 || key === "projectTree" || key === "project-tree")
						? (cardHeights[index] ?? availableCardHeight)
						: undefined;
					const rawLines = [...(component?.render(netWidth, renderHeight as any) ?? [])];
					while (rawLines.length && rawLines[rawLines.length - 1]?.trim() === "") rawLines.pop();
					const lines =
						key !== "footer" &&
						key !== "context" &&
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
						key !== "cute-agents" &&
						key !== "agents" &&
						key !== "profiles" &&
						key !== "projectTree" &&
						key !== "project-tree"
							? rawLines.map((line) => unifySidebarCardFrame(line, theme))
							: rawLines;
					return { key, component, lines };
				})
				.filter((s) => s.lines.length > 0);


			railLines = [""];
			sectionMappings = [];
			tabHitboxes = [];
			tabBarLineIndex = -1;
			tabBarDividerLineIndex = -1;

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

				if (!railLines.length || !sectionData.length || railLines.some((line) => visibleWidth(line) > contentWidth)) return false;
				state.active = true;
				return true;
			}

			// Tabs enabled flow
			if (branding.length) {
				railLines.push(...branding.map((line) => " ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding)));
				railLines.push("");
			}

			const { line: tabLine, divider: dividerLine, hitboxes } = renderCuteSidebarTabBar(netWidth, activeTab.id, theme);
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

			if (!railLines.length || railLines.some((line) => visibleWidth(line) > contentWidth)) return false;
			state.active = true;
			return true;
		} catch {
			state.active = false;
			return false;
		}
	};

	const attach = () => {
		if (stopped || failed) return;
		if (host.mode !== "fullscreen") {
			state.active = false;
			return;
		}
		try {
			const root = host.layoutRoot;
			if (!root || typeof root[NODE] !== "function") {
				state.active = false;
				return;
			}
			activeTranscript = findTranscript(root);
			activeDock = findDock(root);
			if (typeof root[NODE] === "function" && (root[NODE] as any)[CUTE_LAYOUT_WRAPPER]) {
				return;
			}
			const original = root[NODE]!;
			const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
			const transcript = activeTranscript;
			const originalScrollbar = transcript?.scrollbar ?? "auto";
			const originalScrollbarTrackStyle = transcript ? (transcript as any).scrollbarTrackStyle : undefined;
			const originalScrollbarThumbStyle = transcript ? (transcript as any).scrollbarThumbStyle : undefined;

			const originalTranscriptRender = transcript ? transcript.render.bind(transcript) : undefined;
			if (transcript && !(transcript as any).__cuteWrapped) {
				(transcript as any).__cuteWrapped = true;
				const orig = transcript.render.bind(transcript);
				transcript.render = (width: number) => {
					const rawLines = orig(width);
					return transformTranscriptLines(rawLines, theme);
				};
			}

			const doc = (transcript as any)?.child as Component | undefined;
			const originalDocRender = doc ? doc.render.bind(doc) : undefined;
			if (doc && !(doc as any).__cuteDocWrapped) {
				(doc as any).__cuteDocWrapped = true;
				const origDoc = doc.render.bind(doc);
				doc.render = (width: number) => {
					const rawLines = origDoc(width);
					return transformTranscriptLines(rawLines, theme);
				};
			}

			// Wrap chatContainer to frame each transcript component by category
			const chatContainer =
				(doc as any)?.children?.find((c: any) =>
					Array.isArray(c?.children) && c !== (doc as any)?.children?.[0] && c !== (doc as any)?.children?.[1],
				) ?? (doc as any)?.children?.[2];
			const originalChatRender = chatContainer ? chatContainer.render.bind(chatContainer) : undefined;
			if (chatContainer && !(chatContainer as any).__cuteChatWrapped && Array.isArray(chatContainer.children)) {
				(chatContainer as any).__cuteChatWrapped = true;
				chatContainer.render = (width: number) => {
					const { lines, mouseChildren } = formatTranscriptChildren(chatContainer.children, width, theme);
					chatContainer.mouseLayout = { width, children: mouseChildren };
					return lines;
				};
			}

			const dock = findDock(root);
			const widgetsAbove = dock?.entries?.[2]?.component as Component | undefined;
			const originalWidgetsAboveRender = widgetsAbove ? widgetsAbove.render.bind(widgetsAbove) : undefined;
			if (widgetsAbove && !(widgetsAbove as any).__cuteWidgetsWrapped) {
				(widgetsAbove as any).__cuteWidgetsWrapped = true;
				const origWidgets = widgetsAbove.render.bind(widgetsAbove);
				widgetsAbove.render = (width: number) => {
					const rawLines = origWidgets(width);
					return transformTranscriptLines(rawLines, theme);
				};
			}

			const widgetsBelow = dock?.entries?.[4]?.component as Component | undefined;
			const originalWidgetsBelowRender = widgetsBelow ? widgetsBelow.render.bind(widgetsBelow) : undefined;
			if (widgetsBelow && !(widgetsBelow as any).__cuteWidgetsWrapped) {
				(widgetsBelow as any).__cuteWidgetsWrapped = true;
				const origWidgets = widgetsBelow.render.bind(widgetsBelow);
				widgetsBelow.render = (width: number) => {
					const rawLines = origWidgets(width);
					return transformTranscriptLines(rawLines, theme);
				};
			}

			const applyCuteScrollbars = () => {
				if (!transcript) return;
				(transcript as any).scrollbarTrackStyle = () => subtle(railV);
				(transcript as any).scrollbarThumbStyle = (text: string) =>
					text === "█" ? pinkBright(railV) : pink(railV);
				if (transcript.scrollbar !== "always") transcript.setScrollbar("always");
			};

			const restoreTranscript = () => {
				if (!transcript) return;
				if (originalTranscriptRender) transcript.render = originalTranscriptRender;
				delete (transcript as any).__cuteWrapped;
				if (doc && (doc as any).__cuteDocWrapped) {
					if (originalDocRender) doc.render = originalDocRender;
					delete (doc as any).__cuteDocWrapped;
				}
				if (chatContainer && (chatContainer as any).__cuteChatWrapped) {
					if (originalChatRender) chatContainer.render = originalChatRender;
					delete (chatContainer as any).__cuteChatWrapped;
				}
				if (widgetsAbove && (widgetsAbove as any).__cuteWidgetsWrapped) {
					if (originalWidgetsAboveRender) widgetsAbove.render = originalWidgetsAboveRender;
					delete (widgetsAbove as any).__cuteWidgetsWrapped;
				}
				if (widgetsBelow && (widgetsBelow as any).__cuteWidgetsWrapped) {
					if (originalWidgetsBelowRender) widgetsBelow.render = originalWidgetsBelowRender;
					delete (widgetsBelow as any).__cuteWidgetsWrapped;
				}
				if (originalScrollbarTrackStyle) (transcript as any).scrollbarTrackStyle = originalScrollbarTrackStyle;
				if (originalScrollbarThumbStyle) (transcript as any).scrollbarThumbStyle = originalScrollbarThumbStyle;
				if (transcript.scrollbar !== originalScrollbar) transcript.setScrollbar(originalScrollbar);
			};

			const middleDivider: Component = {
				render(width: number) {
					const rows = Math.max(1, tui.terminal?.rows ?? loadCuteLayout().sidebar.fallbackRows);
					const line =
						width >= 2
							? `${" ".repeat(width - 1)}${subtle(railV)}`
							: subtle(railV);
					return Array(rows).fill(line);
				},
				invalidate() {},
			};

			const left = {
				render: (width: number) => {
					const lines = root.render(width);
					return transformTranscriptLines(lines, theme);
				},
				invalidate: () => root.invalidate?.(),
				[NODE]: () => original.call(root),
			};
			const replacement = () => {
				const cute = loadCuteLayout();
				const layout = cute.sidebar;
				const columns = tui.terminal.columns;
				// Edge columns eaten by overlay chrome that never resizes the pty
				// (Herdr's bar) stay empty so borders are never clipped.
				const { left: insetLeft, right: insetRight } = resolveEdgeInsets(cute.terminal);
				const availColumns = Math.max(1, columns - insetLeft - insetRight);
				const active = prepare(availColumns);
				const hasLeftBorder = availColumns >= layout.minColumnsWithBorder;

				if (active) {
					// Con el middleDivider visible de arriba a abajo, ocultamos el scrollbar del transcript
					if (transcript && transcript.scrollbar !== "hidden") {
						transcript.setScrollbar("hidden");
					}
				} else {
					// Si el sidebar no cabe, restauramos el scrollbar original pero mantenemos
					// intactos los wrappers CUTE del transcript y de las cards
					if (transcript && transcript.scrollbar !== originalScrollbar) {
						transcript.setScrollbar(originalScrollbar);
					}
				}

				const node: any = original.call(root);

				if (!hasLeftBorder && !active && insetLeft === 0 && insetRight === 0) {
					return node;
				}

				let headerEntry: any = undefined;
				let mainLeftComponent: Component = left;

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
				} else if (node && node.type === "hstack" && Array.isArray(node.entries) && node.entries.length === 2) {
					if (node.entries[0]?.component) {
						mainLeftComponent = node.entries[0].component;
					}
				}

				const edgeSpacer = (): Component => ({
					render(width: number) {
						const rows = Math.max(1, tui.terminal?.rows ?? layout.fallbackRows);
						return Array(rows).fill(" ".repeat(Math.max(0, width)));
					},
					invalidate() {},
				});

				const entries: any[] = [];
				if (insetLeft > 0) {
					entries.push({
						component: edgeSpacer(),
						basis: insetLeft,
						grow: 0,
						shrink: 0,
						minSize: insetLeft,
					});
				}
				if (hasLeftBorder) {
					entries.push({
						component: leftBorder,
						basis: layout.leftBorderWidth,
						grow: 0,
						shrink: 0,
						minSize: layout.leftBorderWidth,
					});
				}
				entries.push({
					component: mainLeftComponent,
					basis: 0,
					grow: 1,
					shrink: 1,
					minSize: 1,
				});
				if (active) {
					entries.push({
						component: middleDivider,
						basis: layout.middleDividerWidth,
						grow: 0,
						shrink: 0,
						minSize: layout.middleDividerWidth,
					});
					entries.push({
						component: scroll,
						basis: layout.railWidth,
						grow: 0,
						shrink: 0,
						minSize: layout.railWidth,
					});
				}
				if (insetRight > 0) {
					entries.push({
						component: edgeSpacer(),
						basis: insetRight,
						grow: 0,
						shrink: 0,
						minSize: insetRight,
					});
				}

				const cuteHstack: any = {
					type: "hstack",
					gap: layout.gap,
					align: "stretch",
					entries,
				};

				if (headerEntry) {
					return {
						type: "vstack",
						entries: [
							headerEntry,
							{
								component: {
									render: () => [],
									invalidate() {},
									[NODE]: () => cuteHstack,
								},
								basis: 0,
								grow: 1,
								shrink: 1,
								minSize: 1,
							},
						],
					};
				}

				return cuteHstack;
			};

			(replacement as any)[CUTE_LAYOUT_WRAPPER] = true;
			root[NODE] = replacement;
			roots.add(root);
			tui.requestRender();
			cleanups.push(() => {
				restoreTranscript();
				activeTranscript = undefined;
				activeDock = undefined;
				if (root[NODE] !== replacement) return;
				if (descriptor) Object.defineProperty(root, NODE, descriptor);
				else Reflect.deleteProperty(root, NODE);
			});
		} catch {
			failed = true;
			state.active = false;
		}
	};

	attach();
	const timer = setInterval(attach, loadCuteLayout().sidebar.attachMs);
	timer.unref();

	return () => {
		stopped = true;
		state.active = false;
		activeTranscript = undefined;
		activeDock = undefined;
		clearInterval(timer);
		scroll.hideTransientScrollbar();
		for (const cleanup of cleanups.reverse()) cleanup();
		tui.requestRender();
	};
}
