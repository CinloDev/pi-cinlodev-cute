import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawClueUsage, setCachedClueUsageForTesting, getCachedClueUsage, resetClueUsageCache } from "../src/usage/clue-client.ts";
import { CinlodevClueCard } from "../src/usage/clue-card.ts";
import { SIDEBAR_TAB_CARD_MAP, resolveSidebarTab } from "../src/sidebar-tabs.ts";

test("clue-client - parseRawClueUsage parses balance, tokens, and topModels cleanly", () => {
	const mockRaw = {
		balance: 499.5,
		remaining: 499.5,
		unit: "USD",
		isValid: true,
		planName: "钱包余额",
		usage: {
			today: {
				requests: 14,
				total_tokens: 77777,
				actual_cost: 0.5,
			},
		},
		model_stats: [
			{ model: "claude-haiku-4-5-20251001", requests: 4, actual_cost: 0.033 },
			{ model: "claude-opus-5-5", requests: 2, actual_cost: 0.11 },
			{ model: "claude-sonnet-5-5", requests: 2, actual_cost: 0.052 },
			{ model: "claude-unused", requests: 0, actual_cost: 0 },
		],
	};

	const parsed = parseRawClueUsage(mockRaw);
	assert.equal(parsed.balance, 499.5);
	assert.equal(parsed.currency, "USD");
	assert.equal(parsed.isValid, true);
	assert.equal(parsed.todayRequests, 14);
	assert.equal(parsed.todayTokens, 77777);
	assert.equal(parsed.todayCost, 0.5);
	assert.equal(parsed.topModels.length, 3);
	assert.equal(parsed.topModels[0].model, "claude-haiku-4-5-20251001");
	assert.equal(parsed.topModels[0].requests, 4);
});

test("clue-card - CinlodevClueCard renders cleanly within bounds without exposing secrets", () => {
	resetClueUsageCache();
	setCachedClueUsageForTesting({
		balance: 499.5,
		remaining: 499.5,
		currency: "USD",
		isValid: true,
		planName: "Saldo",
		todayRequests: 14,
		todayTokens: 77777,
		todayCost: 0.5,
		topModels: [
			{
				model: "claude-haiku-4-5-20251001",
				requests: 4,
				inputTokens: 16000,
				outputTokens: 68,
				totalTokens: 16068,
				cost: 0.016,
				actualCost: 0.033,
			},
		],
	});

	const mockCtx: any = {};
	const mockTui: any = { requestRender() {} };
	const card = new CinlodevClueCard(mockCtx, mockTui);

	const width = 45;
	const lines = card.render(width);
	assert.ok(lines.length >= 4);

	// Verify no API keys or raw tokens leaked
	const fullText = lines.join("\n");
	assert.ok(!fullText.includes("sk-"));
	assert.ok(!fullText.includes("Bearer"));
	assert.ok(fullText.includes("Clue"));
	assert.ok(fullText.includes("499.50"));

	// Check interactive expansion
	card.handleClick();
	const expandedLines = card.render(width);
	const expandedText = expandedLines.join("\n");
	assert.ok(expandedText.includes("haiku"));
});

test("sidebar tabs - MAIN tab includes clue card", () => {
	assert.ok(SIDEBAR_TAB_CARD_MAP.main.includes("clue"));
	const mainTab = resolveSidebarTab("main");
	assert.ok(mainTab.cards.includes("clue"));
});
