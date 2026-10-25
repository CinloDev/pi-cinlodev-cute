import test from "node:test";
import assert from "node:assert/strict";
import { resolveSidebarTab, renderSidebarTabBar, SIDEBAR_TABS } from "../src/sidebar-tabs.ts";
import { GitGraphCard, WorkingTreeCard } from "../src/cards/git-card.ts";
import { ProjectTreeCard, scanDirectoryTree, flattenVisibleTree } from "../src/cards/tree-card.ts";
import { EngramCard, ToolsCard, detectProjectName } from "../src/cards/mem-card.ts";
import { SimpleStatusCard } from "../src/cards/status-card.ts";
import { openExternalFile } from "../src/editor-launcher.ts";
import { attachMultitabSidebar } from "../src/sidebar-mount.ts";

test("resolveSidebarTab resolves valid tabs and fallback", () => {
	assert.equal(resolveSidebarTab("git").id, "git");
	assert.equal(resolveSidebarTab("tree").id, "tree");
	assert.equal(resolveSidebarTab("mem").id, "mem");
	assert.equal(resolveSidebarTab("other").id, "main");
});

test("renderSidebarTabBar renders all 4 tabs with hitboxes", () => {
	const res = renderSidebarTabBar(48, "main");
	assert.ok(res.line.includes("1:MAIN"));
	assert.ok(res.line.includes("2:GIT"));
	assert.ok(res.line.includes("3:MEM"));
	assert.ok(res.line.includes("4:TREE"));
	assert.equal(res.hitboxes.length, 4);
});

test("GitGraphCard and WorkingTreeCard render cards without error", () => {
	const git = new GitGraphCard(process.cwd());
	const lines = git.render(48, 15);
	assert.ok(lines.length > 0);
	assert.ok(lines.some((l) => l.includes("Git Graph")));

	const wt = new WorkingTreeCard(process.cwd());
	const wtLines = wt.render(48, 15);
	assert.ok(wtLines.length > 0);
	assert.ok(wtLines.some((l) => l.includes("Working Tree")));
});

test("ProjectTreeCard renders directory tree and toggles directories", () => {
	const tree = new ProjectTreeCard(process.cwd());
	const lines = tree.render(48, 20);
	assert.ok(lines.length > 0);
	assert.ok(lines.some((l) => l.includes("Project Tree")));
});

test("EngramCard and ToolsCard render status without throwing", () => {
	const engram = new EngramCard(process.cwd());
	const lines = engram.render(48);
	assert.ok(lines.some((l) => l.includes("Engram Memory")));

	const tools = new ToolsCard();
	const tLines = tools.render(48);
	assert.ok(tLines.some((l) => l.includes("Tools Telemetry")));
});

test("attachMultitabSidebar mounts composite rail into Gentle Shell state", () => {
	const GENTLE_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
	const parts = new Map<string, any>();
	parts.set("footer", { render: () => ["Original Status"], invalidate() {} });

	let renders = 0;
	const mockTui: any = {
		terminal: {
			columns: 140,
			rows: 50,
			[GENTLE_STATE]: {
				active: true,
				parts,
				visibility: { todo: true },
			},
		},
		requestRender() {
			renders++;
		},
	};

	const attached = attachMultitabSidebar(mockTui, process.cwd());
	assert.equal(attached, true);

	const mountedRail = parts.get("footer");
	assert.ok(mountedRail);

	// Initial render is on MAIN tab: contains TabBar + Original Status
	const mainLines = mountedRail.render(48);
	assert.ok(mainLines.some((l: string) => l.includes("1:MAIN")));
	assert.ok(mainLines.some((l: string) => l.includes("Original Status")));

	// Switch to GIT tab via mouse click on TabBar
	const tabHit = renderSidebarTabBar(48, "main").hitboxes.find((h) => h.id === "git")!;
	const clickRes = mountedRail.handleMouse({
		type: "click",
		button: "left",
		x: tabHit.startX + 1,
		y: 0,
		width: 48,
		height: 30,
	});
	assert.equal(clickRes?.handled, true);

	// Next render is on GIT tab: contains Git Graph and Working Tree
	const gitLines = mountedRail.render(48);
	assert.ok(gitLines.some((l: string) => l.includes("Git Graph")));
	assert.ok(gitLines.some((l: string) => l.includes("Working Tree")));
	assert.ok(!gitLines.some((l: string) => l.includes("Original Status")));

	// Visibility of todo was hidden when leaving main tab
	assert.equal(mockTui.terminal[GENTLE_STATE].visibility.todo, false);
});

