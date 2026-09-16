import { ScrollView, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cuteGlyphs, frameFg, safeFg, transformTranscriptLines, unifySidebarCardFrame } from "./cute-theme.ts";
import { formatTranscriptChild, formatTranscriptChildren } from "./cute-transcript.ts";
import { loadCuteStrings } from "./cute-strings.ts";
import { loadCuteLayout, resolveEdgeInsets, tuneTuiScroll } from "./cute-layout.ts";

// Cinlodev CUTE sidebar colors come from the active Theme via safeFg/frameFg
// (keys resolved by themes/CinlodevCute.json to the same hex as before):
// borderSubtle #5c2c74 via "borderMuted", pink #F095C8 via "accent",
// pinkBright #FFB1DD via "pinkBright", violet frame #8e44ad via "border",
// text #F6EFF3 via "text". No hardcoded ANSI here.

// Single/rounded frame tokens map to the configured double (or ascii) preset
// via cuteGlyphs at render time, so frameStyle switches stay consistent.

function findDock(root: unknown): any {
	if (!root || typeof root !== "object") return undefined;
	const entries = (root as any).entries;
	if (Array.isArray(entries) && entries.length >= 2) {
		const candidate = entries[1]?.component;
		if (candidate && Array.isArray((candidate as any).entries)) {
			return candidate;
		}
	}
	return undefined;
}

function findTranscript(root: unknown): ScrollView | undefined {
	if (!root || typeof root !== "object") return undefined;
	if ("scrollbar" in root && typeof (root as any).setScrollbar === "function") {
		return root as ScrollView;
	}
	const entries = (root as any).entries;
	if (Array.isArray(entries)) {
		for (const entry of entries) {
			const found = findTranscript(entry?.component);
			if (found) return found;
		}
	}
	const children = (root as any).children;
	if (Array.isArray(children)) {
		for (const child of children) {
			const found = findTranscript(child);
			if (found) return found;
		}
	}
	return undefined;
}

// Layout symbol shared with Pi 0.85.1 and pi-tui
const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
type LayoutNode = { type: string; entries?: unknown[]; gap?: number; align?: string };
type LayoutRoot = Component & { [NODE]?: () => LayoutNode };
type Host = TUI & { mode?: string; layoutRoot?: LayoutRoot };

// State symbol shared across extensions on tui.terminal
const STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

export interface SidebarState {
	active: boolean;
	ownsHost?: () => boolean;
	parts: Map<string, Component>;
}

export function sidebarState(tui: TUI): SidebarState {
	const terminal = tui.terminal as unknown as Record<symbol, SidebarState>;
	return (terminal[STATE] ??= { active: false, parts: new Map() });
}

/** Keep the original bottom component mounted, suppressing only its paint when the sidebar owns the host. */
export function sidebarPart<T extends Component & { dispose?(): void }>(
	tui: TUI,
	key: string,
	bottom: T,
	rail: Component = bottom,
): T {
	if (!tui.terminal) return bottom;
	const state = sidebarState(tui);
	state.parts.set(key, rail);
	return {
		...bottom,
		render: (width: number) => (state.active && state.ownsHost?.() ? [] : bottom.render(width)),
		dispose() {
			if (state.parts.get(key) === rail) state.parts.delete(key);
			bottom.dispose?.();
		},
	};
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderCUTESidebarBanner(width: number, theme?: Theme): string[] {
	const pink = (s: string): string => (theme ? safeFg(theme, "pinkBright", s) : s);
	const text = (s: string): string => (theme ? safeFg(theme, "text", s) : s);
	const strings = loadCuteStrings();
	const user = strings.welcomePersona.user || "Cinlo";
	const banner = strings.sidebarBanner;

	const label = banner.full.replace("{user}", user);
	const shortLabel = banner.short.replace("{user}", user);
	const raw = width >= visibleWidth(label) ? label : shortLabel;
	const space = width - visibleWidth(raw);
	if (space < 0) return [];

	const leftPad = Math.floor(space / 2);
	const rightPad = Math.ceil(space / 2);

	const formatted = raw
		.replace(new RegExp(escapeRegExp(banner.glyph), "g"), pink(banner.glyph))
		.replace(new RegExp(escapeRegExp(banner.brand), "g"), pink(banner.brand))
		.replace(new RegExp(escapeRegExp(banner.partner), "g"), text(banner.partner));

	return [" ".repeat(leftPad) + formatted + " ".repeat(rightPad)];
}

export function installSidebar(tui: TUI, theme?: Theme): () => void {
	if (!tui.terminal) return () => {};
	tuneTuiScroll(tui);
	const host = tui as Host;
	const subtle = (s: string): string => (theme ? safeFg(theme, "borderMuted", s) : s);
	const pink = (s: string): string => (theme ? safeFg(theme, "accent", s) : s);
	const pinkBright = (s: string): string => (theme ? safeFg(theme, "pinkBright", s) : s);
	const railV = cuteGlyphs(theme).v;
	const state = sidebarState(tui);
	const cleanups: Array<() => void> = [];
	const roots = new Set<LayoutRoot>();
	let stopped = false;
	let failed = false;
	let railLines: string[] = [];
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
		if (event.type !== "wheel") return nativeMouse(event);
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
	};

	const prepare = (width: number): boolean => {
		state.active = false;
		const layout = loadCuteLayout().sidebar;
		if (stopped || failed || host.mode !== "fullscreen" || width < layout.breakpoint) return false;
		try {
			const contentWidth = scroll.getContentWidth(layout.railWidth);
			const sections = ["footer", "context", "changes", "agents", "todo"]
				.map((key) => {
					const lines = [...(state.parts.get(key)?.render(contentWidth - layout.railPadding * 2) ?? [])];
					while (lines.length && lines[lines.length - 1]?.trim() === "") lines.pop();
					if (key !== "footer" && key !== "context") return lines.map((line) => unifySidebarCardFrame(line, theme));
					return lines;
				})
				.filter((lines) => lines.length > 0);

			const branding = renderCUTESidebarBanner(contentWidth - layout.railPadding * 2, theme);
			if (sections.length && branding.length) sections.unshift(branding);

			railLines = [
				"",
				...sections.flatMap((lines, index) => [
					...(index === 0 ? [] : [""]),
					...lines.map((line) => " ".repeat(layout.railPadding) + line + " ".repeat(layout.railPadding)),
				]),
			];

			if (!railLines.length || railLines.some((line) => visibleWidth(line) > contentWidth)) return false;
			state.active = true;
			return true;
		} catch {
			failed = true;
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
			if (roots.has(root)) return;
			const original = root[NODE]!;
			const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
			const transcript = findTranscript(root);
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

				if (!hasLeftBorder && !active && insetLeft === 0 && insetRight === 0) {
					return original.call(root);
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
					component: left,
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

				return {
					type: "hstack",
					gap: layout.gap,
					align: "stretch",
					entries,
				};
			};

			root[NODE] = replacement;
			roots.add(root);
			tui.requestRender();
			cleanups.push(() => {
				restoreTranscript();
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
		clearInterval(timer);
		scroll.hideTransientScrollbar();
		for (const cleanup of cleanups.reverse()) cleanup();
		tui.requestRender();
	};
}
