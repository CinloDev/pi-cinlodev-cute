import type { Component, TUI } from "@earendil-works/pi-tui";

const STATE = Symbol.for("cinlodev.sidebar.state");

export interface SidebarRailComponent extends Component {
	digest?(): string;
	handleRailClick?(lineIndex: number, button?: string, localX?: number): boolean;
	handleRailWheel?(delta: number): boolean;
}

export interface StandaloneSidebarState {
	active: boolean;
	activeTabId: string;
	parts: Map<string, SidebarRailComponent>;
}

export function getSidebarState(tui: TUI): StandaloneSidebarState {
	const terminal = tui.terminal as unknown as Record<symbol, StandaloneSidebarState>;
	return (terminal[STATE] ??= {
		active: false,
		activeTabId: "main",
		parts: new Map(),
	});
}

export function registerSidebarPart(
	tui: TUI,
	key: string,
	component: SidebarRailComponent,
): () => void {
	const state = getSidebarState(tui);
	state.parts.set(key, component);
	return () => {
		if (state.parts.get(key) === component) {
			state.parts.delete(key);
		}
	};
}
