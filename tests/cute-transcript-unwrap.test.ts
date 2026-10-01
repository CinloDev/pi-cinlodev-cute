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
} from "../src/cute-transcript.ts";

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

