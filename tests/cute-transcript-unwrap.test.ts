import test from "node:test";
import assert from "node:assert/strict";
import {
	unwrapNativeCard,
	extractCardHeaderTitle,
	stripCardLineBorders,
	cleanBashLines,
	formatBashCommandHeader,
	formatBashOutputLines,
	formatGrepLines,
	formatReadLines,
	formatWriteDiffLines,
	formatToolCallCard,
	formatFilePreview,
	formatTranscriptChildren,
	formatTranscriptChild,
	isAsciiArtOrBanner,
} from "../src/cute-transcript.ts";
import { stripAnsi } from "../src/cute-theme.ts";

const mockTheme = {
	fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
} as any;

test("unwrapNativeCard - detects and strips float card chrome with background leaks and padding", () => {
	const floatLines = [
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m $ bash $ npm test               \x1b[2mctrl+o to expand\x1b[22m   \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m pass 1                                         \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m pass 2                                         \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
	];

	const unwrapped = unwrapNativeCard(floatLines);

	// 1. Leading and trailing blank float padding lines are dropped
	assert.ok(!unwrapped[0].includes("▎"));
	assert.ok(!unwrapped[unwrapped.length - 1].includes("▎"));

	// 2. Background escapes \x1b[48;...m and \x1b[49m are completely stripped
	for (const line of unwrapped) {
		assert.ok(!/\x1b\[48;[0-9;]*m/.test(line), `leaking bg escape in: ${line}`);
		assert.ok(!/\x1b\[49m/.test(line), `leaking bg reset in: ${line}`);
		assert.ok(!line.includes("▎"), `orphaned rail in: ${line}`);
	}

	// 3. Lines contain only clean content
	assert.ok(unwrapped[0].includes("$ bash $ npm test"));
	assert.equal(unwrapped[1], "pass 1");
	assert.equal(unwrapped[2], "pass 2");
	assert.equal(unwrapped.length, 3);
});

test("unwrapNativeCard - retains full compatibility with outline cards", () => {
	const outlineLines = [
		"╭─ ✿ $ npm test ──────────────────────── ctrl+o to expand ╮",
		"│ pass 1                                                  │",
		"│ pass 2                                                  │",
		"╰─────────────────────────────────────────────────────────╯",
	];

	const unwrapped = unwrapNativeCard(outlineLines);
	assert.deepEqual(unwrapped, ["$ npm test", "pass 1", "pass 2"]);
});

test("formatBashCommandHeader - normalizes bash headers and strips key hints", () => {
	// 1. $ bash $ <cmd> -> $ <cmd>
	const h1 = formatBashCommandHeader("$ bash $ npm test", mockTheme);
	assert.ok(h1.startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(h1.includes("npm test"));
	assert.ok(!h1.includes("bash $"));

	// 2. bash $ <cmd> -> $ <cmd>
	const h2 = formatBashCommandHeader("bash $ git status", mockTheme);
	assert.ok(h2.startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(h2.includes("git status"));
	assert.ok(!h2.includes("bash $"));

	// 3. Trailing key hint is stripped
	const h3 = formatBashCommandHeader("$ bash $ ls -la   ctrl+o to expand", mockTheme);
	assert.ok(h3.startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(h3.includes("ls -la"));
	assert.ok(!h3.includes("ctrl+o"));
	assert.ok(!h3.includes("expand"));

	// 4. Standard $ <cmd> works with key hint
	const h4 = formatBashCommandHeader("$ cargo build  ctrl+o to collapse", mockTheme);
	assert.ok(h4.startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(h4.includes("cargo build"));
	assert.ok(!h4.includes("ctrl+o"));
});

test("cleanBashLines and formatBashOutputLines - clean float chrome and normalize bash header", () => {
	const floatBashLines = [
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m $ bash $ echo hello            \x1b[2mctrl+o to expand\x1b[22m   \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m hello                                          \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
	];

	const cleaned = cleanBashLines(floatBashLines);
	assert.deepEqual(cleaned, ["$ echo hello", "hello"]);

	const formatted = formatBashOutputLines(floatBashLines, mockTheme);
	assert.ok(formatted[0].startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(formatted[0].includes("echo hello"));
	assert.ok(!formatted[0].includes("bash $"));
	assert.ok(!formatted[0].includes("ctrl+o"));
	assert.ok(!formatted[0].includes("▎"));
});

test("tool renderers - formatGrepLines, formatReadLines, formatWriteDiffLines unwrap float chrome cleanly", () => {
	// Grep with float chrome
	const floatGrep = [
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m ⌕ grep /test/ in .             \x1b[2mctrl+o to expand\x1b[22m   \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m src/foo.ts:10:const test = 1;                  \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
	];
	const grepResult = formatGrepLines(floatGrep, mockTheme);
	assert.ok(!grepResult[0].includes("▎"));
	assert.ok(!grepResult[1].includes("▎"));
	assert.ok(grepResult[1].includes("[read]src/foo.ts[/read]"));
	assert.ok(grepResult[1].includes("[syntaxNumber]10[/syntaxNumber]"));

	// Read with float chrome
	const floatRead = [
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m ≡ read src/foo.ts              \x1b[2mctrl+o to expand\x1b[22m   \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m    1 │ const a = 1;                            \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
	];
	const readResult = formatReadLines(floatRead, "src/foo.ts", mockTheme);
	assert.ok(!readResult[0].includes("▎"));
	assert.ok(!readResult[1].includes("▎"));
	assert.ok(readResult[1].includes("[syntaxNumber]1[/syntaxNumber]"));

	// Write / edit with float chrome
	const floatEdit = [
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m ✎ edit src/foo.ts              \x1b[2mctrl+o to expand\x1b[22m   \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m +10 const next = 2;                            \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
	];
	const editResult = formatWriteDiffLines(floatEdit, "src/foo.ts", mockTheme, "edit");
	assert.ok(!editResult[0].includes("▎"));
	assert.ok(!editResult[1].includes("▎"));
	assert.ok(editResult[1].includes("[toolDiffAdded]+10 [/toolDiffAdded]"));
});

test("unwrapNativeCard - preserves internal body blank lines while stripping padding", () => {
	const floatMulti = [
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m ≡ read src/foo.ts              \x1b[2mctrl+o to expand\x1b[22m   \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m line 1                                         \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m line 2                                         \x1b[49m ",
		" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
	];

	const unwrapped = unwrapNativeCard(floatMulti);
	assert.equal(unwrapped.length, 4);
	assert.equal(unwrapped[0], "≡ read src/foo.ts");
	assert.equal(unwrapped[1], "line 1");
	assert.equal(unwrapped[2], "");
	assert.equal(unwrapped[3], "line 2");
});

test("unwrapNativeCard - outline cards with tool glyphs extract title cleanly", () => {
	const outlineGrep = [
		"╭─ ⌕ grep /error/ in src ───────────────── ctrl+o to expand ╮",
		"│ match 1                                                   │",
		"╰───────────────────────────────────────────────────────────╯",
	];
	const unwrappedGrep = unwrapNativeCard(outlineGrep);
	assert.deepEqual(unwrappedGrep, ["grep /error/ in src", "match 1"]);

	const outlineRead = [
		"╭─ ≡ read /var/log/syslog ──────────────── ctrl+o to expand ╮",
		"│ log line 1                                                │",
		"╰───────────────────────────────────────────────────────────╯",
	];
	const unwrappedRead = unwrapNativeCard(outlineRead);
	assert.deepEqual(unwrappedRead, ["read /var/log/syslog", "log line 1"]);
});

test("formatTranscriptChildren - groups consecutive subagent status polls into one coalesced card", () => {
	const comp1 = {
		toolName: "subagent_status",
		render: () => [
			"agent status · muqbfaub-1-mq3o",
			"muqbfaub-1-mq3o · gentle-ai-explore · running · background · 61 turns · 61 tool calls · last: read",
		],
	};
	const comp2 = {
		toolName: "subagent_status",
		render: () => [
			"agent status · muqbfaub-1-mq3o",
			"muqbfaub-1-mq3o · gentle-ai-explore · running · background · 62 turns · 62 tool calls · last: grep",
		],
	};

	const { lines, mouseChildren } = formatTranscriptChildren([comp1 as any, comp2 as any], 120);
	const plain = lines.map(stripAnsi).join("\n");

	assert.match(plain, /🤖 subagent/);
	assert.match(plain, /62 turns/);
	assert.match(plain, /2 status polls coalesced/);
	assert.equal(mouseChildren.length, 2);
});

test("formatTranscriptChild - frames subagent tool in cyan card", () => {
	const comp = {
		toolName: "subagent_status",
		render: () => [
			"agent status · task-123",
			"task-123 · worker · completed · task · cwd: /app · 5 turns · 5 tool calls · last: edit",
		],
	};
	const lines = formatTranscriptChild(comp as any, 80);
	const plain = lines.map(stripAnsi).join("\n");
	assert.match(plain, /🤖 subagent/);
	assert.match(plain, /task-123/);
});

test("isAsciiArtOrBanner protects neko banner and dense ASCII block art", () => {
	const nekoBannerLines = [
		"                                            \u001b[38;2;158;101;219m\u2584\u001b[0m\u001b[38;2;23;29;31m\u2584\u001b[0m\u001b[38;2;158;101;219m\u2596\u001b[0m                     ",
		"                  \u001b[38;2;158;101;219m\u259f\u001b[0m\u001b[38;2;158;101;219m\u001b[48;2;23;29;31m\u2580\u001b[0m\u001b[38;2;158;101;219m\u2584\u001b[0m\u001b[38;2;158;101;219m\u2596\u001b[0m                    \u001b[38;2;158;101;219m\u2584\u001b[0m\u001b[38;2;158;101;219m\u001b[48;2;23;29;31m\u2598\u001b[0m\u001b[38;2;170;77;54m\u001b[48;2;23;29;31m\u2597\u001b[0m\u001b[38;2;170;77;54m\u2588\u001b[0m\u001b[38;2;170;77;54m\u001b[48;2;23;29;31m\u2599\u001b[0m\u001b[38;2;158;101;219m\u2599\u001b[0m                    ",
		"                 \u001b[38;2;158;101;219m\u259f\u001b[0m\u001b[38;2;170;77;54m\u2588\u001b[0m\u001b[38;2;170;77;54m\u2588\u001b[0m\u001b[38;2;170;77;54m\u001b[48;2;23;29;31m\u2584\u001b[0m\u001b[38;2;23;29;31m\u2588\u001b[0m\u001b[38;2;23;29;31m\u2599\u001b[0m\u001b[38;2;158;101;219m\u2596\u001b[0m                \u001b[38;2;158;101;219m\u2597\u001b[0m\u001b[38;2;158;101;219m\u001b[48;2;23;29;31m\u2580\u001b[0m\u001b[38;2;23;29;31m\u2588\u001b[0m\u001b[38;2;170;77;54m\u001b[48;2;23;29;31m\u2597\u001b[0m\u001b[38;2;170;77;54m\u2588\u001b[0m\u001b[38;2;170;77;54m\u2588\u001b[0m\u001b[38;2;170;77;54m\u2588\u001b[0m\u001b[38;2;170;77;54m\u2588\u001b[0m\u001b[38;2;158;101;219m\u2599\u001b[0m                   ",
		"                        \x1b[1;38;2;0;229;255m\u2726\x1b[0m  \x1b[1;38;2;222;124;82mN e k o - p i\x1b[0m  \x1b[1;38;2;158;101;219m\u2726\x1b[0m                         ",
	];

	assert.equal(isAsciiArtOrBanner(nekoBannerLines), true);

	// unwrapNativeCard should leave it 100% untouched
	const unwrapped = unwrapNativeCard(nekoBannerLines);
	assert.deepEqual(unwrapped, nekoBannerLines);
	// 24-bit background color escape preserved
	assert.ok(unwrapped[1].includes("\u001b[48;2;23;29;31m"));

	// formatTranscriptChildren should render it completely intact
	const comp = {
		render: () => nekoBannerLines,
	};
	const { lines } = formatTranscriptChildren([comp as any], 80);
	assert.ok(lines.join("\n").includes("N e k o - p i"));
	assert.ok(lines.join("\n").includes("\u001b[48;2;23;29;31m"));
});

test("formatToolCallCard and formatFilePreview helper functions", () => {
	const floatLines = [
		" ▎ ☷ ls /tmp               ctrl+o to expand ",
		" ▎ fileA.txt ",
		" ▎ fileB.txt ",
	];

	const card = formatToolCallCard(floatLines, "ls", mockTheme, 60);
	assert.ok(card[0].includes("ls"));
	assert.ok(!card[1].includes("▎"));

	const preview = formatFilePreview(floatLines, "fileA.txt", mockTheme);
	assert.ok(!preview[0].includes("▎"));
});

test("unwrapNativeCard - memoization returns cached reference for identical array", () => {
	const raw = [
		" ▎ $ ls ",
		" ▎ file1.txt ",
	];
	const first = unwrapNativeCard(raw);
	const second = unwrapNativeCard(raw);
	assert.equal(first, second, "Repeated unwrapping of the same array must return identical memoized reference");
});

