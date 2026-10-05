import type { ScrollView } from "@earendil-works/pi-tui";

// Layout symbol shared with Pi and pi-tui
export const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

export interface DockMetrics {
	totalHeight: number;
	visibleInputBottomOffset: number;
}

/**
 * Inspects the Dock layout entries in Pi's chat viewport to calculate
 * the dock total height and the exact row where the visible input box ends.
 * Used to align the bottom of the sidebar rail with the prompt's bottom frame.
 */
export function measureDockMetrics(
	dock: any,
	width: number,
): DockMetrics {
	if (!dock || !Array.isArray(dock.entries)) return { totalHeight: 7, visibleInputBottomOffset: 5 };
	let totalHeight = 0;
	let visibleInputBottomOffset: number | undefined;

	for (const entry of dock.entries) {
		if (entry?.component && typeof entry.component.render === "function") {
			try {
				const lines = entry.component.render(width);
				if (Array.isArray(lines)) {
					// In Pi's createChatViewport, the editor component is configured with minSize: 3 or is a Box component
					if (
						visibleInputBottomOffset === undefined &&
						(entry.minSize === 3 || entry.component?.constructor?.name === "Box")
					) {
						for (let i = lines.length - 1; i >= 0; i--) {
							if (lines[i].trim().length > 0) {
								visibleInputBottomOffset = totalHeight + i;
								break;
							}
						}
					}
					totalHeight += lines.length;
				}
			} catch {}
		}
	}

	return {
		totalHeight: Math.max(3, totalHeight),
		visibleInputBottomOffset: Math.max(3, visibleInputBottomOffset ?? totalHeight),
	};
}

export function measureDockHeight(dock: any, width: number): number {
	return measureDockMetrics(dock, width).totalHeight;
}

export function getVisibleInputBottomOffset(dock: any, width: number): number {
	return measureDockMetrics(dock, width).visibleInputBottomOffset;
}

/**
 * Traverses Pi's layout tree to locate the Dock container containing the input editor.
 */
export function findDock(root: unknown): any {
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

/**
 * Recursively locates the main ScrollView transcript component within the TUI tree.
 */
export function findTranscript(root: unknown, depth = 0): ScrollView | undefined {
	if (!root || typeof root !== "object" || depth > 12) return undefined;
	if ("scrollbar" in root && typeof (root as any).setScrollbar === "function") {
		return root as ScrollView;
	}
	const entries = (root as any).entries;
	if (Array.isArray(entries)) {
		for (const entry of entries) {
			const found = findTranscript(entry?.component, depth + 1);
			if (found) return found;
		}
	}
	const children = (root as any).children;
	if (Array.isArray(children)) {
		for (const child of children) {
			const found = findTranscript(child, depth + 1);
			if (found) return found;
		}
	}
	// Descend through custom layout nodes (e.g. gentle-shell wrapping the tree)
	if (typeof (root as any)[NODE] === "function") {
		try {
			const node = (root as any)[NODE]();
			if (node && Array.isArray(node.entries)) {
				for (const entry of node.entries) {
					const found = findTranscript(entry?.component, depth + 1);
					if (found) return found;
				}
			}
		} catch {}
	}
	return undefined;
}
