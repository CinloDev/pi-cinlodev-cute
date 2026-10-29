import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	loadCuteLayout,
	mergeLayout,
	mergeSidebar,
	resetCuteLayoutCache,
} from "../src/cute-layout.ts";
import {
	renderCuteSidebarTabBar,
	resolveSidebarTab,
	CUTE_SIDEBAR_TABS,
	installSidebar,
	sidebarState,
	sidebarPart,
	CUTE_LAYOUT_WRAPPER,
	SIDEBAR_TAB_CARD_MAP,
} from "../src/sidebar.ts";
import { renderCUTESidebarBanner } from "../src/sidebar-state.ts";
import { getGitSyncBadge } from "../src/cute-git-graph.ts";
import { measureDockMetrics, findDock, findTranscript } from "../src/sidebar-dock.ts";
import { createSidebarMouseHandler } from "../src/sidebar-mouse.ts";
import { resetAll } from "./test-helpers.ts";

test("sidebar tabs - loadCuteLayout contains tabs defaults and mergeLayout respects overrides", () => {
	resetAll();
	const layout = loadCuteLayout();
	assert.equal(layout.sidebar.tabsEnabled, true);
	assert.equal(layout.sidebar.defaultTab, "1");

	// Overrides via mergeLayout with string
	const mergedString = mergeLayout({
		sidebar: {
			defaultTab: "2",
			tabsEnabled: false,
		},
	});
	assert.equal(mergedString.sidebar.defaultTab, "2");
	assert.equal(mergedString.sidebar.tabsEnabled, false);

	// Overrides via mergeLayout with number
	const mergedNumber = mergeLayout({
		sidebar: {
			defaultTab: 4,
		},
	});
	assert.equal(mergedNumber.sidebar.defaultTab, "4");

	// Overrides via mergeSidebar directly
	const sidebarDirect = mergeSidebar(layout.sidebar, {
		defaultTab: 5,
		tabsEnabled: true,
	});
	assert.equal(sidebarDirect.defaultTab, "5");
	assert.equal(sidebarDirect.tabsEnabled, true);

	// Whitespace string preserves base
	const preserved = mergeSidebar(layout.sidebar, {
		defaultTab: "   ",
	});
	assert.equal(preserved.defaultTab, "1");
});

test("sidebar tabs - renderCuteSidebarTabBar generates expected tabs, non-empty hitboxes, and respects width", () => {
	// 1. Unthemed generation check for tab contents
	const unthemedBar = renderCuteSidebarTabBar(50, "1");
	assert.ok(unthemedBar.line.length > 0);
	assert.ok(unthemedBar.divider.length > 0);
	assert.equal(visibleWidth(unthemedBar.line), 50);
	assert.equal(visibleWidth(unthemedBar.divider), 50);

	// Generates bar with expected tabs: 1:MAIN, 2:GIT, 3:PROF, 4:MEM, 5:TREE
	assert.ok(unthemedBar.line.includes("1:MAIN"));
	assert.ok(unthemedBar.line.includes("2:GIT"));
	assert.ok(unthemedBar.line.includes("3:PROF"));
	assert.ok(unthemedBar.line.includes("4:MEM"));
	assert.ok(unthemedBar.line.includes("5:TREE"));

	// Non-empty hitboxes for canonical tabs
	assert.ok(unthemedBar.hitboxes.length >= 5);
	for (const h of unthemedBar.hitboxes) {
		assert.ok(h.id);
		assert.ok(h.key);
		assert.ok(h.label);
		assert.ok(h.startX < h.endX);
		assert.ok(h.endX <= 50);
	}

	// 2. Themed generation check
	const mockTheme = {
		fg: (role: string, text: string) => `\x1b[38;5;200m${text}\x1b[0m`,
	} as any;
	const themedBar = renderCuteSidebarTabBar(50, "1", mockTheme);
	assert.equal(visibleWidth(themedBar.line), 50);
	assert.equal(visibleWidth(themedBar.divider), 50);
	assert.ok(themedBar.hitboxes.length >= 5);

	// 3. Narrow rail edge case: visibleWidth must never exceed width
	const narrowBar = renderCuteSidebarTabBar(20, "2", mockTheme);
	assert.ok(visibleWidth(narrowBar.line) <= 20, `Narrow line visible width ${visibleWidth(narrowBar.line)} must be <= 20`);
	assert.ok(visibleWidth(narrowBar.divider) <= 20);
	for (const h of narrowBar.hitboxes) {
		assert.ok(h.startX < 20);
		assert.ok(h.endX <= 20);
	}

	// 4. Very narrow rail (width = 5)
	const tinyBar = renderCuteSidebarTabBar(5, "1");
	assert.ok(visibleWidth(tinyBar.line) <= 5);

	// 5. Zero width
	const zeroBar = renderCuteSidebarTabBar(0, "1");
	assert.equal(visibleWidth(zeroBar.line), 0);
	assert.equal(zeroBar.hitboxes.length, 0);
});

