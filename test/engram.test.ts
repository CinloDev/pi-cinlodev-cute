import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	detectProjectName,
	formatRelativeTime,
	resolveDashboardUrl,
	CinlodevEngramCard,
	resetEngramCache,
	DEFAULT_ENGRAM_DASHBOARD,
	parseEngramSearchOutput,
	CinlodevEngramHandoffCard,
} from "../src/cute-engram.ts";
import {
	CinlodevMemoryGraphCard,
	CinlodevPersistentMemoryCard,
	resolveMemoryGraphDbCandidate,
	queryMemoryGraphStats,
	resetMemoryGraphCache,
	normalizeGitRemoteUrl,
	resolvePersistentMemoryScope,
} from "../src/cute-memory-graph.ts";
import { SIDEBAR_TAB_CARD_MAP } from "../src/sidebar.ts";
import { resetAll, userConfigFile } from "./test-helpers.ts";

test("cute-engram - detectProjectName, formatRelativeTime, resolveDashboardUrl, and CinlodevEngramCard", () => {
	resetAll();

	// 1. detectProjectName
	const proj = detectProjectName(process.cwd());
	assert.equal(proj, "pi-cinlodev-cute");

	// 2. formatRelativeTime
	const now = new Date("2026-09-23T12:00:00Z");
	assert.equal(formatRelativeTime(null, now), "nunca");
	assert.equal(formatRelativeTime(new Date("2026-09-23T11:59:55Z"), now), "recién");
	assert.equal(formatRelativeTime(new Date("2026-09-23T11:59:20Z"), now), "hace 40s");
	assert.equal(formatRelativeTime(new Date("2026-09-23T11:50:00Z"), now), "hace 10m");
	assert.equal(formatRelativeTime(new Date("2026-09-23T09:00:00Z"), now), "hace 3h");
	assert.equal(formatRelativeTime(new Date("2026-09-21T12:00:00Z"), now), "hace 2d");

	// 3. resolveDashboardUrl
	assert.equal(resolveDashboardUrl(null), DEFAULT_ENGRAM_DASHBOARD);
	assert.equal(resolveDashboardUrl({ serverUrl: "https://engram.example.com" }), "https://engram.example.com/dashboard/");
	assert.equal(resolveDashboardUrl({ serverUrl: "https://myengram.dev///" }), "https://myengram.dev/dashboard/");
	assert.equal(resolveDashboardUrl({ serverUrl: "https://engram.example.com" }, "dypos"), "https://engram.example.com/dashboard/projects/dypos");

	// 4. CinlodevEngramCard component
	let renderCount = 0;
	const mockTui: any = {
		requestRender: () => {
			renderCount++;
		},
	};
	const mockCtx: any = { cwd: process.cwd() };
	const mockTheme: any = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	};
	const card = new CinlodevEngramCard(mockCtx, mockTui, mockTheme);

	// Initial render
	const lines = card.render(80);
	assert.ok(lines.length > 0, "Card should produce lines");
	const joined = lines.join("\n");
	assert.ok(joined.includes("Engram:"), "Card must include Engram header");
	assert.ok(joined.includes("Local (7437)"), "Card must include Local port");
	assert.ok(joined.includes("Cloud:"), "Card must include Cloud section");
	assert.ok(joined.includes("dashboard ↗"), "Card must have dashboard button without brackets");

	// Header click toggles collapse
	card.handleClick(0);
	assert.equal(renderCount, 1);
	const collapsedLines = card.render(80);
	assert.ok(collapsedLines.length < lines.length, "Collapsed card must produce fewer lines");
	assert.ok(!collapsedLines.join("\n").includes("[click para expandir]"), "Must not include click hint");

	// Un-collapse
	card.handleClick(0);
	assert.equal(renderCount, 2);
	const expandedLines = card.render(80);
	assert.equal(expandedLines.length, lines.length);

	// Invalid line index returns false
	assert.equal(card.handleClick(999), false);
});


