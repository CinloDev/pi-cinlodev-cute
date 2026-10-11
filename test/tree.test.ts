import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	CinlodevProjectTreeCard,
	scanDirectoryTree,
	launchEditor,
} from "../src/cute-tree.ts";
import { resolveSidebarTab, SIDEBAR_TAB_CARD_MAP } from "../src/sidebar.ts";
import { resetAll } from "./test-helpers.ts";

test("cute-tree - scanDirectoryTree returns sorted directories and files, ignoring default patterns", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-scan-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, ".git", "HEAD"), "ref: refs/heads/main");

		fs.mkdirSync(path.join(tempDir, "node_modules"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "node_modules", "dummy.txt"), "ignored");

		fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "dist", "bundle.js"), "ignored");

		fs.mkdirSync(path.join(tempDir, "src", "components"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "src", "index.ts"), "export {}");
		fs.writeFileSync(path.join(tempDir, "src", "utils.ts"), "export {}");
		fs.writeFileSync(path.join(tempDir, "src", "components", "button.tsx"), "export {}");

		fs.mkdirSync(path.join(tempDir, "docs"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "docs", "readme.md"), "# docs");

		fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), "{}");
		fs.writeFileSync(path.join(tempDir, "z_last.txt"), "hello");

		const nodes = scanDirectoryTree(tempDir);

		// .git, node_modules, dist must be ignored
		assert.ok(!nodes.some((n) => n.name === ".git"));
		assert.ok(!nodes.some((n) => n.name === "node_modules"));
		assert.ok(!nodes.some((n) => n.name === "dist"));

		// Root nodes: directories first (alphabetical), then files (alphabetical)
		// Dirs: docs, src
		// Files: package.json, tsconfig.json, z_last.txt
		assert.equal(nodes.length, 5);
		assert.equal(nodes[0].name, "docs");
		assert.equal(nodes[0].isDirectory, true);
		assert.equal(nodes[0].relPath, "docs");
		assert.equal(nodes[0].itemCount, 1);
		assert.equal(nodes[0].children?.length, 1);
		assert.equal(nodes[0].children?.[0].name, "readme.md");
		assert.equal(nodes[0].children?.[0].isDirectory, false);
		assert.equal(nodes[0].children?.[0].extension, "md");

		assert.equal(nodes[1].name, "src");
		assert.equal(nodes[1].isDirectory, true);
		assert.equal(nodes[1].relPath, "src");
		assert.equal(nodes[1].itemCount, 3);
		assert.equal(nodes[1].children?.[0].name, "components");
		assert.equal(nodes[1].children?.[0].isDirectory, true);
		assert.equal(nodes[1].children?.[1].name, "index.ts");
		assert.equal(nodes[1].children?.[2].name, "utils.ts");

		assert.equal(nodes[2].name, "package.json");
		assert.equal(nodes[2].isDirectory, false);
		assert.equal(nodes[2].extension, "json");

		assert.equal(nodes[3].name, "tsconfig.json");
		assert.equal(nodes[3].isDirectory, false);
		assert.equal(nodes[3].extension, "json");

		assert.equal(nodes[4].name, "z_last.txt");
		assert.equal(nodes[4].isDirectory, false);
		assert.equal(nodes[4].extension, "txt");

		// Non-existent directory returns empty array
		const emptyNodes = scanDirectoryTree(path.join(tempDir, "does-not-exist"));
		assert.deepEqual(emptyNodes, []);

		// Custom ignoredNames
		const customNodes = scanDirectoryTree(tempDir, 5, 0, new Set(["docs", "package.json"]));
		assert.ok(!customNodes.some((n) => n.name === "docs"));
		assert.ok(!customNodes.some((n) => n.name === "package.json"));
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("cute-tree - launchEditor behavior falls back gracefully without throwing", () => {
	const origHypr = process.env.HYPRLAND_INSTANCE_SIGNATURE;
	const origTerm = process.env.TERMINAL;
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-launch-test-"));
	const testFile = path.join(tempDir, "sample.txt");
	fs.writeFileSync(testFile, "test");

	try {
		delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
		process.env.TERMINAL = "true";

		assert.doesNotThrow(() => {
			const result = launchEditor();
			assert.equal(typeof result, "boolean");
		});

		assert.doesNotThrow(() => {
			const resultWithArgs = launchEditor(testFile, tempDir);
			assert.equal(typeof resultWithArgs, "boolean");
		});
	} finally {
		if (origHypr !== undefined) process.env.HYPRLAND_INSTANCE_SIGNATURE = origHypr;
		else delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
		if (origTerm !== undefined) process.env.TERMINAL = origTerm;
		else delete process.env.TERMINAL;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("cute-tree - CinlodevProjectTreeCard rendering, box lines, header and files", () => {
	resetAll();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-card-test-"));
	try {
		fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "src", "index.ts"), "console.log('hi');");
		fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "demo-project" }));

		const mockCtx: any = { cwd: tempDir };
		let renderRequested = false;
		const mockTui: any = {
			requestRender: () => {
				renderRequested = true;
			},
		};

		const card = new CinlodevProjectTreeCard(mockCtx, mockTui, undefined, tempDir);

		// Render at width 50
		const lines = card.render(50);
		assert.ok(lines.length >= 4, "Should render header, directories, files and footer");
		for (const line of lines) {
			assert.equal(visibleWidth(line), 50, `Line length must equal 50: ${line}`);
		}

		// Header checks: top border, PROYECTO title, and editor badge (e.g. nvim)
		const topHeader = lines[0];
		assert.ok(topHeader.includes("PROYECTO"), "Header must include PROYECTO");
		assert.ok(topHeader.includes("nvim"), "Header must include nvim editor button");

		// Content checks: src directory and package.json
		assert.ok(lines.some((l) => l.includes("src")), "Rendered lines must contain src directory");
		assert.ok(lines.some((l) => l.includes("package.json")), "Rendered lines must contain package.json");
		assert.ok(lines.some((l) => l.includes("index.ts")), "src is expanded by default, so index.ts should be visible");

		// Box line framing check: middle lines must have vertical borders
		for (let i = 1; i < lines.length - 1; i++) {
			assert.ok(lines[i].startsWith("║ ") && lines[i].endsWith(" ║"), `Box line ${i} must have proper borders`);
		}

		// Empty directory case
		const emptyDir = path.join(tempDir, "empty");
		fs.mkdirSync(emptyDir, { recursive: true });
		const emptyCard = new CinlodevProjectTreeCard(undefined, mockTui, undefined, emptyDir);
		const emptyLines = emptyCard.render(50);
		assert.equal(emptyLines.length, 3);
		assert.ok(emptyLines[1].includes("Sin archivos en el proyecto"));
		for (const l of emptyLines) {
			assert.equal(visibleWidth(l), 50);
		}
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("cute-tree - handleRailClick directory toggle, expand/collapse all, and editor launch", () => {
	resetAll();
	const origHypr = process.env.HYPRLAND_INSTANCE_SIGNATURE;
	const origTerm = process.env.TERMINAL;
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-click-test-"));

	try {
		delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
		process.env.TERMINAL = "true";

		fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "src", "index.ts"), "console.log('hi');");
		fs.mkdirSync(path.join(tempDir, "docs"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "docs", "intro.md"), "# intro");
		fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

		let renderCalls = 0;
		const mockTui: any = {
			requestRender: () => {
				renderCalls++;
			},
		};

		const card = new CinlodevProjectTreeCard(undefined, mockTui, undefined, tempDir);

		// Initially "src" is auto-expanded
		assert.ok(card.getExpandedDirs().has("src"));

		// Render to generate hitboxes
		card.render(50);
		const hitboxes = card.getHitboxes();
		assert.ok(hitboxes.length > 0);

		// 1. Click header (lineIndex 0) launches editor
		assert.equal(card.handleRailClick(0), true);

		// 2. Click on a directory hitbox toggles expansion
		const srcHitbox = hitboxes.find((h) => h.type === "toggle-dir" && h.node?.relPath === "src");
		assert.ok(srcHitbox, "src directory hitbox must exist");

		const prevRender = renderCalls;
		// Clicking src collapses it
		const toggleResult = card.handleRailClick(srcHitbox.lineIndex, "left", srcHitbox.startX);
		assert.equal(toggleResult, true);
		assert.ok(!card.getExpandedDirs().has("src"), "src should be collapsed after click");
		assert.ok(renderCalls > prevRender);

		// Clicking src again expands it
		card.handleRailClick(srcHitbox.lineIndex, "left", srcHitbox.startX);
		assert.ok(card.getExpandedDirs().has("src"), "src should be expanded again after second click");

		// 3. Right-click toggles collapseAll / expandAll
		// First right-click: collapses all since expandedDirs is non-empty
		const rightClick1 = card.handleRailClick(0, "right");
		assert.equal(rightClick1, true);
		assert.equal(card.getExpandedDirs().size, 0, "Right-click should collapse all");

		// Second right-click: expands all
		const rightClick2 = card.handleRailClick(0, "right");
		assert.equal(rightClick2, true);
		assert.ok(card.getExpandedDirs().size >= 2, "Second right-click should expand all directories (src, docs)");

		// Direct setExpanded, expandAll, collapseAll methods
		card.collapseAll();
		assert.equal(card.getExpandedDirs().size, 0);
		card.setExpanded("docs", true);
		assert.ok(card.getExpandedDirs().has("docs"));
		card.setExpanded("docs", false);
		assert.ok(!card.getExpandedDirs().has("docs"));

		card.expandAll();
		assert.ok(card.getExpandedDirs().has("src"));
		assert.ok(card.getExpandedDirs().has("docs"));

		// 4. File click opens file
		card.render(50);
		const fileHitbox = card.getHitboxes().find((h) => h.type === "open-file");
		assert.ok(fileHitbox, "File hitbox must exist");
		assert.equal(card.handleClick(fileHitbox.lineIndex, "left", fileHitbox.startX), true);

		// Invalidation
		card.invalidate();
	} finally {
		if (origHypr !== undefined) process.env.HYPRLAND_INSTANCE_SIGNATURE = origHypr;
		else delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
		if (origTerm !== undefined) process.env.TERMINAL = origTerm;
		else delete process.env.TERMINAL;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("cute-tree - handleWheel scrolling for large directory trees", () => {
	resetAll();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-wheel-test-"));
	try {
		// Create 30 files so that tree has 30 rows (maxVisibleRows is 24)
		for (let i = 0; i < 30; i++) {
			const filename = `file_${String(i).padStart(2, "0")}.txt`;
			fs.writeFileSync(path.join(tempDir, filename), `line ${i}`);
		}

		let renderCalls = 0;
		const mockTui: any = {
			requestRender: () => {
				renderCalls++;
			},
		};

		const card = new CinlodevProjectTreeCard(undefined, mockTui, undefined, tempDir);

		// Initial render (offset = 0)
		const initialLines = card.render(50);
		// With 30 items and maxVisibleRows 23 (24 content lines - 1 indicator), 30 - 23 = 7 remaining below
		assert.ok(initialLines.some((l) => l.includes("▼ 7 abajo")), "Should indicate 7 items below with offset 0");

		// Wheel delta 0 returns false
		assert.equal(card.handleWheel(0), false);

		// Wheel scroll forward (+1)
		const prevCalls = renderCalls;
		const scrolled = card.handleWheel(1);
		assert.equal(scrolled, true);
		assert.ok(renderCalls > prevCalls);

		const scrolledLines = card.render(50);
		assert.ok(scrolledLines.some((l) => l.includes("▲ 1 arriba")), "Should indicate 1 item above after wheel +1");
		assert.ok(scrolledLines.some((l) => l.includes("▼ 6 abajo")), "Should indicate 6 items below after wheel +1");

		// Wheel scroll backward (-1)
		assert.equal(card.handleWheel(-1), true);
		const backLines = card.render(50);
		assert.ok(backLines.some((l) => l.includes("▼ 7 abajo")));

		// Delegated handleRailWheel
		assert.equal(card.handleRailWheel(1), true);

		// Small directory: <= 24 items, handleWheel returns false
		const smallDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-small-"));
		try {
			fs.writeFileSync(path.join(smallDir, "single.txt"), "hello");
			const smallCard = new CinlodevProjectTreeCard(undefined, mockTui, undefined, smallDir);
			smallCard.render(50);
			assert.equal(smallCard.handleWheel(1), false);
			assert.equal(smallCard.handleWheel(-1), false);
		} finally {
			fs.rmSync(smallDir, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("cute-tree - full-height behavior when terminal rows is set", () => {
	resetAll();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-full-height-test-"));
	try {
		const termRows = 45;
		const railOverhead = 11; // banner, tab bar, spacing & input area overhead
		const expectedTotalLines = Math.max(10, termRows - railOverhead); // 34 lines
		const targetContentLines = expectedTotalLines - 2; // 32 lines capacity

		const mockTui: any = {
			requestRender: () => {},
			terminal: { rows: termRows },
		};

		// 1. Items < targetContentLines: creates 5 files (less than 32)
		for (let i = 0; i < 5; i++) {
			fs.writeFileSync(path.join(tempDir, `small_${i}.txt`), `hello ${i}`);
		}

		const smallCard = new CinlodevProjectTreeCard(undefined, mockTui, undefined, tempDir);
		const smallLines = smallCard.render(50);

		// Verifies rendered lines count matches terminal height minus rail overhead
		assert.equal(smallLines.length, expectedTotalLines, `Expected ${expectedTotalLines} lines, got ${smallLines.length}`);

		// Verifies empty padding lines when items < targetContentLines
		const emptyPadLines = smallLines.filter((l) => l.startsWith("║ ") && l.endsWith(" ║") && l.slice(2, -2).trim() === "");
		assert.ok(emptyPadLines.length > 0, "Should have empty padded lines filling vertical space");
		assert.equal(emptyPadLines.length, targetContentLines - 5, `Expected ${targetContentLines - 5} padded lines`);

		// Explicit availableHeight parameter override test
		const explicitLines = smallCard.render(50, 32);
		assert.equal(explicitLines.length, 32, "Explicit availableHeight must set exact card lines count");
		const explicitPadLines = explicitLines.filter((l) => l.startsWith("║ ") && l.endsWith(" ║") && l.slice(2, -2).trim() === "");
		assert.equal(explicitPadLines.length, 30 - 5, "Padding must adjust to explicit availableHeight");

		// Clean directory for large items test
		for (let i = 0; i < 5; i++) {
			fs.unlinkSync(path.join(tempDir, `small_${i}.txt`));
		}

		// 2. Items > targetContentLines: creates 50 files (more than 32)
		for (let i = 0; i < 50; i++) {
			const filename = `item_${String(i).padStart(2, "0")}.txt`;
			fs.writeFileSync(path.join(tempDir, filename), `item ${i}`);
		}

		smallCard.invalidate();
		const largeLines = smallCard.render(50);

		// Verifies rendered lines count matches terminal height minus rail overhead
		assert.equal(largeLines.length, expectedTotalLines, `Expected ${expectedTotalLines} lines, got ${largeLines.length}`);

		// Verifies scroll indicator when items > targetContentLines
		const hasScrollIndicator = largeLines.some((l) => l.includes("▼") && l.includes("abajo") && l.includes("wheel scroll"));
		assert.ok(hasScrollIndicator, "Should contain scroll indicator line when items > targetContentLines");
		// 50 items - 31 visible (since 1 line for scroll indicator) = 19 remaining below
		assert.ok(largeLines.some((l) => l.includes("▼ 19 abajo")), "50 items - 31 visible = 19 remaining below");

		// Scrolling with handleWheel
		assert.equal(smallCard.handleWheel(1), true);
		const scrolledLines = smallCard.render(50);
		assert.equal(scrolledLines.length, expectedTotalLines);
		assert.ok(scrolledLines.some((l) => l.includes("▲ 1 arriba")), "Should indicate 1 item above after wheel +1");
		assert.ok(scrolledLines.some((l) => l.includes("▼ 18 abajo")), "Should indicate 18 items below after wheel +1");

		// 3. Fallback when termRows < 15: falls back to 24 capacity without padding
		const smallTermMockTui: any = {
			requestRender: () => {},
			terminal: { rows: 12 },
		};
		const fallbackCard = new CinlodevProjectTreeCard(undefined, smallTermMockTui, undefined, tempDir);
		const fallbackLines = fallbackCard.render(50);
		// When totalRows (50) > contentCapacity (24), maxVisibleRows is 23 (leaving 1 for indicator)
		assert.equal(fallbackCard.getMaxVisibleRows(50), 23);
		// When totalRows (5) <= contentCapacity (24), maxVisibleRows is 24
		assert.equal(fallbackCard.getMaxVisibleRows(5), 24);
		// With 50 items and contentCapacity 24, fallbackLines should be 26 (top + 23 items + scroll indicator + bottom)
		assert.equal(fallbackLines.length, 26);

		// 4. Empty directory with terminal rows >= 15 expands with padding to reach bottom
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-empty-full-"));
		try {
			const emptyCard = new CinlodevProjectTreeCard(undefined, mockTui, undefined, emptyDir);
			const emptyLines = emptyCard.render(50);
			assert.equal(emptyLines.length, expectedTotalLines);
			assert.ok(emptyLines[1].includes("Sin archivos en el proyecto"));
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("cute-tree - resolveSidebarTab resolves '5', 'tree', 'TREE' to projectTree", () => {
	// Key resolution
	const tabByKey = resolveSidebarTab("5");
	assert.equal(tabByKey.id, "tree");
	assert.equal(tabByKey.key, "5");
	assert.equal(tabByKey.label, "TREE");
	assert.deepEqual(tabByKey.cards, ["projectTree"]);

	// Lowercase id resolution
	const tabById = resolveSidebarTab("tree");
	assert.equal(tabById.id, "tree");
	assert.equal(tabById.key, "5");
	assert.equal(tabById.label, "TREE");
	assert.deepEqual(tabById.cards, ["projectTree"]);

	// Uppercase label resolution
	const tabByUpper = resolveSidebarTab("TREE");
	assert.equal(tabByUpper.id, "tree");
	assert.equal(tabByUpper.key, "5");
	assert.equal(tabByUpper.label, "TREE");
	assert.deepEqual(tabByUpper.cards, ["projectTree"]);

	// Aliases
	const tabByProjectTree = resolveSidebarTab("projecttree");
	assert.equal(tabByProjectTree.id, "tree");
	assert.deepEqual(tabByProjectTree.cards, ["projectTree"]);

	const tabByProjectTreeHyphen = resolveSidebarTab("project-tree");
	assert.equal(tabByProjectTreeHyphen.id, "tree");
	assert.deepEqual(tabByProjectTreeHyphen.cards, ["projectTree"]);

	// SIDEBAR_TAB_CARD_MAP
	assert.deepEqual(SIDEBAR_TAB_CARD_MAP.tree, ["projectTree"]);
});


test("cute-tree - renders Git status badges and dirty directory bullets", () => {
	resetAll();
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-tree-git-"));
	try {
		cp.execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
		cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir, stdio: "ignore" });
		cp.execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir, stdio: "ignore" });

		fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tempDir, "src", "index.ts"), "console.log(1);", "utf8");
		cp.execFileSync("git", ["add", "."], { cwd: tempDir, stdio: "ignore" });
		cp.execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir, stdio: "ignore" });

		// Modify file to make git dirty
		fs.writeFileSync(path.join(tempDir, "src", "index.ts"), "console.log(2);", "utf8");

		const card = new CinlodevProjectTreeCard(undefined, undefined, undefined, tempDir);
		card.getExpandedDirs().add("src");
		const lines = card.render(60);
		const joined = lines.join("\n");

		assert.ok(joined.includes("M"), "Modified file in tree should have M badge");
		assert.ok(joined.includes("●"), "Directory containing modified file should have dirty bullet ●");
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
