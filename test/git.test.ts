import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import {
	colorizeGitGraphLine,
	CinlodevGitGraphCard,
	resetGitGraphCache,
	parseGitStatusPorcelain,
	parseGitNumstat,
	formatGitStatusBadges,
	resetGitStatusCache,
	fetchGitFileChanges,
	resetGitFileChangesCache,
	CinlodevWorkingTreeCard,
	fetchGitBranches,
	fetchBranchDiff,
	getGitTabSelectedBranch,
	setGitTabSelectedBranch,
	getGitTabViewMode,
	setGitTabViewMode,
	resetGitTabState,
	getGitSyncBadge,
	launchFileDiff,
} from "../src/cute-git-graph.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { readGitBranch } from "../src/cute-paths.ts";
import { invalidateSidebarGitAndTree } from "../src/footer.ts";
import { sidebarState } from "../src/sidebar.ts";
import { resetAll } from "./test-helpers.ts";

test("cute-git-graph - colorizeGitGraphLine styles graph edges, hashes and branch refs in Dracula", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	// 1. Pure graph line
	const pureGraph = "|\\  ";
	const coloredGraph = colorizeGitGraphLine(pureGraph, mockTheme);
	assert.ok(coloredGraph.includes("[syntaxFunction]|\\"), "Pipes and backslashes should be styled with syntaxFunction");

	// 2. Commit line with HEAD branch and message
	const commitLine = "* 5b0836f (HEAD -> feat/sidebar-git-graph, origin/develop) Merge PR #73";
	const coloredCommit = colorizeGitGraphLine(commitLine, mockTheme);
	assert.ok(coloredCommit.includes("[accent]*[/accent]"), "* node should be styled in accent (pink)");
	assert.ok(coloredCommit.includes("[syntaxNumber]5b0836f[/syntaxNumber]"), "hash should be styled in syntaxNumber (yellow)");
	assert.ok(coloredCommit.includes("[mint]HEAD -> feat/sidebar-git-graph[/mint]"), "HEAD should be styled in mint");
	assert.ok(coloredCommit.includes("[secondary]origin/develop[/secondary]"), "origin remote should be styled in secondary");
	assert.ok(coloredCommit.includes("[syntaxPunctuation]([/syntaxPunctuation]"), "parentheses should be styled in syntaxPunctuation");
	assert.ok(coloredCommit.includes("[text]Merge PR #73[/text]"), "commit subject should be styled in text");
});

test("cute-git-graph - CinlodevGitGraphCard interactive expansion toggle and rendering", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	let renderRequested = 0;
	const mockTui = {
		requestRender: () => {
			renderRequested++;
		},
	} as any;

	const mockCtx = {
		cwd: process.cwd(),
	} as any;

	const card = new CinlodevGitGraphCard(mockCtx, mockTui, mockTheme);

	// Default expanded is true
	assert.equal(card.isExpanded(), true);

	// Render expanded (wide width for mock theme tags)
	const expandedLines = card.render(220);
	assert.ok(expandedLines.length >= 5, "Expanded graph should have top, spacers, branch, tree, and bottom");
	assert.ok(expandedLines[0].includes("git graph"), "Top bar should contain title 'git graph'");
	// Spacing above branch
	assert.equal(expandedLines[1].replace(/\[\/?border\]|[║\s]/g, "").trim(), "", "Line below top bar should be an empty spacer");
	// Branch row
	const expectedBranchPrefix = readGitBranch(process.cwd()).slice(0, 8);
	assert.ok(expandedLines[2].includes(expectedBranchPrefix), `Line 2 should display branch starting with '${expectedBranchPrefix}'`);
	// Spacing below branch / above tree
	assert.equal(expandedLines[3].replace(/\[\/?border\]|[║\s]/g, "").trim(), "", "Line below branch should be an empty spacer");
	assert.ok(expandedLines[expandedLines.length - 1].includes("╝"), "Bottom border should close the card");

	// Click toggles to collapsed
	const handled = card.handleClick(0);
	assert.equal(handled, true);
	assert.equal(card.isExpanded(), false);
	assert.equal(renderRequested, 1);

	// Render collapsed
	// Wide width: mock syntax tags ([warning]...) count as visible chars in mockTheme
	const collapsedLines = card.render(220);
	assert.equal(collapsedLines.length, 3, "Collapsed graph should have top, 1-line summary, and bottom");
	assert.ok(collapsedLines[0].includes("git"), "Top bar should contain title 'git'");
	assert.ok(collapsedLines[1].includes(readGitBranch(process.cwd())), "Collapsed card should display current branch");

	// Click toggles back to expanded
	card.handleClick(1);
	assert.equal(card.isExpanded(), true);
	assert.equal(renderRequested, 2);

	// Invalidate clears cache
	card.invalidate();
});

