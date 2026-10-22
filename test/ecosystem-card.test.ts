import { test } from "node:test";
import assert from "node:assert/strict";
import {
	cleanVersionString,
	resolveCutePackageVersion,
	resolveGentleShellPackageVersion,
	setCachedEcosystemForTesting,
	getCachedEcosystem,
	resetEcosystemCache,
	type EcosystemData,
} from "../src/ecosystem/ecosystem-client.ts";
import {
	CinlodevEcosystemCard,
	formatEcosystemPill,
} from "../src/ecosystem/ecosystem-card.ts";
import { cutePalette } from "../src/cute-theme.ts";
import { SIDEBAR_TAB_CARD_MAP, resolveSidebarTab } from "../src/sidebar-tabs.ts";
import { installCinlodevFooter } from "../src/footer.ts";
import { calcVisibleWidth } from "../src/cute-transcript.ts";

test("ecosystem-client - cleanVersionString parses various version outputs cleanly", () => {
	assert.equal(cleanVersionString("engram 3.4.0\n"), "3.4.0");
	assert.equal(cleanVersionString("gentle-ai 4.1.1"), "4.1.1");
	assert.equal(cleanVersionString("1.3.0\n"), "1.3.0");
	assert.equal(cleanVersionString("v2.5.1-rc.2"), "2.5.1-rc.2");
	assert.equal(cleanVersionString(""), "");
	assert.equal(cleanVersionString("herdr version 0.9.5-dirty"), "0.9.5-dirty");
});

test("ecosystem-client - resolveCutePackageVersion reads local package or fallback", () => {
	const ver = resolveCutePackageVersion();
	assert.ok(typeof ver === "string" && ver.length > 0);
	assert.match(ver, /^\d+\.\d+\.\d+/);
});

test("ecosystem-client - resolveGentleShellPackageVersion resolves version string or null", () => {
	const ver = resolveGentleShellPackageVersion();
	if (ver !== null) {
		assert.match(ver, /^\d+\.\d+\.\d+/);
	}
});

test("ecosystem-card - formatEcosystemPill formats available and unavailable tools", () => {
	const availablePill = formatEcosystemPill(
		{ id: "pi", name: "pi", version: "1.3.0", available: true, accent: "cyan" },
		undefined
	);
	assert.ok(availablePill.includes("pi"));
	assert.ok(availablePill.includes("v1.3.0"));

	const unavailablePill = formatEcosystemPill(
		{ id: "herdr", name: "herdr", version: "-", available: false, accent: "gold" },
		undefined
	);
	assert.ok(unavailablePill.includes("herdr"));
	assert.ok(unavailablePill.includes("-"));
});

test("ecosystem-card - CinlodevEcosystemCard renders within bounds without width overflow", () => {
	resetEcosystemCache();

	const mockData: EcosystemData = {
		detectedAt: Date.now(),
		tools: [
			{ id: "pi", name: "pi", version: "1.3.0", available: true, accent: "cyan" },
			{ id: "cute", name: "cute", version: "1.0.0", available: true, accent: "pink" },
			{ id: "gentle-shell", name: "gentle-shell", version: "4.3.0", available: true, accent: "gold" },
			{ id: "gentle-ai", name: "gentle-ai", version: "4.1.1", available: true, accent: "mint" },
			{ id: "engram", name: "engram", version: "3.4.0", available: true, accent: "purple" },
			{ id: "herdr", name: "herdr", version: "0.9.5", available: true, accent: "cyan" },
		],
	};

	setCachedEcosystemForTesting(mockData);

	const mockCtx: any = {};
	const mockTui: any = { requestRender() {} };
	const card = new CinlodevEcosystemCard(mockCtx, mockTui);

	const width = 45;
	const lines = card.render(width);
	assert.ok(lines.length >= 3);

	// Verify border box width constraints
	for (const line of lines) {
		const visible = calcVisibleWidth(line);
		assert.equal(visible, width, `Line width mismatch: expected ${width}, got ${visible}`);
	}

	const fullText = lines.join("\n");
	assert.ok(fullText.includes("Stack"));
	assert.ok(fullText.includes("Ecosistema"));
	assert.ok(fullText.includes("pi"));
	assert.ok(fullText.includes("gentle-shell"));
	assert.ok(fullText.includes("gentle-ai"));

	// Check interactive expansion toggle
	card.handleClick();
	const expandedLines = card.render(width);
	assert.ok(expandedLines.length >= 6);
	for (const line of expandedLines) {
		const visible = calcVisibleWidth(line);
		assert.equal(visible, width, `Expanded line width mismatch: expected ${width}, got ${visible}`);
	}
	const expandedText = expandedLines.join("\n");
	assert.ok(expandedText.includes("instalado"));
});

test("sidebar tabs - MEM tab includes ecosystem card", () => {
	assert.ok(SIDEBAR_TAB_CARD_MAP.mem.includes("ecosystem"));
	const memTab = resolveSidebarTab("mem");
	assert.ok(memTab.cards.includes("ecosystem"));
});

test("footer - installCinlodevFooter initializes ecosystemPart and disposes cleanly without ReferenceError", () => {
	let registeredFooterFactory: any = null;
	const mockCtx: any = {
		hasUI: true,
		ui: {
			setFooter(factory: any) {
				registeredFooterFactory = factory;
			},
		},
		model: { provider: "test", name: "test-model" },
		getContextUsage: () => ({ tokens: 1000, contextWindow: 100000 }),
	};
	const mockPi: any = {
		on: () => {},
		getCommandHistory: () => [],
	};
	installCinlodevFooter(mockCtx, mockPi);
	assert.ok(registeredFooterFactory, "setFooter should have been called");

	const mockTui: any = {
		requestRender() {},
		terminal: { columns: 120, rows: 40, write() {} },
	};
	const footerInstance = registeredFooterFactory(mockTui, undefined, { getStatus: () => [] });
	assert.ok(footerInstance, "Footer instance created");
	assert.equal(typeof footerInstance.dispose, "function");

	assert.doesNotThrow(() => {
		footerInstance.dispose();
	});
});
