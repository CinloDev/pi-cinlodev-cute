import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg } from "./cute-theme.ts";
import { loadCuteStrings, detectSystemUser } from "./cute-strings.ts";

// State symbol shared across extensions on tui.terminal
export const SIDEBAR_STATE_KEY = Symbol.for("gentle-pi.experimental-sidebar.state");

export interface SidebarState {
	active: boolean;
	ownsHost?: () => boolean;
	parts: Map<string, Component>;
	activeTabId?: string;
}

/**
 * Accesses or initializes the shared terminal-level SidebarState.
 */
export function sidebarState(tui: TUI): SidebarState {
	const terminal = tui.terminal as unknown as Record<symbol, SidebarState>;
	return (terminal[SIDEBAR_STATE_KEY] ??= { active: false, parts: new Map() });
}

/**
 * Keep the original bottom component mounted, suppressing only its paint
 * when the sidebar owns the host.
 */
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

/**
 * Renders the top decorative banner for the CUTE sidebar rail.
 */
export function renderCUTESidebarBanner(width: number, theme?: Theme): string[] {
	const pink = (s: string): string => (theme ? safeFg(theme, "pinkBright", s) : s);
	const text = (s: string): string => (theme ? safeFg(theme, "text", s) : s);
	const strings = loadCuteStrings();
	const user = strings.welcomePersona.user || detectSystemUser();
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