test("cute-git-graph - renders session changes below branches when present on sidebarState", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
	const mockTui = {
		requestRender: () => {},
		terminal: {
			[SIDEBAR_STATE]: {
				parts: new Map([
					["changes", {
						render: () => ["✎ 16 files · +990 −42 · partial counts"],
					}],
				]),
			},
		},
	} as any;

	const mockCtx = { cwd: process.cwd() } as any;
	const card = new CinlodevGitGraphCard(mockCtx, mockTui, mockTheme);
	card.setExpanded(true);

	const lines = card.render(50);
	const joined = lines.join("\n");
	assert.ok(joined.includes("16 files · +990 −42"), "Card should render session changes row below branches");
	// Spacer between commit tree and changes row
	assert.equal(lines[lines.length - 3].replace(/\[\/?border\]|[║\s]/g, "").trim(), "", "Line above changes row should be an empty spacer");
	// The changes row should be right above the bottom border
	assert.ok(lines[lines.length - 2].includes("16 files · +990 −42"));
	assert.ok(lines[lines.length - 1].includes("╝"));
});

test("cute-git-graph - parseGitStatusPorcelain and formatGitStatusBadges", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	// 1. Clean status
	const cleanCounts = parseGitStatusPorcelain("");
	assert.equal(cleanCounts.isClean, true);
	assert.equal(cleanCounts.staged, 0);
	assert.equal(cleanCounts.modified, 0);
	assert.equal(cleanCounts.untracked, 0);

	const cleanBadge = formatGitStatusBadges(cleanCounts, mockTheme);
	assert.ok(cleanBadge.includes("[mint]✔ clean[/mint]"));

	// 2. Dirty porcelain sample
	const porcelainSample = `
M  src/staged-mod.ts
 M src/unstaged-mod.ts
A  src/new-staged.ts
?? untracked-file.txt
UU conflicted-file.ts
`.trim();

	const dirtyCounts = {
		...parseGitStatusPorcelain(porcelainSample),
		linesAdded: 15,
		linesDeleted: 3,
	};
	assert.equal(dirtyCounts.isClean, false);
	assert.equal(dirtyCounts.staged, 2); // 'M ' and 'A '
	assert.equal(dirtyCounts.modified, 1); // ' M'
	assert.equal(dirtyCounts.untracked, 1); // '??'
	assert.equal(dirtyCounts.conflicts, 1); // 'UU'
	assert.equal(dirtyCounts.linesAdded, 15);
	assert.equal(dirtyCounts.linesDeleted, 3);

	const dirtyBadge = formatGitStatusBadges(dirtyCounts, mockTheme);
	assert.ok(dirtyBadge.includes("[warning]● 1 mod[/warning]"));
	assert.ok(dirtyBadge.includes("[mint]+2 staged[/mint]"));
	assert.ok(dirtyBadge.includes("[secondary]?1 untracked[/secondary]"));
	assert.ok(dirtyBadge.includes("[error]✖ 1 conflict[/error]"));

	// 3. Test parseGitNumstat with normal lines and binaries
	const numstatOutput = "12\t4\tsrc/a.ts\n50\t0\tsrc/b.ts\n-\t-\timage.png\n";
	const parsedStats = parseGitNumstat(numstatOutput);
	assert.equal(parsedStats.linesAdded, 62);
	assert.equal(parsedStats.linesDeleted, 4);
});


