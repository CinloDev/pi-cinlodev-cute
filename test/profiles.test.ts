import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	listAvailableProfiles,
	switchProfile,
	SDD_PROFILES_API_SYMBOL,
	extractAccountFromModel,
	extractUniqueAccounts,
	loadProfileDetails,
	CinlodevProfilesExtendedCard,
	getActiveProfileDetails,
} from "../src/cute-profiles.ts";
import { resetActiveProfileCache } from "../src/cute-paths.ts";
import { setCachedAccountsForTesting } from "../src/cute-usage.ts";
import { resetAll, userConfigFile } from "./test-helpers.ts";

test("cute-profiles - listAvailableProfiles and SDD_PROFILES_API_SYMBOL integration", () => {
	// 1. Filesystem discovery
	const profiles = listAvailableProfiles(process.cwd());
	assert.ok(Array.isArray(profiles), "profiles should be an array");
	assert.ok(profiles.length > 0, "should find profiles on system/builtin");

	// 2. Global API override
	const mockApi = {
		listProfiles: () => [
			{ name: "mock-one", description: "Mock 1", active: true },
			{ name: "mock-two", description: "Mock 2", active: false },
		],
		getActiveProfile: () => "mock-one",
		activateProfile: async (name: string) => ({ success: true, message: `Activated ${name}` }),
	};

	(globalThis as any)[SDD_PROFILES_API_SYMBOL] = mockApi;
	try {
		const apiProfiles = listAvailableProfiles();
		assert.equal(apiProfiles.length, 2);
		assert.equal(apiProfiles[0].name, "mock-one");
		assert.equal(apiProfiles[0].active, true);
		assert.equal(apiProfiles[1].name, "mock-two");
		assert.equal(apiProfiles[1].active, false);
	} finally {
		delete (globalThis as any)[SDD_PROFILES_API_SYMBOL];
	}
});

test("cute-profiles - switchProfile switches active profile via API and fallback", async () => {
	// 1. With API
	let activatedWith: string | null = null;
	(globalThis as any)[SDD_PROFILES_API_SYMBOL] = {
		listProfiles: () => [{ name: "mock-one", active: true }],
		getActiveProfile: () => "mock-one",
		activateProfile: async (name: string) => {
			activatedWith = name;
			return { success: true, message: `Perfil "${name}" activado correctamente.` };
		},
	};

	try {
		const res = await switchProfile("mock-one");
		assert.equal(res.success, true);
		assert.equal(activatedWith, "mock-one");
	} finally {
		delete (globalThis as any)[SDD_PROFILES_API_SYMBOL];
	}

	// 2. Fallback error when profile does not exist
	const notFound = await switchProfile("perfil-inexistente-xyz");
	assert.equal(notFound.success, false);
	assert.ok(notFound.message.includes("no encontrado"));
});

test("cute-profiles - getActiveProfileDetails resolves active profile via readActiveProfile and API", () => {
	resetActiveProfileCache();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-active-details-test-"));
	try {
		// 1. Filesystem project-local resolution
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "cinlo-custom", "utf8");
		fs.writeFileSync(
			path.join(projDir, "cinlo-custom.json"),
			JSON.stringify({ name: "cinlo-custom", description: "Custom Test Profile" }),
			"utf8",
		);

		const details = getActiveProfileDetails(tmpDir);
		assert.ok(details, "should return profile details");
		assert.equal(details?.name, "cinlo-custom");
		assert.equal(details?.description, "Custom Test Profile");

		// 2. Global SDD API override
		fs.writeFileSync(
			path.join(projDir, "api-active.json"),
			JSON.stringify({ name: "api-active", description: "API Profile" }),
			"utf8",
		);
		(globalThis as any)[SDD_PROFILES_API_SYMBOL] = {
			getActiveProfile: () => "api-active",
			listProfiles: () => [
				{ name: "api-active", description: "API Profile", active: true },
			],
		};
		resetActiveProfileCache();

		const apiDetails = getActiveProfileDetails(tmpDir);
		assert.ok(apiDetails, "should resolve via API");
		assert.equal(apiDetails?.name, "api-active");
		assert.equal(apiDetails?.description, "API Profile");
	} finally {
		delete (globalThis as any)[SDD_PROFILES_API_SYMBOL];
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetActiveProfileCache();
	}
});