test("sidebar tabs - resolveSidebarTab resolves by id and by key", () => {
	// Resolves by key ("1" -> "main", "2" -> "git", "3" -> "prof", etc.)
	assert.equal(resolveSidebarTab("1").id, "main");
	assert.equal(resolveSidebarTab("2").id, "git");
	assert.equal(resolveSidebarTab("3").id, "prof");
	assert.equal(resolveSidebarTab("4").id, "mem");
	assert.equal(resolveSidebarTab("5").id, "tree");

	// Resolves by id and backward-compatible aliases
	assert.equal(resolveSidebarTab("main").id, "main");
	assert.equal(resolveSidebarTab("git").id, "git");
	assert.equal(resolveSidebarTab("prof").id, "prof");
	assert.equal(resolveSidebarTab("agents").id, "prof", "legacy agents tab should map to prof");
	assert.equal(resolveSidebarTab("usage").id, "prof", "legacy usage tab should map to prof");
	assert.equal(resolveSidebarTab("forge").id, "prof", "forge should be backward compatible alias for prof");
	assert.equal(resolveSidebarTab("mem").id, "mem");
	assert.equal(resolveSidebarTab("tree").id, "tree");
	assert.equal(resolveSidebarTab("0").id, "main", "legacy 0/all tab should safely fall back to main");

	// SIDEBAR_TAB_CARD_MAP checks - clean canonical 5 tabs
	assert.ok(SIDEBAR_TAB_CARD_MAP.prof.includes("cute-profiles"), "SIDEBAR_TAB_CARD_MAP.prof must include cute-profiles");
	assert.equal(SIDEBAR_TAB_CARD_MAP.agents, undefined, "legacy agents should be pruned from map");
	assert.equal(SIDEBAR_TAB_CARD_MAP.forge, undefined, "legacy forge should be pruned from map");
	assert.equal(SIDEBAR_TAB_CARD_MAP.usage, undefined, "legacy usage should be pruned from map");

	// Fallback to main on undefined or invalid
	assert.equal(resolveSidebarTab(undefined).id, "main");
	assert.equal(resolveSidebarTab("").id, "main");
	assert.equal(resolveSidebarTab("invalid").id, "main");

	// Tab properties (canonical tabs: main, git, prof, mem, tree, yt)
	assert.ok(CUTE_SIDEBAR_TABS.length >= 5, "CUTE_SIDEBAR_TABS must contain at least 5 canonical tabs");
	for (const tab of CUTE_SIDEBAR_TABS) {
		assert.ok(tab.id);
		assert.ok(tab.key);
		assert.ok(tab.label);
		assert.ok(Array.isArray(tab.cards) && tab.cards.length > 0);
	}
});

