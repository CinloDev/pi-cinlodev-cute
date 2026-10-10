import { ScrollView, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cuteGlyphs, safeFg, transformTranscriptLines } from "./cute-theme.ts";
import { formatTranscriptChildren } from "./cute-transcript.ts";
import { loadCuteLayout, resolveEdgeInsets, tuneTuiScroll } from "./cute-layout.ts";
import { CinlodevProfilesExtendedCard } from "./cute-profiles.ts";
import {
	findDock,
	findTranscript,
	NODE,
} from "./sidebar-dock.ts";
import {
	sidebarState,
	sidebarPart,
	SIDEBAR_STATE_KEY,
	type SidebarState,
} from "./sidebar-state.ts";
import {
	createSidebarMouseHandler,
	type SectionMapping,
} from "./sidebar-mouse.ts";
import {
	buildSidebarRailLines,
} from "./sidebar-rail-builder.ts";
import {
	CUTE_SIDEBAR_TABS,
	SIDEBAR_TAB_CARD_MAP,
	resolveSidebarTab,
	renderCuteSidebarTabBar,
	type CuteSidebarTab,
	type TabHitbox,
} from "./sidebar-tabs.ts";

export {
	sidebarState,
	sidebarPart,
	SIDEBAR_STATE_KEY,
	type SidebarState,
	CUTE_SIDEBAR_TABS,
	SIDEBAR_TAB_CARD_MAP,
	resolveSidebarTab,
	renderCuteSidebarTabBar,
	type CuteSidebarTab,
	type TabHitbox,
};

interface Host extends TUI {
	layoutRoot?: LayoutRoot;
	mode?: string;
}

interface LayoutRoot extends Component {
	[NODE]?: () => any;
}

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
	const cleanups: Array<() => void> = [];
	const roots = new Set<LayoutRoot>();
	let stopped = false;
	let failed = false;
	let railLines: string[] = [];

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
	scroll.handleMouse = createSidebarMouseHandler({
		scroll,
		state,
		tui,
		getSectionMappings: () => sectionMappings,
		getTabHitboxes: () => tabHitboxes,
		getTabBarLineIndex: () => tabBarLineIndex,
		getTabBarDividerLineIndex: () => tabBarDividerLineIndex,
		nativeMouse,
	});

	const prepare = (width: number): boolean => {
		state.active = false;
		const layout = loadCuteLayout().sidebar;
		if (stopped || failed || host.mode !== "fullscreen" || width < layout.breakpoint) return false;
		try {
			const contentWidth = scroll.getContentWidth(layout.railWidth);
			const result = buildSidebarRailLines({
				state,
				tui,
				theme,
				activeDock,
				activeTranscript,
				contentWidth,
			});

			if (!result.success) {
				state.active = false;
				return false;
			}

			railLines = result.railLines;
			sectionMappings = result.sectionMappings;
			tabHitboxes = result.tabHitboxes;
			tabBarLineIndex = result.tabBarLineIndex;
			tabBarDividerLineIndex = result.tabBarDividerLineIndex;
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

			const original = root[NODE];
			const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
			const transcript = activeTranscript;

			const originalScrollbar = transcript ? transcript.scrollbar : "auto";
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

				if (active) {
					applyCuteScrollbars();
				}

				const edgeSpacer = (): Component => ({
					render: (w: number) => Array(tui.terminal.rows).fill(" ".repeat(w)),
					invalidate: () => {},
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

	let currentTimer: NodeJS.Timeout | undefined;

	const scheduleNext = (delayMs: number) => {
		if (stopped) return;
		if (currentTimer) clearTimeout(currentTimer);
		currentTimer = setTimeout(() => {
			if (stopped) return;
			attach();
			const isAttached = !!host.layoutRoot && roots.has(host.layoutRoot);
			const nextDelay = isAttached ? 400 : loadCuteLayout().sidebar.attachMs;
			scheduleNext(nextDelay);
		}, delayMs);
		currentTimer.unref();
	};

	attach();
	const isAlreadyAttached = !!host.layoutRoot && roots.has(host.layoutRoot);
	scheduleNext(isAlreadyAttached ? 400 : loadCuteLayout().sidebar.attachMs);

	return () => {
		stopped = true;
		state.active = false;
		activeTranscript = undefined;
		activeDock = undefined;
		if (currentTimer) clearTimeout(currentTimer);
		scroll.hideTransientScrollbar();
		for (const cleanup of cleanups.reverse()) cleanup();
		tui.requestRender();
	};
}