test("cute-profiles - extractAccountFromModel parses accounts from model strings", () => {
	assert.equal(extractAccountFromModel("cpamc/ranchesca/gemini-3.8-flash-high"), "ranchesca");
	assert.equal(extractAccountFromModel("cpamc/nekocin01/gemini-3.8-flash-high"), "nekocin01");
	assert.equal(extractAccountFromModel("cpamc/cinlo_dig/gemini-3.8-flash-high"), "cinlo_dig");
	assert.equal(extractAccountFromModel("cpam/cin82/claude-3-5-sonnet"), "cin82");
	assert.equal(extractAccountFromModel("proxy/neko02/gpt-4o"), "neko02");
	assert.equal(extractAccountFromModel("anthropic/claude-3-5-sonnet"), null);
	assert.equal(extractAccountFromModel(""), null);
	assert.equal(extractAccountFromModel(undefined), null);
});

test("cute-profiles - extractUniqueAccounts collects unique accounts in order from profile", () => {
	const sampleProfile = {
		name: "cinlo1",
		default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
		default_effort: "high",
		model_profiles: {
			"gentle-ai-worker": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
			"gentle-ai-explore": { model: "cpamc/cinlo_dig/gemini-3.8-flash-high", effort: "low" },
			"gentle-ai-verify": { model: "cpamc/cin82/gemini-3.8-flash-high", effort: "low" },
			"jd-judge-a": { model: "cpamc/cinlo_dig/gemini-3.8-flash-high", effort: "high" },
			"jd-judge-b": { model: "cpamc/neko02/gemini-3.8-flash-high", effort: "high" },
			"jd-fix-agent": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
			"review-risk": { model: "cpamc/cin82/gemini-3.8-flash-high", effort: "high" },
		},
	};

	const accounts = extractUniqueAccounts(sampleProfile as any);
	assert.deepEqual(accounts, ["ranchesca", "nekocin01", "cinlo_dig", "cin82", "neko02"]);
});