test("cute-git-graph - CinlodevWorkingTreeCard rendering and toggle", () => {
	resetAll();
	const mockCtx: any = { cwd: process.cwd() };
	let renderRequested = false;
	const mockTui: any = {
		requestRender: () => {
			renderRequested = true;
		},
	};

	const changes = fetchGitFileChanges(process.cwd());
	assert.ok(Array.isArray(changes));

	const card = new CinlodevWorkingTreeCard(mockCtx, mockTui, undefined);

	// 1. Render in width 50
	const lines = card.render(50);
	assert.ok(lines.length >= 3);
	for (const line of lines) {
		assert.equal(visibleWidth(line), 50);
	}
	assert.ok(lines[0].includes("Working Tree"));

	// 2. Click toggles expanded/collapsed
	renderRequested = false;
	assert.ok(card.handleClick());
	assert.ok(renderRequested);

	// 3. Render collapsed in width 30
	const collapsed = card.render(30);
	for (const line of collapsed) {
		assert.equal(visibleWidth(line), 30);
	}

	// 4. Invalidation
	card.invalidate();
});


test("cute-git-graph - branches view and branch selection toggle", () => {
	resetAll();
	const cwd = process.cwd();
	const branches = fetchGitBranches(cwd);
	assert.ok(Array.isArray(branches), "fetchGitBranches must return an array");
	assert.ok(branches.length >= 1, "There should be at least one branch in the repo");
	assert.equal(branches[0].isCurrent, true, "First local branch in list should be the current branch");

	let renderRequested = 0;
	const mockTui = {
		requestRender: () => {
			renderRequested++;
		},
	} as any;
	const mockCtx = { cwd } as any;

	const card = new CinlodevGitGraphCard(mockCtx, mockTui);

	// Toggle view mode to branches
	setGitTabViewMode("branches", mockTui);
	assert.equal(getGitTabViewMode(), "branches");
	assert.equal(renderRequested, 1);

	// Render branches view
	const lines = card.render(50, 20);
	assert.equal(lines.length, 20, "Fixed height with availableHeight=20 should return exactly 20 lines");
	const joined = lines.join("\n");
	assert.ok(joined.includes("ramas en repo"), "Should display branch count header");
	assert.ok(joined.includes(branches[0].name.slice(0, 15)), "Should list the current branch");

	// Click on a branch selects it
	const targetBranch = branches.length > 1 ? branches[1].name : "test-branch";
	setGitTabSelectedBranch(targetBranch, mockTui);
	assert.equal(getGitTabSelectedBranch(), targetBranch);
	assert.equal(renderRequested, 2);

	// Re-rendering in branches view shows 'diff' indicator for selected branch
	const selectedLines = card.render(50, 20);
	assert.ok(selectedLines.some((l) => l.includes("diff")), "Selected branch should have diff badge");

	// Clicking selected branch deselects it
	setGitTabSelectedBranch(null, mockTui);
	assert.equal(getGitTabSelectedBranch(), null);

	// Switch back to graph view
	setGitTabViewMode("graph", mockTui);
	assert.equal(getGitTabViewMode(), "graph");
});