test("cute-engram - parseEngramSearchOutput and CinlodevEngramHandoffCard", () => {
	resetAll();
	const sampleSearchOutput = `
Found 1 memories:

[1] #2433 (session_summary) — PR #119: Reemplazo de tab USAGE por AGENTS
    Replaced redundant USAGE sidebar tab (3) with dedicated AGENTS (3) tab.
    95/95 unit tests passing.
    2026-10-04 03:52:58 | project: pi-cinlodev-cute | scope: project
`;

	const parsed = parseEngramSearchOutput(sampleSearchOutput);
	assert.ok(parsed);
	assert.equal(parsed.id, "2433");
	assert.equal(parsed.type, "session_summary");
	assert.ok(parsed.title?.includes("PR #119"));
	assert.ok(parsed.content?.includes("Replaced redundant USAGE"));
	assert.equal(parsed.date, "2026-10-04 03:52:58");

	const mockCtx: any = { cwd: process.cwd() };
	let renderRequested = false;
	const mockTui: any = {
		requestRender: () => {
			renderRequested = true;
		},
	};

	const card = new CinlodevEngramHandoffCard(mockCtx, mockTui, undefined);
	// Set mock cached handoff for rendering test
	(card as any).cachedHandoff = parsed;

	const lines = card.render(50);
	assert.ok(lines.length > 3);
	for (const line of lines) {
		assert.equal(visibleWidth(line), 50);
	}
	assert.ok(lines[0].includes("Active Handoff"));
	assert.ok(lines.some((l) => l.includes("#2433")));

	// Click invalidates
	renderRequested = false;
	assert.ok(card.handleClick());
	assert.ok(renderRequested);

	// Tab mappings check
	assert.ok(SIDEBAR_TAB_CARD_MAP.git.includes("workingTree"), "git tab must include workingTree");
	assert.ok(SIDEBAR_TAB_CARD_MAP.mem.includes("engramHandoff"), "mem tab must include engramHandoff");
	assert.ok(
		SIDEBAR_TAB_CARD_MAP.mem.includes("persistentMemory") || SIDEBAR_TAB_CARD_MAP.mem.includes("memoryGraph"),
		"mem tab must include persistentMemory or memoryGraph",
	);
});

