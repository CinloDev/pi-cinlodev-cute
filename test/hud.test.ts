import test from "node:test";
import assert from "node:assert/strict";
import { GentlemanHudWidget } from "../src/hud.ts";

test("GentlemanHudWidget - renders cleanly without throwing on secondary color token", () => {
	// Theme strictly rejecting non-standard tokens (like Pi 1.2.0 does)
	const strictPiTheme: any = {
		fg: (color: string, text: string) => {
			if (color === "secondary") {
				throw new Error("Unknown theme color: secondary");
			}
			return text;
		},
		bg: (_color: string, text: string) => text,
	};

	const mockCtx: any = {
		sessionManager: {
			getBranch: () => [],
		},
		model: {
			provider: "anthropic",
			id: "claude-3-5-sonnet",
			contextWindow: 200_000,
		},
		getContextUsage: () => ({ tokens: 5000 }),
		cwd: process.cwd(),
	};

	const widget = new GentlemanHudWidget(
		() => mockCtx,
		strictPiTheme,
		() => "full",
	);

	// Rendering should never throw even if git branch uses secondary styling
	const lines = widget.render(120);
	assert.ok(Array.isArray(lines));
	assert.ok(lines.length > 0);

	// Also verify compact mode
	const compactWidget = new GentlemanHudWidget(
		() => mockCtx,
		strictPiTheme,
		() => "compact",
	);
	const compactLines = compactWidget.render(120);
	assert.ok(Array.isArray(compactLines));
	assert.ok(compactLines.length > 0);
});