test("cute-git-graph - CinlodevWorkingTreeCard Diff mode and 50/50 fixed height", () => {
	resetAll();
	const cwd = process.cwd();
	let renderRequested = 0;
	const mockTui = {
		requestRender: () => {
			renderRequested++;
		},
	} as any;
	const mockCtx = { cwd } as any;

	const card = new CinlodevWorkingTreeCard(mockCtx, mockTui);

	// 1. Working tree mode with fixed height (availableHeight = 16)
	setGitTabSelectedBranch(null);
	const wtLines = card.render(50, 16);
	assert.equal(wtLines.length, 16, "Working tree card with availableHeight=16 should return exactly 16 lines");
	assert.ok(wtLines[0].includes("Working Tree"), "Header should contain 'Working Tree'");

	// 2. Select a branch to activate Diff mode
	const branches = fetchGitBranches(cwd);
	const targetBranch = branches.length > 1 ? branches[1].name : "develop";
	setGitTabSelectedBranch(targetBranch, mockTui);
	assert.equal(getGitTabSelectedBranch(), targetBranch);

	// Render in Diff mode with availableHeight = 18
	const diffLines = card.render(50, 18);
	assert.equal(diffLines.length, 18, "Diff card with availableHeight=18 should return exactly 18 lines");
	assert.ok(diffLines[0].includes("Diff"), "Header should contain 'Diff'");
	assert.ok(diffLines[0].includes("✕"), "Header should contain close button '[ ✕ ]'");
	assert.ok(diffLines[0].includes("↗"), "Header should contain diff launch button '[ ↗ ]'");

	// 3. Click close button resets to Working tree mode
	// Simulate click on line 0 (header) near the close button
	card.handleRailClick(0, "left", 38);
	assert.equal(getGitTabSelectedBranch(), null, "Clicking close on line 0 should reset selected branch to null");

	// 4. Mouse wheel scrolling
	assert.equal(card.handleRailWheel(0), false);
	assert.equal(card.handleRailWheel(1), false); // No overflow -> returns false
});


test("cute-git-graph - CinlodevWorkingTreeCard file clicking and launchFileDiff", () => {
	resetAll();
	const card = new CinlodevWorkingTreeCard(undefined, undefined, undefined);
	const lines = card.render(60, 20);

	// Line 4 is first modified file if dirty (line 0 top, line 1 badge, line 2 help, line 3 divider)
	if (lines.length > 4) {
		const handledLeft = card.handleRailClick(4, "left");
		assert.equal(handledLeft, true, "Left-clicking on file row should return true (opens in nvim)");

		const handledRight = card.handleRailClick(4, "right");
		assert.equal(handledRight, true, "Right-clicking on file row should return true (opens file diff)");
	}

	// Verify launchFileDiff runs safely in test environment
	assert.equal(launchFileDiff("src/cute-git-graph.ts", undefined), true);
	assert.equal(launchFileDiff("src/cute-git-graph.ts", "feat/test-branch"), true);
});


test("cute-git-graph - fetchGitFileChanges respects TTL cache and invalidation", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-git-cache-"));
	try {
		cp.execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
		cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir, stdio: "ignore" });
		cp.execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir, stdio: "ignore" });
		fs.writeFileSync(path.join(tempDir, "file1.txt"), "hello", "utf8");
		cp.execFileSync("git", ["add", "."], { cwd: tempDir, stdio: "ignore" });
		cp.execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir, stdio: "ignore" });

		// Modificar un archivo
		fs.writeFileSync(path.join(tempDir, "file1.txt"), "hello world", "utf8");
		resetGitFileChangesCache();

		const firstCall = fetchGitFileChanges(tempDir, 5000);
		assert.equal(firstCall.length, 1);
		assert.equal(firstCall[0].path, "file1.txt");

		// Agregar un segundo archivo sin resetear caché
		fs.writeFileSync(path.join(tempDir, "file2.txt"), "new file", "utf8");
		const cachedCall = fetchGitFileChanges(tempDir, 5000);
		// Debe devolver la referencia en caché (1 archivo) sin invocar git nuevamente
		assert.equal(cachedCall.length, 1);
		assert.equal(cachedCall, firstCall, "Debe retornar la referencia en memoria dentro del TTL");

		// Resetear caché
		resetGitFileChangesCache();
		const freshCall = fetchGitFileChanges(tempDir, 5000);
		assert.equal(freshCall.length, 2, "Luego de resetear caché debe ver los 2 archivos");

		// Verificar que invalidateSidebarGitAndTree resetea la caché
		fs.writeFileSync(path.join(tempDir, "file3.txt"), "third file", "utf8");
		assert.equal(fetchGitFileChanges(tempDir, 5000).length, 2, "Aún en caché debe ver 2");
		invalidateSidebarGitAndTree();
		assert.equal(fetchGitFileChanges(tempDir, 5000).length, 3, "Tras invalidateSidebarGitAndTree debe ver 3");
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