test("cute-memory-graph - candidate resolution, stats querying and card rendering", async () => {
	resetAll();
	const tmpDir = path.join(os.tmpdir(), `memory-graph-test-${Date.now()}`);
	const piDir = path.join(tmpDir, ".pi");
	fs.mkdirSync(piDir, { recursive: true });

	try {
		// 1. Candidate resolution: non-existent project db
		const nonExistentTmp = path.join(os.tmpdir(), `non-existent-${Date.now()}`);
		assert.equal(resolveMemoryGraphDbCandidate(nonExistentTmp, false), null);

		// 2. Candidate resolution: .pi/memory.db
		const dbFile = path.join(piDir, "memory.db");
		fs.writeFileSync(dbFile, "sqlite-dummy-content");

		const candidate = resolveMemoryGraphDbCandidate(tmpDir);
		assert.ok(candidate);
		assert.equal(candidate.path, dbFile);
		assert.equal(candidate.scope, "project");

		// 3. Query stats on simulated file
		const stats = await queryMemoryGraphStats(tmpDir);
		assert.ok(stats.available);
		assert.equal(stats.scope, "project");

		// 4. Render card with stats
		const mockCtx: any = { cwd: tmpDir };
		const card = new CinlodevMemoryGraphCard(mockCtx, undefined, undefined, tmpDir);

		// Set mock cached stats for UI verification
		(card as any).getCachedOrTrigger = () => ({
			available: true,
			dbPath: dbFile,
			scope: "project",
			memoriesCount: 42,
			entitiesCount: 15,
			relationsCount: 28,
			activeLeasesCount: 1,
			lastMemorySnippet: "Arquitectura modular de SQLite Knowledge Graph",
			lastCheckedAt: Date.now(),
		});

		const lines = card.render(50);
		assert.ok(lines.length > 5);
		for (const line of lines) {
			assert.equal(visibleWidth(line), 50);
		}

		assert.ok(lines.some((l) => l.includes("PERSISTENT MEMORY") || l.includes("GRAPH MEMORY")));
		assert.ok(lines.some((l) => l.includes("Knowledge Base") || l.includes("SQLite Knowledge Graph")));
		assert.ok(lines.some((l) => l.includes("Recuerdos:")));
		assert.ok(lines.some((l) => l.includes("42")));
		assert.ok(lines.some((l) => l.includes("Grafo:")));
		assert.ok(lines.some((l) => l.includes("15")));
		assert.ok(lines.some((l) => l.includes("28")));
		assert.ok(lines.some((l) => l.includes("Retener Sesión")));
		assert.ok(lines.some((l) => l.includes("Arquitectura modular")));

		// 5. Inactive / Not available fallback rendering
		const emptyCard = new CinlodevMemoryGraphCard(undefined, undefined, undefined, tmpDir);
		(emptyCard as any).getCachedOrTrigger = () => ({
			available: false,
			dbPath: null,
			scope: "none",
			memoriesCount: 0,
			entitiesCount: 0,
			relationsCount: 0,
			activeLeasesCount: 0,
			lastCheckedAt: Date.now(),
		});
		const emptyLines = emptyCard.render(50);
		assert.ok(emptyLines.some((l) => l.includes("inactivo")));
		assert.ok(emptyLines.some((l) => l.includes("Sin base") && (l.includes("memories.db") || l.includes("memory.db"))));
		assert.ok(emptyLines.some((l) => l.includes("+ inicializar memoria")));

		// 6. Interactive click on Explorer and Retain Session
		let actionRan = false;
		(card as any).clickTargets = [
			{ lineIndex: 1, action: () => { actionRan = true; } },
		];
		assert.equal(card.handleClick(1), true);
		assert.equal(actionRan, true);
		assert.equal(card.handleClick(99), false);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("cute-persistent-memory - normalizeGitRemoteUrl, scope resolution, and card rendering", async () => {
	resetAll();

	// 1. normalizeGitRemoteUrl
	assert.equal(
		normalizeGitRemoteUrl("git@github.com:CinloDev/pi-cinlodev-cute.git"),
		"github.com/CinloDev/pi-cinlodev-cute",
	);
	assert.equal(
		normalizeGitRemoteUrl("https://github.com/CinloDev/pi-cinlodev-cute.git"),
		"github.com/CinloDev/pi-cinlodev-cute",
	);
	assert.equal(
		normalizeGitRemoteUrl("ssh://git@github.com/CinloDev/pi-cinlodev-cute.git"),
		"github.com/CinloDev/pi-cinlodev-cute",
	);
	assert.equal(normalizeGitRemoteUrl("/local/path/repo.git"), null);

	// 2. Scope resolution
	const scope = resolvePersistentMemoryScope(process.cwd());
	assert.ok(scope.projectName);
	assert.ok(scope.scopeKey.includes("project"));

	// 3. Persistent Memory Card rendering
	const card = new CinlodevPersistentMemoryCard(undefined, undefined, undefined, process.cwd());
	(card as any).getCachedOrTrigger = () => ({
		available: true,
		dbPath: "/home/cinlodev/.memory/memories.db",
		scope: "project",
		projectName: "github.com/CinloDev/pi-cinlodev-cute",
		scopeKey: '["project","github.com/CinloDev/pi-cinlodev-cute"]',
		projectMemoriesCount: 5,
		totalMemoriesCount: 12,
		entitiesCount: 7,
		relationsCount: 4,
		indexedCount: 5,
		pendingCount: 0,
		serverOnline: true,
		lastTitle: "Arquitectura de pi-persistent-memory en CUTE",
		lastTopic: "arch",
		lastCheckedAt: Date.now(),
	});

	const lines = card.render(50);
	assert.ok(lines.length > 5);
	for (const line of lines) {
		assert.equal(visibleWidth(line), 50);
	}

	assert.ok(lines.some((l) => l.includes("PERSISTENT MEMORY")));
	assert.ok(lines.some((l) => l.includes("Knowledge Base")));
	assert.ok(lines.some((l) => l.includes("explorer ↗")));
	assert.ok(lines.some((l) => l.includes("5 proy")));
	assert.ok(lines.some((l) => l.includes("(12 total)")));
	assert.ok(lines.some((l) => l.includes("7 nodos")));
	assert.ok(lines.some((l) => l.includes("4 aristas")));
	assert.ok(lines.some((l) => l.includes("💾 Retener Sesión")));
	assert.ok(lines.some((l) => l.includes("Arquitectura")));

	// 4. Clicking retain session delegates to pi.sendUserMessage
	let sentMessage: string | null = null;
	const mockPi: any = {
		sendUserMessage: (msg: string) => {
			sentMessage = msg;
		},
	};
	const cardWithPi = new CinlodevPersistentMemoryCard(
		undefined,
		undefined,
		undefined,
		process.cwd(),
		mockPi,
	);
	(cardWithPi as any).getCachedOrTrigger = (card as any).getCachedOrTrigger;
	cardWithPi.render(50);
	const retainTarget = (cardWithPi as any).clickTargets[1];
	assert.ok(retainTarget);
	await retainTarget.action();
	assert.ok(sentMessage);
	assert.ok((sentMessage as string).includes("memory_save"));
	assert.ok((sentMessage as string).includes("memory_context"));
});
