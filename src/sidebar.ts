import { ScrollView, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { cuteGlyphs, frameFg, safeFg } from "./cute-theme.ts";
import { loadCuteStrings } from "./cute-strings.ts";

export const SIDEBAR_BREAKPOINT = 140;
export const RAIL_WIDTH = 50;
export const RAIL_PADDING = 2;
export const LEFT_BORDER_WIDTH = 2;
export const GAP = 0;

// Cinlodev CUTE sidebar colors come from the active Theme via safeFg/frameFg
// (keys resolved by themes/CinlodevCute.json to the same hex as before):
// borderSubtle #5c2c74 via "borderMuted", pink #F095C8 via "accent",
// pinkBright #FFB1DD via "pinkBright", violet frame #8e44ad via "border",
// text #F6EFF3 via "text". No hardcoded ANSI here.

// Single/rounded frame tokens map to the configured double (or ascii) preset
// via cuteGlyphs at render time, so frameStyle switches stay consistent.

// Las cards de gentle-pi (Changes/Agents/Todo) llegan en línea simple redondeada
// bicolor (riel en tono + resto en border). Las pasamos a doble línea toda en
// violeta oscuro, igual que nuestra card de Status. Solo toca tokens ANSI que
// sean puro marco, así el contenido (título, +366, −10, etc.) queda intacto.
// Sin theme se devuelve el token intacto (sin re-colorear a mano).
function unifyCardFrame(raw: string, theme?: Theme): string {
	return raw.replace(
		/\x1b\[[0-9;]+m[ ╭╮╰╯│─]*[╭╮╰╯│─][ ╭╮╰╯│─]*(?:\x1b\[39m|\x1b\[0m)/g,
		(token) => {
			if (!theme) return token;
			const g = cuteGlyphs(theme);
			const toConfigured: Record<string, string> = {
				"╭": g.tl,
				"╮": g.tr,
				"╰": g.bl,
				"╯": g.br,
				"│": g.v,
				"─": g.h,
			};
			const open = token.match(/^\x1b\[[0-9;]+m/)?.[0] ?? "";
			const close = token.match(/(?:\x1b\[39m|\x1b\[0m)$/)?.[0] ?? "";
			const glyphs = token.slice(open.length, token.length - close.length);
			const doubled = glyphs.replace(/[╭╮╰╯│─]/g, (c) => toConfigured[c] ?? c);
			return frameFg(theme, doubled);
		},
	);
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
	const banner = loadCuteStrings().sidebarBanner;

	const label = banner.full;
	const shortLabel = banner.short;
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
			const rows = Math.max(1, tui.terminal?.rows ?? 50);
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
		if (stopped || failed || host.mode !== "fullscreen" || width < SIDEBAR_BREAKPOINT) return false;
		try {
			const contentWidth = scroll.getContentWidth(RAIL_WIDTH);
			const sections = ["footer", "changes", "agents", "todo"]
				.map((key) => {
					const lines = [...(state.parts.get(key)?.render(contentWidth - RAIL_PADDING * 2) ?? [])];
					while (lines.length && lines[lines.length - 1]?.trim() === "") lines.pop();
					if (key !== "footer") return lines.map((line) => unifyCardFrame(line, theme));
					return lines;
				})
				.filter((lines) => lines.length > 0);

			const branding = renderCUTESidebarBanner(contentWidth - RAIL_PADDING * 2, theme);
			if (sections.length && branding.length) sections.unshift(branding);

			railLines = [
				"",
				...sections.flatMap((lines, index) => [
					...(index === 0 ? [] : [""]),
					...lines.map((line) => " ".repeat(RAIL_PADDING) + line + " ".repeat(RAIL_PADDING)),
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

			const applyCuteScrollbars = () => {
				if (!transcript) return;
				(transcript as any).scrollbarTrackStyle = () => subtle(railV);
				(transcript as any).scrollbarThumbStyle = (text: string) =>
					text === "█" ? pinkBright(railV) : pink(railV);
				if (transcript.scrollbar !== "always") transcript.setScrollbar("always");
			};

			const restoreTranscript = () => {
				if (!transcript) return;
				if (originalScrollbarTrackStyle) (transcript as any).scrollbarTrackStyle = originalScrollbarTrackStyle;
				if (originalScrollbarThumbStyle) (transcript as any).scrollbarThumbStyle = originalScrollbarThumbStyle;
				if (transcript.scrollbar !== originalScrollbar) transcript.setScrollbar(originalScrollbar);
			};

			const middleDivider: Component = {
				render(width: number) {
					const rows = Math.max(1, tui.terminal?.rows ?? 50);
					const line =
						width >= 2
							? `${" ".repeat(width - 1)}${subtle(railV)}`
							: subtle(railV);
					return Array(rows).fill(line);
				},
				invalidate() {},
			};

			const left = {
				render: (width: number) => root.render(width),
				invalidate: () => root.invalidate?.(),
				[NODE]: () => original.call(root),
			};
			const replacement = () => {
				const columns = tui.terminal.columns;
				const active = prepare(columns);
				const hasLeftBorder = columns >= 40;

				if (!hasLeftBorder && !active) {
					restoreTranscript();
					return original.call(root);
				}

				if (active) {
					// Con el middleDivider visible de arriba a abajo, ocultamos el scrollbar del transcript
					if (transcript && transcript.scrollbar !== "hidden") {
						transcript.setScrollbar("hidden");
					}
				} else {
					restoreTranscript();
				}

				const entries: any[] = [];
				if (hasLeftBorder) {
					entries.push({
						component: leftBorder,
						basis: LEFT_BORDER_WIDTH,
						grow: 0,
						shrink: 0,
						minSize: LEFT_BORDER_WIDTH,
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
						basis: 2,
						grow: 0,
						shrink: 0,
						minSize: 2,
					});
					entries.push({
						component: scroll,
						basis: RAIL_WIDTH,
						grow: 0,
						shrink: 0,
						minSize: RAIL_WIDTH,
					});
				}

				return {
					type: "hstack",
					gap: GAP,
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
	const timer = setInterval(attach, 100);
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
