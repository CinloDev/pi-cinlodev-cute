import { truncateToWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderSidebarTabBar, SIDEBAR_TABS, type TabHitbox } from "./sidebar-tabs.ts";
import type { CardTheme } from "./card-frame.ts";
import { GitGraphCard, WorkingTreeCard } from "./cards/git-card.ts";
import { ProjectTreeCard } from "./cards/tree-card.ts";
import { EngramCard, ToolsCard } from "./cards/mem-card.ts";

const GENTLE_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");

export function attachMultitabSidebar(
	tui: TUI,
	cwd: string,
	theme?: CardTheme,
	ctxProvider?: () => any,
): boolean {
	const term = tui.terminal as unknown as Record<symbol, any> | undefined;
	const gentleState = term?.[GENTLE_STATE];

	if (!gentleState || !(gentleState.parts instanceof Map)) {
		setTimeout(() => {
			attachMultitabSidebar(tui, cwd, theme, ctxProvider);
		}, 50)?.unref?.();
		return false;
	}

	if ((tui as any).__cinlodevSidebarAttached) {
		return true;
	}
	(tui as any).__cinlodevSidebarAttached = true;

	let originalFooter = gentleState.parts.get("footer") as Component | undefined;

	const gitGraph = new GitGraphCard(cwd, theme);
	const workingTree = new WorkingTreeCard(cwd, theme);
	const projectTree = new ProjectTreeCard(cwd, theme);
	const engram = new EngramCard(cwd, theme);
	const tools = new ToolsCard(theme, ctxProvider);

	let activeTabId = "main";
	let lastHitboxes: TabHitbox[] = [];
	let cardOffsets: Array<{ component: any; startY: number; height: number }> = [];

	const compositeRail: Component & { digest(): string } = {
		digest() {
			if (activeTabId === "main") {
				return `cinlo:main:${(originalFooter as any)?.digest?.() ?? ""}`;
			}
			if (activeTabId === "git") {
				return `cinlo:git:${gitGraph.digest()}:${workingTree.digest()}`;
			}
			if (activeTabId === "mem") {
				return `cinlo:mem:${engram.digest()}:${tools.digest()}`;
			}
			if (activeTabId === "tree") {
				return `cinlo:tree:${projectTree.digest()}`;
			}
			return activeTabId;
		},

		render(width: number): string[] {
			const termRows = tui.terminal?.rows ?? 45;
			const tabBarResult = renderSidebarTabBar(width, activeTabId, theme);
			lastHitboxes = tabBarResult.hitboxes;

			const lines: string[] = [
				tabBarResult.line,
				tabBarResult.divider,
				"",
			];

			cardOffsets = [];
			const headerLinesCount = 3;
			const availableHeight = Math.max(10, termRows - headerLinesCount);

			if (activeTabId === "main") {
				if (originalFooter) {
					const startY = lines.length;
					const fLines = originalFooter.render(width) ?? [];
					lines.push(...fLines);
					cardOffsets.push({ component: originalFooter, startY, height: fLines.length });
				}
			} else if (activeTabId === "git") {
				const half = Math.floor(Math.max(12, availableHeight - 1) / 2);

				const gStart = lines.length;
				const gLines = gitGraph.render(width, half);
				lines.push(...gLines);
				cardOffsets.push({ component: gitGraph, startY: gStart, height: gLines.length });

				lines.push("");

				const wtStart = lines.length;
				const wtLines = workingTree.render(width, half);
				lines.push(...wtLines);
				cardOffsets.push({ component: workingTree, startY: wtStart, height: wtLines.length });
			} else if (activeTabId === "mem") {
				const eStart = lines.length;
				const eLines = engram.render(width);
				lines.push(...eLines);
				cardOffsets.push({ component: engram, startY: eStart, height: eLines.length });

				lines.push("");

				const tStart = lines.length;
				const tLines = tools.render(width);
				lines.push(...tLines);
				cardOffsets.push({ component: tools, startY: tStart, height: tLines.length });
			} else if (activeTabId === "tree") {
				const treeStart = lines.length;
				const treeLines = projectTree.render(width, availableHeight);
				lines.push(...treeLines);
				cardOffsets.push({ component: projectTree, startY: treeStart, height: treeLines.length });
			}

			return lines.map((line) => truncateToWidth(line, width, ""));
		},

		handleMouse(event: TuiMouseEvent): { handled: boolean; render?: boolean } | undefined {
			// 1. TabBar interaction (rows 0 or 1)
			if (event.y === 0 || event.y === 1) {
				if (event.type === "click" && (!event.button || event.button === "left" || (event.button as any) === 0)) {
					let hitTab = lastHitboxes.find((h) => event.x >= h.startX && event.x < h.endX);
					if (!hitTab && lastHitboxes.length > 0) {
						for (let i = 0; i < lastHitboxes.length; i++) {
							const h = lastHitboxes[i]!;
							const next = lastHitboxes[i + 1];
							if (next && event.x >= h.endX && event.x < next.startX) {
								const mid = (h.endX + next.startX) / 2;
								hitTab = event.x < mid ? h : next;
								break;
							}
						}
						if (!hitTab) {
							if (event.x < lastHitboxes[0]!.startX) hitTab = lastHitboxes[0];
							else if (event.x >= lastHitboxes[lastHitboxes.length - 1]!.endX) hitTab = lastHitboxes[lastHitboxes.length - 1];
						}
					}
					if (hitTab) {
						activeTabId = hitTab.id;
						gentleState.visibility = {
							...gentleState.visibility,
							todo: activeTabId === "main",
						};
						tui.requestRender();
						return { handled: true, render: true };
					}
				} else if (event.type === "wheel" && event.wheelDelta !== 0) {
					const delta = (event.wheelDelta ?? 0) > 0 ? 1 : -1;
					const currentIndex = SIDEBAR_TABS.findIndex((t) => t.id === activeTabId);
					const nextIndex = (currentIndex + delta + SIDEBAR_TABS.length) % SIDEBAR_TABS.length;
					activeTabId = SIDEBAR_TABS[nextIndex]?.id ?? "main";
					gentleState.visibility = {
						...gentleState.visibility,
						todo: activeTabId === "main",
					};
					tui.requestRender();
					return { handled: true, render: true };
				}
			}

			// 2. Delegate to active cards based on Y line offsets
			for (const offset of cardOffsets) {
				if (event.y >= offset.startY && event.y < offset.startY + offset.height) {
					const localY = event.y - offset.startY;
					if (typeof offset.component.handleMouse === "function") {
						const res = offset.component.handleMouse({
							...event,
							y: localY,
						});
						if (res?.handled) {
							tui.requestRender();
							return res;
						}
					}
					if (event.type === "click" && typeof offset.component.handleRailClick === "function") {
						const handled = offset.component.handleRailClick(localY, event.button, event.x);
						if (handled) {
							tui.requestRender();
							return { handled: true, render: true };
						}
					}
					if (event.type === "wheel" && typeof offset.component.handleRailWheel === "function") {
						const handled = offset.component.handleRailWheel(event.wheelDelta ?? 0);
						if (handled) {
							tui.requestRender();
							return { handled: true, render: true };
						}
					}
				}
			}

			return undefined;
		},

		invalidate() {
			if (activeTabId === "main") originalFooter?.invalidate?.();
			else if (activeTabId === "git") { gitGraph.invalidate(); workingTree.invalidate(); }
			else if (activeTabId === "mem") { engram.invalidate(); tools.invalidate(); }
			else if (activeTabId === "tree") projectTree.invalidate();
		},
	};

	// Intercept gentleState.parts.set to ensure compositeRail is ALWAYS preserved
	const origSet = gentleState.parts.set.bind(gentleState.parts);
	gentleState.parts.set = function (key: string, value: any) {
		if (key === "footer" && value !== compositeRail) {
			originalFooter = value;
			return origSet("footer", compositeRail);
		}
		return origSet(key, value);
	};

	origSet("footer", compositeRail);
	const GENTLE_CACHE = Symbol.for("gentle-pi.experimental-sidebar.cache");
	const cache = (term as any)?.[GENTLE_CACHE];
	if (cache && typeof cache.revision === "number") {
		cache.revision++;
	}
	tui.requestRender();
	return true;
}