test("cute-profiles - loadProfileDetails loads from temporary project directory", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-profile-load-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(
			path.join(projDir, "test-cluster.json"),
			JSON.stringify({
				name: "test-cluster",
				description: "Test Cluster",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "high",
				model_profiles: {
					"gentle-ai-worker": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
				},
			}),
			"utf8",
		);

		const loaded = loadProfileDetails("test-cluster", tmpDir);
		assert.ok(loaded);
		assert.equal(loaded?.name, "test-cluster");
		assert.equal(loaded?.default_model, "cpamc/ranchesca/gemini-3.8-flash-high");
		assert.ok(loaded?.model_profiles?.["gentle-ai-worker"]);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("cute-profiles - CinlodevProfilesExtendedCard renders switcher, accounts, subagent tree, and handles clicks", async () => {
	resetAll();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-profile-card-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "cinlo1", "utf8");
		fs.writeFileSync(
			path.join(projDir, "cinlo1.json"),
			JSON.stringify({
				name: "cinlo1",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "high",
				model_profiles: {
					"gentle-ai-worker": { model: "cpamc/nekocin01/gemini-3.8-flash-high", effort: "high" },
					"gentle-ai-explore": { model: "cpamc/cinlo_dig/gemini-3.8-flash-high", effort: "low" },
				},
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(projDir, "cinlo2.json"),
			JSON.stringify({
				name: "cinlo2",
				default_model: "cpamc/nekocin01/gemini-3.8-flash-high",
				default_effort: "medium",
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(projDir, "cinlo3.json"),
			JSON.stringify({
				name: "cinlo3",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "low",
			}),
			"utf8",
		);
		fs.writeFileSync(
			path.join(projDir, "cinlo4.json"),
			JSON.stringify({
				name: "cinlo4",
				default_model: "cpamc/ranchesca/gemini-3.8-flash-high",
				default_effort: "high",
			}),
			"utf8",
		);

		// Also write task-manager.json
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "task-manager.json"),
			JSON.stringify({
				todos: [
					{ id: "1", title: "Implement feature", status: "completed" },
					{ id: "2", title: "Write tests", status: "in_progress" },
					{ id: "3", title: "Review PR", status: "pending" },
				],
			}),
			"utf8",
		);

		// Set cached quota accounts for testing
		setCachedAccountsForTesting([
			{
				provider: "antigravity",
				prefix: "ranchesca",
				pools: [
					{ label: "Gemini 5h", availablePercent: 85, used: 15, total: 100, unlimited: false, resetAt: "in 2 hours" },
					{ label: "Gemini Weekly", availablePercent: 90, used: 10, total: 100, unlimited: false, resetAt: "in 5 days" },
				],
			},
			{
				provider: "antigravity",
				prefix: "nekocin01",
				pools: [
					{ label: "Gemini 5h", availablePercent: 30, used: 70, total: 100, unlimited: false, resetAt: "in 1 hour" },
					{ label: "Gemini Weekly", availablePercent: 45, used: 55, total: 100, unlimited: false, resetAt: "in 3 days" },
				],
			},
		]);

		let renderRequested = false;
		const mockTui: any = {
			requestRender: () => {
				renderRequested = true;
			},
		};

		const card = new CinlodevProfilesExtendedCard(mockTui, undefined, tmpDir);
		const lines = card.render(52);
		assert.ok(lines.length > 0, "Card should render lines");
		const fullText = lines.join("\n");

		// 1. Top profile switcher buttons - renders all discovered profiles with dynamic wrapping
		assert.ok(fullText.includes("cinlo1"), "Should render cinlo1 in switcher");
		assert.ok(fullText.includes("cinlo2"), "Should render cinlo2 in switcher");
		assert.ok(fullText.includes("cinlo3"), "Should render cinlo3 in switcher");
		assert.ok(fullText.includes("cinlo4"), "Should render cinlo4 in switcher");
		assert.ok(fullText.includes("●") && fullText.includes("○"), "Should render active/inactive dots");

		// Verify dynamic button lines for profiles exist:
		const linesWithButtons = lines.filter((l) => l.includes("[●") || l.includes("[○"));
		assert.ok(linesWithButtons.length >= 2, "Should wrap profile buttons across multiple lines dynamically");

		// 2. Real quota bars for ranchesca and nekocin01 (5h + Semanal), graceful fallback for cinlo_dig
		assert.ok(fullText.includes("ranchesca"), "Should list ranchesca account");
		assert.ok(fullText.includes("85%"), "Should show 85% 5h quota for ranchesca");
		assert.ok(fullText.includes("90%"), "Should show 90% weekly quota for ranchesca");
		assert.ok(fullText.includes("nekocin01"), "Should list nekocin01 account");
		assert.ok(fullText.includes("30%"), "Should show 30% 5h quota for nekocin01");
		assert.ok(fullText.includes("45%"), "Should show 45% weekly quota for nekocin01");
		assert.ok(fullText.includes("cinlo_dig"), "Should list cinlo_dig account");
		assert.ok(fullText.includes("5h"), "Should show 5h quota label");
		assert.ok(fullText.includes("Semanal"), "Should show Semanal quota label");

		// 3. Flat subagent list structure & 3 lines per agent with full-width bars
		assert.ok(/host \/ orquestador/i.test(fullText), "Should render Host orchestrator");
		assert.ok(fullText.includes("gentle-ai-explore"), "Should render gentle-ai-explore");
		assert.ok(fullText.includes("gentle-ai-worker"), "Should render gentle-ai-worker");
		assert.ok(!fullText.includes("ODD Core"), "Should not contain old collapsible category ODD Core");
		assert.ok(!fullText.includes("Judgment Day"), "Should not contain old collapsible category Judgment Day");
		assert.ok(fullText.includes("sin cuota"), "Should show sin cuota fallback for cinlo_dig");
		assert.ok(fullText.includes("▰"), "Should render gauge filled glyph");
		assert.ok(fullText.includes("▱"), "Should render gauge empty glyph");

		// 4. Full-width bar check: lines spanning full innerWidth
		const innerWidth = 52 - 4; // 48
		const fullGaugeLines = lines.filter((l) => {
			const cleaned = l.replace(/\x1b\[[0-9;]*m/g, "");
			return (cleaned.includes("▰") || cleaned.includes("▱")) && !cleaned.includes("@") && !cleaned.includes("%");
		});
		assert.ok(fullGaugeLines.length >= 3, "Should have dedicated full-width gauge lines below accounts");
		// Check that fallback gauge for unavailable quota is entirely empty glyphs
		const fallbackGauge = fullGaugeLines.find((l) => {
			const cleaned = l.replace(/\x1b\[[0-9;]*m/g, "");
			return cleaned.includes("▱".repeat(innerWidth));
		});
		assert.ok(fallbackGauge, "Should have a gauge line with full empty glyphs for account without quota");

		// Check breathing room spacer lines between agents
		const emptySpacerLines = lines.filter((l) => {
			const cleaned = l.replace(/\x1b\[[0-9;]*m/g, "");
			return cleaned.startsWith("║") && cleaned.endsWith("║") && cleaned.slice(1, -1).trim() === "";
		});
		assert.ok(emptySpacerLines.length >= 2, "Should have empty spacer lines between agents for breathing room");

		// 5. Task Manager status summary
		assert.ok(fullText.includes("Task Manager"), "Should render Task Manager status");
		assert.ok(fullText.includes("1/3"), "Should render 1/3 completed tasks");

		// 6. Click switcher hitbox to activate cinlo2
		const hitboxes = card.getSwitcherHitboxes();
		assert.ok(hitboxes.length >= 4, "Should have hitboxes for all discovered profiles");
		const targetHitbox = hitboxes.find((h) => h.profileName === "cinlo2");
		assert.ok(targetHitbox, "Hitbox for cinlo2 must exist");

		renderRequested = false;
		const clickHandled = card.handleRailClick(targetHitbox.lineIndex, "left", targetHitbox.startX + 1);
		assert.ok(clickHandled, "Click on cinlo2 button should be handled");

		// Wait briefly for switchProfile async file write
		await new Promise((r) => setTimeout(r, 50));
		assert.ok(renderRequested, "requestRender should be called on profile switch");
		const activeAfter = fs.readFileSync(path.join(projDir, ".active"), "utf8").trim();
		assert.equal(activeAfter, "cinlo2", "Active profile should be switched to cinlo2");

		// 7. Test clicking effort toggles agent effort (e.g. gentle-ai-worker low -> medium -> high)
		const effortHitbox = hitboxes.find((h) => h.type === "effort-agent" && h.agentId === "gentle-ai-worker");
		assert.ok(effortHitbox, "Effort hitbox for gentle-ai-worker must exist");
		renderRequested = false;
		const effortClickHandled = card.handleRailClick(effortHitbox.lineIndex, "left", effortHitbox.startX + 1);
		assert.ok(effortClickHandled, "Click on effort hitbox should be handled");
		assert.ok(renderRequested, "requestRender should be called on effort toggle");

		// 8. Test wheel on profiles card is disabled to preserve natural sidebar vertical scrolling
		renderRequested = false;
		const wheelHandled = card.handleRailWheel(1);
		assert.equal(wheelHandled, false, "handleRailWheel should return false to preserve vertical scroll");
		assert.equal(renderRequested, false, "requestRender should NOT be called on wheel when disabled");

		// 7. Click outside hitboxes returns false
		const missClick = card.handleRailClick(targetHitbox.lineIndex, "left", 999);
		assert.equal(missClick, false, "Click outside hitbox bounds should return false");

		// 8. Narrow width rendering safety (width = 30)
		const narrowLines = card.render(30);
		assert.ok(narrowLines.length > 0);
		for (const line of narrowLines) {
			assert.ok(visibleWidth(line) <= 30, `Line width ${visibleWidth(line)} should be <= 30`);
		}
	} finally {
		setCachedAccountsForTesting(null);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetAll();
	}
});

test("cute-profiles - CinlodevProfilesExtendedCard internal scrolling and height constraint", () => {
	resetAll();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-scroll-test-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "prof1", "utf8");
		fs.writeFileSync(
			path.join(projDir, "prof1.json"),
			JSON.stringify({
				name: "prof1",
				default_model: "cpamc/acc1/gemini-3.8-flash-high",
				default_effort: "high",
				model_profiles: {
					"gentle-ai-worker": { model: "cpamc/acc2/gemini-3.8-flash-high", effort: "high" },
					"gentle-ai-explore": { model: "cpamc/acc3/gemini-3.8-flash-high", effort: "low" },
					"jd-judge-a": { model: "cpamc/acc1/gemini-3.8-flash-high", effort: "high" },
					"review-risk": { model: "cpamc/acc2/gemini-3.8-flash-high", effort: "medium" },
					"review-reliability": { model: "cpamc/acc3/gemini-3.8-flash-high", effort: "low" },
					"research-scout": { model: "cpamc/acc1/gemini-3.8-flash-high", effort: "high" },
					"research-writer": { model: "cpamc/acc2/gemini-3.8-flash-high", effort: "medium" },
				},
			}),
			"utf8",
		);

		let renderRequested = false;
		const mockTui: any = {
			requestRender: () => {
				renderRequested = true;
			},
		};

		const card = new CinlodevProfilesExtendedCard(mockTui, undefined, tmpDir);

		// 1. Calling render(52, 25) constrains lines to exactly 25
		const lines = card.render(52, 25);
		assert.equal(lines.length, 25, "Lines must be constrained to exactly 25");

		// Top header and divider should be intact
		assert.ok(lines[0].includes("Profiles & Clusters"), "Header must be at the top");
		const fullText = lines.join("\n");
		assert.ok(fullText.includes("wheel scroll"), "Scroll indicator must be visible when content overflows");
		assert.ok(fullText.includes("abajo"), "Should indicate remaining lines below");

		// 2. handleRailWheel(1) increments scrollOffset and requests render
		renderRequested = false;
		const wheelDownHandled = card.handleRailWheel(1);
		assert.equal(wheelDownHandled, true, "Wheel down should be handled internally");
		assert.equal(renderRequested, true, "requestRender should be called on scroll");

		const scrolledLines = card.render(52, 25);
		assert.equal(scrolledLines.length, 25, "Scrolled lines must still equal 25");
		const scrolledText = scrolledLines.join("\n");
		assert.ok(scrolledText.includes("arriba"), "Should indicate scrolled lines above");

		// 3. handleRailWheel(-1) decrements scrollOffset
		renderRequested = false;
		const wheelUpHandled = card.handleRailWheel(-1);
		assert.equal(wheelUpHandled, true, "Wheel up should be handled internally");
		assert.equal(renderRequested, true, "requestRender should be called on scroll up");

		// 4. Boundary behavior: scrolling past top returns true but doesn't request unnecessary render
		renderRequested = false;
		const topBoundaryHandled = card.handleRailWheel(-1);
		assert.equal(topBoundaryHandled, true, "Top boundary wheel should return true to block outer scroll");
		assert.equal(renderRequested, false, "Should not requestRender when already at boundary");

		// 5. wheelDelta === 0 returns false
		assert.equal(card.handleRailWheel(0), false, "handleRailWheel(0) should return false");

		// 6. When availableHeight is large (no overflow), pad with empty lines to match availableHeight
		const largeLines = card.render(52, 60);
		assert.equal(largeLines.length, 60, "Lines must be padded to exactly target availableHeight 60");
		const largeText = largeLines.join("\n");
		assert.ok(!largeText.includes("wheel scroll"), "No scroll indicator should be present when content fits");

		// 7. When availableHeight is undefined and no terminal rows, render natural unconstrained lines
		const unconstrainedLines = card.render(52);
		assert.ok(unconstrainedLines.length > 0);
		assert.ok(!unconstrainedLines.join("\n").includes("wheel scroll"));
		// And handleRailWheel returns false when unconstrained
		assert.equal(card.handleRailWheel(1), false, "handleRailWheel should return false when unconstrained");

		// 8. Terminal rows calculation fallback when availableHeight is undefined
		mockTui.terminal = { rows: 40 };
		const terminalRowsLines = card.render(52);
		assert.equal(terminalRowsLines.length, 29, "Lines should equal terminal.rows - 11 (40 - 11 = 29)");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetAll();
	}
});

test("cute-profiles - edge cases for account extraction and empty profiles", () => {
	// Malformed model strings
	assert.equal(extractAccountFromModel("cpamc//model"), null);
	assert.equal(extractAccountFromModel("cpamc/ranchesca"), null);
	assert.equal(extractAccountFromModel("   "), null);

	// Empty profile
	const emptyProfile: any = {};
	assert.deepEqual(extractUniqueAccounts(emptyProfile), []);

	// Profile with empty model_profiles
	const minimalProfile: any = { name: "min", model_profiles: {} };
	assert.deepEqual(extractUniqueAccounts(minimalProfile), []);

	// Non-existent profile details load
	assert.equal(loadProfileDetails("does-not-exist-xyz", "/tmp"), null);
});

test("cute-profiles - dynamic multi-provider matching and single pool rendering (Gemini/Argon & Codex)", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-profiles-provider-"));
	const profilesDir = path.join(tmpDir, ".pi", "profiles");
	fs.mkdirSync(profilesDir, { recursive: true });

	const profileData = {
		name: "test-multiprovider",
		description: "Multi-provider test",
		default_model: "cpamc/cilon-gpt/gpt-6.1-sol",
		default_effort: "high",
		model_profiles: {
			"gentle-ai-worker": {
				model: "cpamc/cinlodev/gemini-4-argon-high",
				effort: "high",
			},
		},
	};

	fs.writeFileSync(path.join(profilesDir, "test-multiprovider.json"), JSON.stringify(profileData));
	fs.writeFileSync(path.join(profilesDir, ".active"), "test-multiprovider");

	// Provide two colliding accounts: 'cilon' (antigravity) and 'cilon-gpt' (codex),
	// plus 'cinlodev' with ONLY weekly pool (like Gemini/Argon)
	setCachedAccountsForTesting([
		{
			provider: "antigravity",
			prefix: "cilon",
			pools: [
				{ label: "Claude and GPT models · Weekly Limit Remaining", availablePercent: 10, used: 90, total: 100, unlimited: false, resetAt: null },
			],
		},
		{
			provider: "codex",
			prefix: "cilon-gpt",
			pools: [
				{ label: "Codex / Plus 5h", availablePercent: 67, used: 33, total: 100, unlimited: false, resetAt: null },
				{ label: "Codex / Plus Semanal", availablePercent: 81, used: 19, total: 100, unlimited: false, resetAt: null },
			],
		},
		{
			provider: "antigravity",
			prefix: "cinlodev",
			pools: [
				// Only 1 pool: Weekly
				{ label: "Gemini Models · Weekly Limit Remaining", availablePercent: 100, used: 0, total: 100, unlimited: false, resetAt: null },
			],
		},
	]);

	try {
		const mockTui: any = { requestRender: () => {} };
		const card = new CinlodevProfilesExtendedCard(mockTui, undefined, tmpDir);
		const lines = card.render(50);
		const fullText = lines.join("\n");

		// 1. Host using GPT must resolve to codex 'cilon-gpt' (67% 5h, 81% Semanal), NOT antigravity 'cilon' (10%)
		assert.ok(fullText.includes("cilon-gpt"), "Host with GPT model must match codex cilon-gpt");
		assert.ok(fullText.includes("67%"), "Host must display 67% from codex account");
		assert.ok(fullText.includes("81%"), "Host must display 81% from codex account");
		assert.ok(!fullText.includes("10%"), "Host must NOT accidentally match antigravity cilon account");

		// 2. Worker using Gemini/Argon in cinlodev has only 1 weekly pool (100%)
		assert.ok(fullText.includes("cinlodev"), "Worker must list cinlodev account");
		assert.ok(fullText.includes("100%"), "Worker with Argon must show 100% weekly quota");
		// Verify dynamic label Semanal is rendered cleanly alongside the @cinlodev prefix
		assert.ok(fullText.includes("@cinlodev · Semanal"), "Single-pool account must render @cinlodev · Semanal on first line");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetAll();
	}
});
