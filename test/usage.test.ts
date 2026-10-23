import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	parseRawUsageToAccounts,
	formatRelativeReset,
	cleanPoolLabel,
	cleanDynamicPoolLabel,
	resetUsageCache,
	prioritizeActiveAccount,
	setCachedAccountsForTesting,
	getQuotaThreshold,
} from "../src/cute-usage.ts";
import { resetAll, userConfigFile } from "./test-helpers.ts";

test("cute-usage - getQuotaThreshold 4-tier semáforo dynamic colors", () => {
	const mockPalette = {
		mint: (s: string) => `[mint]${s}[/mint]`,
		gold: (s: string) => `[gold]${s}[/gold]`,
		orange: (s: string) => `[orange]${s}[/orange]`,
		coral: (s: string) => `[coral]${s}[/coral]`,
	} as any;

	// >= 65% -> Mint (Óptimo / Holgado)
	const optimal100 = getQuotaThreshold(100, mockPalette);
	assert.equal(optimal100.level, "optimal");
	assert.equal(optimal100.label, "Óptimo");
	assert.equal(optimal100.color("●"), "[mint]●[/mint]");

	const optimal65 = getQuotaThreshold(65, mockPalette);
	assert.equal(optimal65.level, "optimal");
	assert.equal(optimal65.color("●"), "[mint]●[/mint]");

	// 64.5% rounds to 65% -> mint
	const roundedMint = getQuotaThreshold(64.5, mockPalette);
	assert.equal(roundedMint.level, "optimal");

	// 40% to 64% -> Gold (Medio / Moderado)
	const medium64 = getQuotaThreshold(64.4, mockPalette);
	assert.equal(medium64.level, "medium");
	assert.equal(medium64.label, "Medio");
	assert.equal(medium64.color("●"), "[gold]●[/gold]");

	const medium40 = getQuotaThreshold(40, mockPalette);
	assert.equal(medium40.level, "medium");
	assert.equal(medium40.color("●"), "[gold]●[/gold]");

	// 39.5% rounds to 40% -> gold
	const roundedGold = getQuotaThreshold(39.5, mockPalette);
	assert.equal(roundedGold.level, "medium");

	// 20% to 39% -> Orange (Alerta)
	const alert39 = getQuotaThreshold(39.4, mockPalette);
	assert.equal(alert39.level, "alert");
	assert.equal(alert39.label, "Alerta");
	assert.equal(alert39.color("●"), "[orange]●[/orange]");

	const alert20 = getQuotaThreshold(20, mockPalette);
	assert.equal(alert20.level, "alert");
	assert.equal(alert20.color("●"), "[orange]●[/orange]");

	// 19.5% rounds to 20% -> orange
	const roundedOrange = getQuotaThreshold(19.5, mockPalette);
	assert.equal(roundedOrange.level, "alert");

	// < 20% -> Coral (Crítico)
	const critical19 = getQuotaThreshold(19.4, mockPalette);
	assert.equal(critical19.level, "critical");
	assert.equal(critical19.label, "Crítico");
	assert.equal(critical19.color("●"), "[coral]●[/coral]");

	const critical0 = getQuotaThreshold(0, mockPalette);
	assert.equal(critical0.level, "critical");
	assert.equal(critical0.color("●"), "[coral]●[/coral]");
});

test("cute-usage - parseRawUsageToAccounts and formatRelativeReset", () => {
	// 1. Relative reset formatting
	const now = 1726700000000;
	assert.equal(formatRelativeReset(null, now), "");
	assert.equal(formatRelativeReset("invalid-date", now), "");
	// 25 minutes ahead
	const in25m = new Date(now + 25 * 60 * 1000).toISOString();
	assert.equal(formatRelativeReset(in25m, now), "en 25m");
	// 3 hours ahead
	const in3h = new Date(now + 3 * 3600 * 1000).toISOString();
	assert.equal(formatRelativeReset(in3h, now), "en 3h");
	// 2 days and 4 hours ahead
	const in2d4h = new Date(now + (2 * 24 + 4) * 3600 * 1000).toISOString();
	assert.equal(formatRelativeReset(in2d4h, now), "en 2d 4h");
	// In the past
	const past = new Date(now - 10000).toISOString();
	assert.equal(formatRelativeReset(past, now), "reseteando…");

	// 2. cleanPoolLabel & cleanDynamicPoolLabel
	assert.equal(cleanPoolLabel("Gemini Models · Weekly Limit Remaining"), "Gemini Weekly");
	assert.equal(cleanPoolLabel("Claude and GPT models · Five Hour Limit Remaining"), "Claude/GPT 5h");
	assert.equal(cleanDynamicPoolLabel("Claude and GPT models · Five Hour Limit Remaining"), "5h");
	assert.equal(cleanDynamicPoolLabel("Claude and GPT models · Weekly Limit Remaining"), "Semanal");
	assert.equal(cleanDynamicPoolLabel("Codex / Plus 5h"), "5h");
	assert.equal(cleanDynamicPoolLabel("Codex / Plus Semanal"), "Semanal");

	// 3. Parse raw usage to accounts with prefixes
	const prefixMap = new Map([
		["testuser@example.com", "test_user"],
	]);
	const rawGroups = [
		{
			provider: "antigravity",
			accounts: [
				{
					account: "testuser@example.com",
					pools: [
						{ label: "Gemini Models (weekly)", availablePercentage: 84, resetAt: in3h },
						{ label: "Gemini Models (5h)", availablePercentage: 100, resetAt: in3h },
						{ label: "Claude and GPT models (weekly)", availablePercentage: 100, resetAt: in3h },
						{ label: "Claude and GPT models (5h)", availablePercentage: 100, resetAt: in3h },
					],
				},
			],
		},
	];

	const accounts = parseRawUsageToAccounts(rawGroups, prefixMap);
	assert.equal(accounts.length, 1);
	assert.equal(accounts[0].provider, "antigravity");
	assert.equal(accounts[0].prefix, "test_user", "Must use prefix instead of email");
	assert.equal(accounts[0].pools.length, 4, "Must hold all 4 quota pools");
	assert.equal(accounts[0].pools[0].availablePercent, 84);

	// 4. Provider-isolated prefix mapping without collisions
	const collidingPrefixMap = new Map([
		["antigravity:user@example.com", "user_main"],
		["codex:user@example.com", "codex_user"],
		["user@example.com", "fallback_should_not_be_used"],
	]);
	const multiProviderGroups = [
		{
			provider: "antigravity",
			accounts: [{ account: "user@example.com", pools: [{ label: "Gemini", availablePercentage: 100 }] }],
		},
		{
			provider: "codex",
			accounts: [{ account: "user@example.com", pools: [{ label: "Codex", availablePercentage: 50 }] }],
		},
	];
	const multiAccounts = parseRawUsageToAccounts(multiProviderGroups, collidingPrefixMap);
	assert.equal(multiAccounts[0].prefix, "user_main", "Antigravity account must get provider-scoped prefix");
	assert.equal(multiAccounts[1].prefix, "codex_user", "Codex account must get provider-scoped prefix");

	// 5. prioritizeActiveAccount puts active prefix at index 0
	const mockAccounts = [
		{ provider: "codex", prefix: "codex", pools: [] },
		{ provider: "antigravity", prefix: "test_user", pools: [] },
		{ provider: "antigravity", prefix: "acc_active", pools: [] },
	];
	const prioritized = prioritizeActiveAccount(mockAccounts, "acc_active");
	assert.equal(prioritized[0].prefix, "acc_active", "Active orchestrator prefix must be at index 0");
});