test("sidebar tabs - mock TUI tab switching via click and wheel cycling", () => {
	resetAll();
	const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

	let renderRequests = 0;
	const mockLayoutRoot: any = {
		render: () => ["line1", "line2"],
		invalidate: () => {},
	};
	mockLayoutRoot[NODE] = () => ({
		type: "hstack",
		entries: [
			{ component: mockLayoutRoot, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		],
	});

	const mockTui: any = {
		terminal: { columns: 160, rows: 40 },
		mode: "fullscreen",
		layoutRoot: mockLayoutRoot,
		requestRender: () => {
			renderRequests++;
		},
	};

	const cleanup = installSidebar(mockTui);
	try {
		const state = sidebarState(mockTui);
		// Call replacement to trigger prepare() and mount rail
		const nodeResult = mockLayoutRoot[NODE]();
		assert.ok(nodeResult.entries.length >= 2, "Should mount rail entries");

		const scrollEntry = nodeResult.entries.find((e: any) => e.component && typeof e.component.handleMouse === "function");
		assert.ok(scrollEntry, "ScrollView component must be mounted");
		const scroll = scrollEntry.component;

		// Initial tab should resolve to defaultTab ("1" -> "main")
		assert.equal(state.activeTabId, "main");

		const layout = loadCuteLayout().sidebar;
		const netWidth = layout.railWidth - 2 * layout.railPadding;
		const { hitboxes } = renderCuteSidebarTabBar(netWidth, "main");
		const gitHitbox = hitboxes.find((h) => h.id === "git");
		assert.ok(gitHitbox, "Git hitbox must exist");

		// Click on TabBar at line 3 (with branding separator: line 0 top pad, line 1 banner, line 2 blank, line 3 tab bar) over Git tab hitbox
		const clickResult = scroll.handleMouse({
			type: "click",
			button: "left",
			x: gitHitbox.startX + layout.railPadding + 1,
			y: 3,
		});
		assert.ok(clickResult.handled, "Click on tab bar should be handled");
		assert.equal(state.activeTabId, "git", "Active tab should switch to git after click");
		assert.ok(renderRequests > 0, "requestRender should be called on click");

		const prevRenderCount = renderRequests;

		// Wheel forward (wheelDelta > 0) -> cycles from git (index 1) to prof (index 2)
		const wheelResult = scroll.handleMouse({
			type: "wheel",
			wheelDelta: 1,
			x: 10,
			y: 3,
		});
		assert.ok(wheelResult.handled, "Wheel on tab bar should be handled");
		assert.equal(state.activeTabId, "prof", "Wheel delta +1 should cycle tab from git to prof");
		assert.ok(renderRequests > prevRenderCount, "requestRender should be called on wheel");

		// Wheel backward (wheelDelta < 0) -> cycles back from prof (index 2) to git (index 1)
		scroll.handleMouse({
			type: "wheel",
			wheelDelta: -1,
			x: 10,
			y: 3,
		});
		assert.equal(state.activeTabId, "git", "Wheel delta -1 should cycle tab back to git");

		// Wheel backward again -> from git (index 1) to main (index 0)
		scroll.handleMouse({
			type: "wheel",
			wheelDelta: -1,
			x: 10,
			y: 3,
		});
		assert.equal(state.activeTabId, "main", "Wheel delta -1 should cycle to main");

		// Wheel backward from main (index 0) wraps to last tab
		const lastTab = CUTE_SIDEBAR_TABS[CUTE_SIDEBAR_TABS.length - 1];
		scroll.handleMouse({
			type: "wheel",
			wheelDelta: -1,
			x: 10,
			y: 3,
		});
		assert.equal(state.activeTabId, lastTab.id, `Wheel delta -1 from index 0 should wrap to ${lastTab.id}`);
	} finally {
		cleanup();
		resetAll();
	}
});

test("sidebar integration - gentle-shell wrapper cooperative coexistence (header preserved, foreign rail replaced, CUTE_LAYOUT_WRAPPER marked, idempotent)", () => {
	resetAll();
	const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

	const foreignHeader: any = {
		render: () => ["LIVE HEADER"],
		invalidate: () => {},
	};
	const foreignLeft: any = {
		render: () => ["transcript line 1", "dock line"],
		invalidate: () => {},
	};
	const foreignRail: any = {
		render: () => ["gentle shell monolithic rail"],
		invalidate: () => {},
	};

	const foreignHstackNode = {
		type: "hstack",
		entries: [
			{ component: foreignLeft, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: foreignRail, basis: 50, grow: 0, shrink: 0, minSize: 50 },
		],
	};

	const foreignBodyComponent: any = {
		render: () => [],
		invalidate: () => {},
		[NODE]: () => foreignHstackNode,
	};

	const mockLayoutRoot: any = {
		render: () => ["root"],
		invalidate: () => {},
	};

	// Simulate gentle-shell layout wrapper: vstack [header, body]
	mockLayoutRoot[NODE] = () => ({
		type: "vstack",
		entries: [
			{ component: foreignHeader, basis: 2, grow: 0, shrink: 0, minSize: 2 },
			{ component: foreignBodyComponent, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		],
	});

	let renderRequests = 0;
	const mockTui: any = {
		terminal: { columns: 160, rows: 40 },
		mode: "fullscreen",
		layoutRoot: mockLayoutRoot,
		requestRender: () => {
			renderRequests++;
		},
	};

	const cleanup = installSidebar(mockTui);
	try {
		// 1. CUTE_LAYOUT_WRAPPER marker must be present on root[NODE]
		assert.equal(typeof mockLayoutRoot[NODE], "function");
		assert.equal((mockLayoutRoot[NODE] as any)[CUTE_LAYOUT_WRAPPER], true);

		// 2. Unpack layout node
		const nodeResult = mockLayoutRoot[NODE]();
		assert.equal(nodeResult.type, "vstack", "Top-level layout should be vstack preserving header");
		assert.equal(nodeResult.entries.length, 2, "vstack must have 2 entries: header and cute container");

		// Header entry is preserved at top
		assert.equal(nodeResult.entries[0].component, foreignHeader, "Header entry component must be preserved");

		// Body entry wraps cuteHstack
		const cuteContainer = nodeResult.entries[1].component;
		assert.ok(cuteContainer, "Cute container component must exist");
		assert.equal(typeof cuteContainer[NODE], "function", "Cute container must have [NODE]");

		const cuteHstack = cuteContainer[NODE]();
		assert.equal(cuteHstack.type, "hstack", "Cute container node must be hstack");

		// foreignRail should be discarded, foreignLeft should be preserved
		const hasForeignRail = cuteHstack.entries.some((e: any) => e.component === foreignRail);
		assert.equal(hasForeignRail, false, "Monolithic gentle-shell rail must be discarded");

		const hasForeignLeft = cuteHstack.entries.some((e: any) => e.component === foreignLeft);
		assert.equal(hasForeignLeft, true, "Prepared left component (transcript/dock) must be preserved");

		// CUTE tabbed rail (ScrollView with handleMouse) must be mounted
		const scrollEntry = cuteHstack.entries.find((e: any) => e.component && typeof e.component.handleMouse === "function");
		assert.ok(scrollEntry, "CUTE tabbed ScrollView must be mounted in place of foreign rail");

		// 3. Idempotency: re-attaching does not double-wrap or overwrite
		const currentWrapper = mockLayoutRoot[NODE];
		const cleanup2 = installSidebar(mockTui);
		assert.equal(mockLayoutRoot[NODE], currentWrapper, "Re-attaching must not double-wrap root[NODE]");
		cleanup2();
	} finally {
		cleanup();
		resetAll();
	}
});

test("sidebar integration - direct hstack without header discards foreign rail and preserves left", () => {
	resetAll();
	const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

	const foreignLeft: any = {
		render: () => ["transcript line 1"],
		invalidate: () => {},
	};
	const foreignRail: any = {
		render: () => ["foreign rail"],
		invalidate: () => {},
	};

	const mockLayoutRoot: any = {
		render: () => ["root"],
		invalidate: () => {},
	};

	mockLayoutRoot[NODE] = () => ({
		type: "hstack",
		entries: [
			{ component: foreignLeft, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: foreignRail, basis: 50, grow: 0, shrink: 0, minSize: 50 },
		],
	});

	const mockTui: any = {
		terminal: { columns: 160, rows: 40 },
		mode: "fullscreen",
		layoutRoot: mockLayoutRoot,
		requestRender: () => {},
	};

	const cleanup = installSidebar(mockTui);
	try {
		assert.equal((mockLayoutRoot[NODE] as any)[CUTE_LAYOUT_WRAPPER], true);

		const nodeResult = mockLayoutRoot[NODE]();
		assert.equal(nodeResult.type, "hstack", "Layout should be hstack without header");

		const hasForeignRail = nodeResult.entries.some((e: any) => e.component === foreignRail);
		assert.equal(hasForeignRail, false, "Foreign rail must be discarded");

		const hasForeignLeft = nodeResult.entries.some((e: any) => e.component === foreignLeft);
		assert.equal(hasForeignLeft, true, "Foreign left must be used as main left");

		const scrollEntry = nodeResult.entries.find((e: any) => e.component && typeof e.component.handleMouse === "function");
		assert.ok(scrollEntry, "CUTE tabbed ScrollView must be mounted");
	} finally {
		cleanup();
		resetAll();
	}
});

test("sidebar card height - activeTranscript viewportHeight aligns card height to input line", () => {
	resetAll();
	const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

	const mockTranscript: any = {
		scrollbar: "auto",
		setScrollbar: () => {},
		viewportHeight: 48,
		render: () => ["transcript line 1"],
		invalidate: () => {},
	};

	const foreignRail: any = {
		render: () => ["foreign rail"],
		invalidate: () => {},
	};

	const mockLayoutRoot: any = {
		render: () => ["root"],
		invalidate: () => {},
	};

	mockLayoutRoot[NODE] = () => ({
		type: "hstack",
		entries: [
			{ component: mockTranscript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: foreignRail, basis: 50, grow: 0, shrink: 0, minSize: 50 },
		],
	});

	const mockTui: any = {
		terminal: { columns: 160, rows: 54 },
		mode: "fullscreen",
		layoutRoot: mockLayoutRoot,
		requestRender: () => {},
	};

	const cleanup = installSidebar(mockTui);
	try {
		const state = sidebarState(mockTui);

		// 1. Test "tree" tab (single card: projectTree)
		state.activeTabId = "tree";
		const nodeResult = mockLayoutRoot[NODE]();
		assert.ok(nodeResult.entries.length >= 2, "HStack must contain entries");

		const treeCard = state.parts.get("projectTree") as CinlodevProjectTreeCard;
		assert.ok(treeCard, "projectTree card should be registered in state.parts");

		// Header lines: banner (2) + tab bar (2) + spacing before cards (1) = 5 lines
		// Available card height = 48 (transcript viewportHeight) - 5 (headerLines) = 43 lines
		const layout = loadCuteLayout().sidebar;
		const netWidth = layout.railWidth - layout.railPadding * 2;
		const treeLines = treeCard.render(netWidth, 43);

		assert.equal(treeLines.length, 43, "Tree card must render 43 lines (48 - headerLines)");
		assert.ok(treeLines[42].includes("╚") || treeLines[42].includes("═") || treeLines[42].includes("─"), "Bottom line must be card bottom border");

		// 2. Test "prof" tab (single card: cute-profiles)
		state.activeTabId = "prof";
		mockLayoutRoot[NODE]();
		const profCard = state.parts.get("cute-profiles") as CinlodevProfilesExtendedCard;
		assert.ok(profCard, "cute-profiles card should be registered in state.parts");

		const profLines = profCard.render(netWidth, 43);
		assert.equal(profLines.length, 43, "Profiles card must render 43 lines (48 - headerLines)");
		assert.ok(profLines[42].includes("╚") || profLines[42].includes("═") || profLines[42].includes("─"), "Bottom line must be card bottom border");
	} finally {
		cleanup();
		resetAll();
	}
});


test("sidebar tabs - switching to git tab renders 2 cards at 50/50 split without errors", () => {
	resetAll();
	const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

	const mockLayoutRoot: any = {
		render: () => ["line1", "line2"],
		invalidate: () => {},
	};
	mockLayoutRoot[NODE] = () => ({
		type: "hstack",
		entries: [
			{ component: mockLayoutRoot, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: { render: () => [] }, basis: 50, grow: 0, shrink: 0, minSize: 50 },
		],
	});

	const mockTui: any = {
		terminal: { columns: 160, rows: 40 },
		mode: "fullscreen",
		layoutRoot: mockLayoutRoot,
		requestRender: () => {},
	};

	const cleanup = installSidebar(mockTui);
	try {
		const state = sidebarState(mockTui);
		// Mount sidebar wrapper
		mockLayoutRoot[NODE]();

		// Switch to GIT tab
		state.activeTabId = "git";

		const nodeResult = mockLayoutRoot[NODE]();
		assert.ok(nodeResult.entries.length >= 3, "Layout should have at least left, divider, and rail entries");
		const scrollEntry = nodeResult.entries.find((e: any) => e.component && typeof e.component.handleMouse === "function");
		assert.ok(scrollEntry, "ScrollView rail entry must be mounted");

		const layout = loadCuteLayout().sidebar;
		const railLines = scrollEntry.component.render(layout.railWidth);
		assert.ok(railLines.length > 10, "Git tab rail must render lines");

		const joined = railLines.join("\n");
		assert.ok(joined.includes("git graph"), "Git tab rail must render upper card 'git graph'");
		assert.ok(joined.includes("Working Tree"), "Git tab rail must render lower card 'Working Tree'");
	} finally {
		cleanup();
		resetAll();
	}
});


test("sidebar tabs - switching to prof tab renders cute-profiles filling full height", () => {
	resetAll();
	const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

	const mockLayoutRoot: any = {
		render: () => ["line1", "line2"],
		invalidate: () => {},
	};
	mockLayoutRoot[NODE] = () => ({
		type: "hstack",
		entries: [
			{ component: mockLayoutRoot, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: { render: () => [] }, basis: 50, grow: 0, shrink: 0, minSize: 50 },
		],
	});

	const mockTui: any = {
		terminal: { columns: 160, rows: 40 },
		mode: "fullscreen",
		layoutRoot: mockLayoutRoot,
		requestRender: () => {},
	};

	const cleanup = installSidebar(mockTui);
	try {
		const state = sidebarState(mockTui);
		mockLayoutRoot[NODE]();

		// Switch to PROF tab
		state.activeTabId = "prof";

		const nodeResult = mockLayoutRoot[NODE]();
		const scrollEntry = nodeResult.entries.find((e: any) => e.component && typeof e.component.handleMouse === "function");
		assert.ok(scrollEntry, "ScrollView rail entry must be mounted");

		const layout = loadCuteLayout().sidebar;
		const railLines = scrollEntry.component.render(layout.railWidth);
		const joined = railLines.join("\n");
		assert.ok(joined.includes("Profiles & Clusters"), "Prof tab rail must render 'Profiles & Clusters'");
		assert.ok(!joined.includes("MODELO DEDICADO"), "Non-pool models must not render dummy model card");
		assert.ok(railLines.length >= 30, `Prof rail should have full height, got ${railLines.length}`);
	} finally {
		cleanup();
		resetAll();
	}
});


test("CinlodevCutePoolCard - renders pool telemetry when pool model is active and hides on dedicated model", async () => {
	const { CinlodevCutePoolCard } = await import("../src/cpamc/pool-card.ts");

	const mockPoolCtx: any = {
		model: { id: "cpamc/Pool-01-gemini", provider: "cpamc" },
		hasUI: true,
	};

	const poolCard = new CinlodevCutePoolCard(undefined, undefined, mockPoolCtx);
	const poolLines = poolCard.render(50);
	assert.ok(poolLines.length > 0, "Pool card must render lines when model has 'Pool-'");
	const joinedPool = poolLines.join("\n");
	assert.ok(joinedPool.includes("CUENTAS CPAMC"), "Must include pool header title");
	assert.ok(joinedPool.includes("TRABAJANDO AHORA"), "Must include working now row");
	assert.ok(joinedPool.includes("CUIDANDO EL CHAT"), "Must include chat care row");
	assert.ok(joinedPool.includes("LA QUE SIGUE"), "Must include next row");

	const mockDedicatedCtx: any = {
		model: { id: "cilon-gpt/gpt-6.1-sol", provider: "cpamc" },
		hasUI: true,
	};
	const dedicatedCard = new CinlodevCutePoolCard(undefined, undefined, mockDedicatedCtx);
	const dedicatedLines = dedicatedCard.render(50);
	assert.equal(dedicatedLines.length, 0, "Dedicated models must yield 0 lines");
});


test("sidebar-dock - measureDockMetrics, findDock and findTranscript execute safely", async () => {
	const { measureDockMetrics, measureDockHeight, getVisibleInputBottomOffset, findDock, findTranscript } = await import("../src/sidebar-dock.ts");

	// Casos base nulos / vacíos
	const emptyMetrics = measureDockMetrics(null, 50);
	assert.deepEqual(emptyMetrics, { totalHeight: 7, visibleInputBottomOffset: 5 });
	assert.equal(measureDockHeight(null, 50), 7);
	assert.equal(getVisibleInputBottomOffset(null, 50), 5);

	// Mock dock con entries
	const mockDock = {
		entries: [
			{ component: { render: () => ["line 1", "line 2"] } },
			{ minSize: 3, component: { render: () => ["input row 1", "input row 2", "input bottom frame"] } },
			{ component: { render: () => ["status line"] } },
		],
	};
	const metrics = measureDockMetrics(mockDock, 50);
	assert.equal(metrics.totalHeight, 6);
	assert.equal(metrics.visibleInputBottomOffset, 4); // 2 + 2 = 4 (segunda fila de input)

	// findDock
	assert.equal(findDock(null), undefined);
	const mockTreeWithDock = {
		entries: [
			{ component: {} },
			{ component: { entries: [1, 2] } },
		],
	};
	assert.equal(findDock(mockTreeWithDock), mockTreeWithDock.entries[1].component);

	// findTranscript
	const mockScrollView = { scrollbar: "auto", setScrollbar: () => {} };
	const treeWithTranscript = {
		entries: [
			{ component: mockScrollView },
		],
	};
	assert.equal(findTranscript(treeWithTranscript), mockScrollView as any);
});

test("sidebar-state - sidebarState, sidebarPart and renderCUTESidebarBanner operate safely", async () => {
	const { sidebarState, sidebarPart, renderCUTESidebarBanner, SIDEBAR_STATE_KEY } = await import("../src/sidebar-state.ts");

	const mockTerminal: any = {};
	const mockTui: any = { terminal: mockTerminal };

	// Inicialización de estado en el terminal
	const state = sidebarState(mockTui);
	assert.ok(state, "Debe retornar un objeto SidebarState");
	assert.equal(state.active, false);
	assert.equal(mockTerminal[SIDEBAR_STATE_KEY], state, "Debe estar alojado en el símbolo SIDEBAR_STATE_KEY del terminal");

	// Registro de parte
	const bottomComp = { render: () => ["bottom 1"] };
	const railComp = { render: () => ["rail 1"] };
	const part = sidebarPart(mockTui, "testKey", bottomComp, railComp);

	assert.equal(state.parts.get("testKey"), railComp, "Debe registrar railComp en state.parts");
	assert.deepEqual(part.render(50), ["bottom 1"], "Cuando el sidebar no es active, debe renderizar bottom");

	state.active = true;
	state.ownsHost = () => true;
	assert.deepEqual(part.render(50), [], "Cuando el sidebar es active y ownsHost, debe suprimir el bottom retornando []");

	// Banner
	const banner = renderCUTESidebarBanner(50);
	assert.ok(banner.length > 0, "Debe retornar al menos 1 línea de banner");
	assert.ok(banner[0].includes("✿"), "Debe contener el glifo decorativo del banner");
	assert.ok(banner[0].toUpperCase().includes("CINLODEV"), "Debe contener la marca o usuario en el banner");
});


test("sidebar-tabs - gitSyncBadge renders cleanly in TabBar", () => {
	// Git Sync badge en TabBar
	const barWithBadge = renderCuteSidebarTabBar(60, "1", undefined, "▲2");
	assert.ok(barWithBadge.line.includes("2:GIT ▲2"), "Debe incluir el badge ▲2 en la pestaña GIT");

	const activeGitWithBadge = renderCuteSidebarTabBar(60, "2", undefined, "▲1▼1");
	assert.ok(activeGitWithBadge.line.includes("2:GIT ▲1▼1"), "Debe incluir el badge de sync activo en la pestaña GIT");
});


test("installSidebar - terminal.write seals unpainted scrollbar cell in rows with Kitty graphics", () => {
	let outputWritten = "";
	const mockTerminal: any = {
		columns: 80,
		rows: 24,
		write: (data: string) => {
			outputWritten += data;
		},
	};
	const mockTui: any = {
		terminal: mockTerminal,
		mode: "fullscreen",
		requestRender: () => {},
	};

	const uninstall = installSidebar(mockTui);

	const sampleBrokenBuffer =
		"\x1b[4;1H\x1b[2K║   \x1b_Ga=T,f=100,r=3;AAA\x1b\\  Song Title       ║ \x1b[0m\x1b]8;;\x07 \x1b[5;1H";
	mockTerminal.write(sampleBrokenBuffer);

	assert.ok(!outputWritten.includes("║ \x1b[0m\x1b]8;;\x07 \x1b[5;1H"), "No debe dejar el espacio en blanco sin sellar");
	assert.ok(outputWritten.includes("║ \x1b[0m\x1b]8;;\x07║\x1b[5;1H") || outputWritten.includes("║ \x1b[0m\x1b]8;;\x07│\x1b[5;1H"), "Debe inyectar el glifo de riel en la columna del scrollbar");

	uninstall();
	outputWritten = "";
	mockTerminal.write(sampleBrokenBuffer);
	assert.ok(outputWritten.includes("║ \x1b[0m\x1b]8;;\x07 \x1b[5;1H"), "Tras desinstalar debe restaurar el write original");
});

test("installSidebar - terminal.write seals scrollbar cell precisely without shifting into afterPad margin", () => {
	let outputWritten = "";
	const mockTerminal: any = {
		columns: 100,
		rows: 24,
		write: (data: string) => {
			outputWritten += data;
		},
	};
	const mockTui: any = {
		terminal: mockTerminal,
		mode: "fullscreen",
		requestRender: () => {},
	};

	const uninstall = installSidebar(mockTui);

	// Buffer con 4 espacios adicionales de margen (afterPad) a la derecha
	const sampleBufferWithMargin =
		"\x1b[4;1H\x1b[2K║   \x1b_Ga=T,f=100,r=3;AAA\x1b\\  Hurtless       ║ \x1b[0m\x1b]8;;\x07     \x1b[5;1H";
	mockTerminal.write(sampleBufferWithMargin);

	// El glifo debe colocarse inmediatamente tras reset, conservando los 4 espacios de margen restantes
	assert.ok(
		outputWritten.includes("║ \x1b[0m\x1b]8;;\x07║    \x1b[5;1H") ||
		outputWritten.includes("║ \x1b[0m\x1b]8;;\x07│    \x1b[5;1H") ||
		(outputWritten.includes("║ \x1b[0m\x1b]8;;\x07") && outputWritten.includes("    \x1b[5;1H")),
		"Debe sellar en la columna exacta de scrollbar y conservar los espacios de margen a la derecha sin desfasar",
	);

	uninstall();
});


test("sidebar mouse tab switching emits deleteAllKittyImages to clear lingering covers", () => {
	let writes: string[] = [];
	const mockTerminal: any = {
		write: (data: string) => writes.push(data),
	};
	const mockTui: any = {
		terminal: mockTerminal,
		requestRender: () => {},
	};

	const mockScroll: any = {
		scrollBy: () => {},
	};
	const mockState: any = {
		activeTabId: "yt",
		parts: new Map(),
	};

	const tabHitboxes = [
		{ id: "main", startX: 1, endX: 10 },
		{ id: "prof", startX: 11, endX: 20 },
	];

	const mouseHandler = createSidebarMouseHandler({
		scroll: mockScroll,
		state: mockState,
		tui: mockTui,
		getSectionMappings: () => [],
		getTabHitboxes: () => tabHitboxes,
		getTabBarLineIndex: () => 2,
		getTabBarDividerLineIndex: () => 3,
		nativeMouse: () => {},
	});

	// Click sobre tab "prof" en la línea del tab bar
	const res = mouseHandler({
		type: "click",
		button: "left",
		x: 15,
		y: 2,
	});

	assert.equal(res.handled, true);
	assert.equal(mockState.activeTabId, "prof");
	assert.ok(
		writes.some((w) => w.includes("\x1b_Ga=d,d=A,q=2\x1b\\")),
		"Cambiar de pestaña debe emitir deleteAllKittyImages para limpiar cualquier portada gráfica",
	);
});





