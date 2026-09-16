import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cuteGlyphs, resetCuteGlyphsCache, PETAL_PRESETS, unifyCardFrame, unifySidebarCardFrame, transformTranscriptLines, formatGentleAiCardLine, installWelcomeHeaderGuard, safeFg, bolden } from "../src/cute-theme.ts";
import { frameCategoryBox, formatTranscriptChild, formatAssistantProse, truncateAnsiAware, formatTranscriptChildren, isBashComponent, isReadComponent, isWriteComponent, isFetchComponent, looksLikeFetchLines, isSearchComponent, looksLikeSearchLines, isMemoryComponent, isGrepComponent, formatGrepLines, highlightUncoloredSegments, isErrorTextComponent, looksLikeErrorLines, formatBashOutputLines, formatBashCommandHeader, highlightCodeLine, formatWriteDiffLines, formatReadLines, toolFileHighlightable, toolFilePath, extractBashDisplayPath, extractHeredoc, hasKeptColor } from "../src/cute-transcript.ts";
import { loadCuteStrings, resetCuteStringsCache, detectSystemUser } from "../src/cute-strings.ts";
import { isHerdrSession, loadCuteLayout, resetCuteLayoutCache, resolveEdgeInsets, tuneTuiScroll } from "../src/cute-layout.ts";
import { loadCutePaths, resetCutePathsCache } from "../src/cute-paths.ts";
import { loadCuteColors, resetCuteColorsCache } from "../src/cute-colors.ts";
import { formatTokenCount, getContextThreshold } from "../src/cute-metrics.ts";

function resetAll() {
	resetCuteGlyphsCache();
	resetCuteStringsCache();
	resetCuteLayoutCache();
	resetCutePathsCache();
	resetCuteColorsCache();
}

const userConfigFile = path.join(os.homedir(), ".pi", "agent", "cute.json");

test("Theme Glyphs - default Double line and Petal frames", () => {
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		if (fs.existsSync(userConfigFile)) fs.unlinkSync(userConfigFile);
		resetAll();

		const glyphs = cuteGlyphs();
		assert.equal(glyphs.tl, "╔");
		assert.equal(glyphs.tr, "╗");
		assert.equal(glyphs.h, "═");
		assert.equal(glyphs.v, "║");
		assert.deepEqual(glyphs.petalFrames, ["✿", "❀", "❁", "✾"]);
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		}
		resetAll();
	}
});

test("Animation Presets - cats, sparkles, hearts, ascii", () => {
	assert.deepEqual(PETAL_PRESETS.cats, ["/•᷅•᷄\\੭", "/◕᷅◕᷄\\੭", "/˘᷅˘᷄\\੭", "/•᷅◕᷄\\੭"]);
	assert.deepEqual(PETAL_PRESETS.kittens, ["/×᷅×᷄\\੭", "/-᷅-᷄\\੭", "/^᷅^᷄\\੭", "/o᷅o᷄\\੭"]);
	assert.notDeepEqual(PETAL_PRESETS.kittens, PETAL_PRESETS.cats);
	assert.deepEqual(PETAL_PRESETS.sparkles, ["✦", "✧", "★", "☆"]);
	assert.deepEqual(PETAL_PRESETS.stars, ["✶", "✷", "✸", "✹"]);
	assert.notDeepEqual(PETAL_PRESETS.stars, PETAL_PRESETS.sparkles);
	assert.deepEqual(PETAL_PRESETS.hearts, ["♡", "♥", "ღ", "❦"]);
	assert.deepEqual(PETAL_PRESETS.ascii, ["*", "+", "o", "x"]);
});

test("Strings - defaults are Gentleman and developer", () => {
	resetAll();
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		if (fs.existsSync(userConfigFile)) fs.unlinkSync(userConfigFile);
		resetAll();

		const strings = loadCuteStrings();
		assert.equal(strings.welcomePersona.name, "el Gentleman");
		assert.equal(strings.welcomePersona.userRole, "desarrollador");
		assert.equal(strings.welcomePersona.userPronoun, "Tratalo");
		assert.equal(strings.welcomeTitles.persona, "el Gentleman");
		assert.equal(strings.welcomeTitles.dashboard, "Gentleman Welcome Dashboard");
		assert.ok(strings.welcomePersona.user.length > 0);
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		}
		resetAll();
	}
});

test("User Overrides - custom persona, user name and animation preset", () => {
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		fs.writeFileSync(
			userConfigFile,
			JSON.stringify({
				user: "Cinlo",
				persona: "gentlewoman",
				preset: "cats",
				layout: {
					sidebar: { railWidth: 54 },
				},
			}, null, 2),
			"utf8",
		);

		resetAll();

		const strings = loadCuteStrings();
		const glyphs = cuteGlyphs();
		const layout = loadCuteLayout();

		assert.equal(strings.welcomePersona.name, "la Gentlewoman");
		assert.equal(strings.welcomePersona.user, "Cinlo");
		assert.equal(strings.welcomePersona.userRole, "desarrolladora");
		assert.equal(strings.welcomePersona.userPronoun, "Tratala");
		assert.equal(strings.welcomeTitles.persona, "la Gentlewoman");
		assert.equal(strings.welcomeTitles.dashboard, "Gentlewoman Welcome Dashboard");

		assert.deepEqual(glyphs.petalFrames, ["/•᷅•᷄\\੭", "/◕᷅◕᷄\\੭", "/˘᷅˘᷄\\੭", "/•᷅◕᷄\\੭"]);
		assert.equal(glyphs.tl, "╔"); // untouched default preserved
		assert.equal(layout.sidebar.railWidth, 54);

		// Also test when cute.json contains BOTH root persona/user AND a nested "strings" block:
		fs.writeFileSync(
			userConfigFile,
			JSON.stringify({
				user: "Cinlo",
				persona: "gentlewoman",
				strings: {
					brandTitle: "✿ Cinlodev",
				},
			}, null, 2),
			"utf8",
		);
		resetAll();

		const stringsWithNested = loadCuteStrings();
		assert.equal(stringsWithNested.welcomePersona.name, "la Gentlewoman");
		assert.equal(stringsWithNested.welcomePersona.user, "Cinlo");
		assert.equal(stringsWithNested.welcomePersona.userRole, "desarrolladora");
		assert.equal(stringsWithNested.welcomePersona.userPronoun, "Tratala");
		assert.equal(stringsWithNested.brandTitle, "✿ Cinlodev");
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		} else if (fs.existsSync(userConfigFile)) {
			fs.unlinkSync(userConfigFile);
		}
		resetAll();
	}
});

test("User detection - detectSystemUser fallback and caching", () => {
	const user = detectSystemUser();
	assert.ok(typeof user === "string" && user.length > 0);
});

test("unifySidebarCardFrame - sidebar cards keep border tone and never turn green", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	// Changes card line with diff additions containing green ANSI (like +16019 -0)
	const changesTop = "\u001b[35m╭─\u001b[39m 🌸 Changes \u001b[35m───────────────────────╮\u001b[39m";
	const changesBody = "\u001b[35m│\u001b[39m 55 files · \u001b[32m+16019\u001b[39m \u001b[31m-0\u001b[39m                 \u001b[35m│\u001b[39m";
	const changesBottom = "\u001b[35m╰─────────────────────────────────────╯\u001b[39m";

	const topTransformed = unifySidebarCardFrame(changesTop, mockTheme);
	const bodyTransformed = unifySidebarCardFrame(changesBody, mockTheme);
	const bottomTransformed = unifySidebarCardFrame(changesBottom, mockTheme);

	// Must be double-line
	assert.ok(topTransformed.includes("╔═"));
	assert.ok(topTransformed.includes("╗"));
	assert.ok(bodyTransformed.includes("║"));
	assert.ok(bottomTransformed.includes("╚═"));
	assert.ok(bottomTransformed.includes("╝"));

	// Frame must be in [border] tone, NOT [success]
	assert.ok(topTransformed.includes("[border]"));
	assert.ok(!topTransformed.includes("[success]"));
	assert.ok(bottomTransformed.includes("[border]"));
	assert.ok(!bottomTransformed.includes("[success]"));
});

test("transformTranscriptLines - adapts Gentle AI cards with tulip to double-line green frame and robot", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const transcriptLines = [
		"$ git status",
		"\u001b[32m╭\u001b[39m\u001b[35m─\u001b[39m 🌷 Gentle AI · completed · command \u001b[35m──────────────────\u001b[39m ctrl+o to expand \u001b[35m╮\u001b[39m",
		"\u001b[32m│\u001b[39m 2 lines                                                                          \u001b[35m│\u001b[39m",
		"\u001b[32m╰\u001b[39m\u001b[35m─────────────────────────────────────────────────────────────────────────────────╯\u001b[39m",
		"$ next command",
	];

	const transformed = transformTranscriptLines(transcriptLines, mockTheme);

	// Non-card lines must be untouched
	assert.equal(transformed[0], "$ git status");
	assert.equal(transformed[4], "$ next command");

	// Card lines transformed
	assert.ok(transformed[1].includes("🤖 Gentle AI"));
	assert.ok(!transformed[1].includes("🌷"));
	assert.ok(transformed[1].includes("╔"));
	assert.ok(transformed[1].includes("═"));
	assert.ok(transformed[1].includes("╗"));
	assert.ok(transformed[1].includes("[success]"));

	assert.ok(transformed[2].includes("║"));
	assert.ok(transformed[2].includes("2 lines"));
	assert.ok(transformed[2].includes("[success]"));

	assert.ok(transformed[3].includes("╚"));
	assert.ok(transformed[3].includes("═"));
	assert.ok(transformed[3].includes("╝"));
	assert.ok(transformed[3].includes("[success]"));
});

test("transformTranscriptLines - adapts Gentle AI warning card (dev binary) to double-line yellow frame and robot", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const warningLines = [
		"\u001b[33m╭─\u001b[39m ✿ Gentle AI · dev binary override · field-test only \u001b[35m──────────────────╮\u001b[39m",
		"\u001b[33m│\u001b[39m /home/cinlodev/go/bin/gentle-ai · sha256:882bfd7a9d5c16f1              \u001b[35m│\u001b[39m",
		"\u001b[33m╰\u001b[39m\u001b[35m────────────────────────────────────────────────────────────────────────╯\u001b[39m",
		"",
	];

	const transformed = transformTranscriptLines(warningLines, mockTheme);

	// Card lines transformed
	assert.ok(transformed[0].includes("🤖 Gentle AI"));
	assert.ok(!transformed[0].includes("✿"));
	assert.ok(transformed[0].includes("╔"));
	assert.ok(transformed[0].includes("═"));
	assert.ok(transformed[0].includes("╗"));
	assert.ok(transformed[0].includes("[warning]"));

	assert.ok(transformed[1].includes("║"));
	assert.ok(transformed[1].includes("/home/cinlodev/go/bin/gentle-ai"));
	assert.ok(transformed[1].includes("[warning]"));

	assert.ok(transformed[2].includes("╚"));
	assert.ok(transformed[2].includes("═"));
	assert.ok(transformed[2].includes("╝"));
	assert.ok(transformed[2].includes("[warning]"));

	assert.equal(transformed[3], "");
});

test("unifyCardFrame - adapts Gentle AI cards to double-line frame and robot glyph", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	const input = "\u001b[32m╭\u001b[39m\u001b[35m─\u001b[39m 🌹︎ Gentle AI · completed · command \u001b[35m──\u001b[39m ctrl+o \u001b[35m╮\u001b[39m";
	const transformed = unifyCardFrame(input, mockTheme);

	assert.ok(transformed.includes("🤖 Gentle AI"));
	assert.ok(!transformed.includes("🌹"));
	assert.ok(transformed.includes("╔"));
	assert.ok(transformed.includes("╗"));
	assert.ok(transformed.includes("[success]"));
});

test("frameCategoryBox - exact width and double-line framing", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const content = ["line 1", "line 2 with some text"];
	const framed = frameCategoryBox(content, "Test Box", "heading", 50, mockTheme);

	assert.equal(framed.length, 4); // top, line 1, line 2, bottom
	assert.ok(framed[0].includes("╔═"));
	assert.ok(framed[0].includes("Test Box"));
	assert.ok(framed[0].includes("╗"));
	assert.ok(framed[0].includes("[heading]"));

	assert.ok(framed[1].includes("║"));
	assert.ok(framed[1].includes("line 1"));
	assert.ok(framed[2].includes("║"));
	assert.ok(framed[2].includes("line 2 with some text"));

	assert.ok(framed[3].includes("╚═"));
	assert.ok(framed[3].includes("╝"));
});

test("formatTranscriptChild - frames user messages in CUTE golden box and leaves others natural", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	// 1. User Message (Dorado / heading con ❀)
	class UserMessageComponent {
		render() { return ["echo hello from user"]; }
	}
	const userFramed = formatTranscriptChild(new UserMessageComponent() as any, 60, mockTheme);
	assert.ok(userFramed[0].includes("[heading]"));
	assert.ok(userFramed[0].includes("❀"));
	assert.ok(userFramed[1].includes("echo hello from user"));
	assert.ok(userFramed[2].includes("╚"));

	// 2. Assistant Message renders naturally, headings slightly bolder and text Dracula highlighted
	class AssistantMessageComponent {
		render() { return ["# Title", "Explicación del asistente"]; }
	}
	const asstRender = formatTranscriptChild(new AssistantMessageComponent() as any, 60, mockTheme);
	assert.ok(asstRender[0].includes("\x1b[1m"), "markdown heading gets bolder typeface");
	assert.ok(asstRender[0].includes("# Title"));
	assert.ok(asstRender[1].includes("ón del asistente"), "assistant prose body passes through with Dracula syntax");

	// 3. Bash Execution renders in sunset orange card with >_ bash
	class BashExecutionComponent {
		render() { return ["$ npm test", "# pass 10"]; }
	}
	// Wide width: mock syntax tags ([syntaxKeyword]...) count as visible chars,
	// with real ANSI themes they are zero-width escapes.
	const bashRender = formatTranscriptChild(new BashExecutionComponent() as any, 100, mockTheme);
	assert.ok(bashRender[0].includes("╔═ >_ bash"));
	assert.ok(bashRender[1].includes("[bashMode]$ [/bashMode]"));
	assert.ok(bashRender[1].includes("npm test"));
	// Inside content is Dracula now (number highlighted), no terracotta wash
	assert.ok(bashRender[2].includes("pass"));
	assert.ok(bashRender[2].includes("[syntaxNumber]10[/syntaxNumber]"));
	assert.ok(!bashRender[2].includes("[bashOutput]"));
	assert.ok(bashRender[3].includes("╚"));

	// 4. ToolExecutionComponent for bash renders in >_ bash card
	class ToolExecutionComponent {
		toolName = "bash";
		render() { return ["$ git status", "On branch develop"]; }
	}
	const toolBashRender = formatTranscriptChild(new ToolExecutionComponent() as any, 60, mockTheme);
	assert.ok(toolBashRender[0].includes("╔═ >_ bash"));
	assert.ok(toolBashRender[1].includes("[bashMode]$ [/bashMode]"));
	assert.ok(toolBashRender[1].includes("git status"));

	// 5. Gentle AI Tool Call Card adapts to double lines, robot glyph and success green
	class GentleAiToolComponent {
		render() {
			return [
				"╭─ 🌹 Gentle AI · completed · review start ─────────────────── ctrl+o to expand ╮",
				"│ 1 line                                                                       │",
				"╰──────────────────────────────────────────────────────────────────────────────╯",
			];
		}
	}
	const toolRender = formatTranscriptChild(new GentleAiToolComponent() as any, 80, mockTheme);
	assert.ok(toolRender[0].includes("🤖 Gentle AI"));
	assert.ok(!toolRender[0].includes("🌹"));
	assert.ok(toolRender[0].includes("╔"));
	assert.ok(toolRender[0].includes("═"));
	assert.ok(toolRender[0].includes("╗"));
	assert.ok(toolRender[0].includes("[success]"));
	assert.ok(toolRender[1].includes("║"));
	assert.ok(toolRender[2].includes("╚"));
	assert.ok(toolRender[2].includes("╝"));
});

test("Cute Colors - defaults and user overrides", () => {
	const originalContent = fs.existsSync(userConfigFile) ? fs.readFileSync(userConfigFile, "utf8") : null;
	try {
		if (fs.existsSync(userConfigFile)) fs.unlinkSync(userConfigFile);
		resetAll();

		const colors = loadCuteColors();
		assert.equal(colors.userMessage, "heading");
		assert.equal(colors.bashMessage, "bash");
		assert.equal(colors.fetchMessage, "pink");
		assert.equal(colors.searchMessage, "secondary");
		assert.equal(colors.memoryMessage, "salmon");
		assert.equal(colors.gentleCardSuccess, "success");
		assert.equal(colors.gentleCardWarning, "warning");
		assert.equal(colors.gentleCardError, "error");
		assert.equal(colors.readMessage, "read");
		assert.equal(colors.writeMessage, "write");
		assert.equal(colors.errorMessage, "error");
		assert.equal(colors.sidebarBorder, "border");

		// Test user override
		fs.writeFileSync(
			userConfigFile,
			JSON.stringify({
				colors: {
					userMessage: "accent",
					gentleCardWarning: "gold",
				},
			}),
			"utf8",
		);
		resetAll();

		const overridden = loadCuteColors();
		assert.equal(overridden.userMessage, "accent");
		assert.equal(overridden.gentleCardWarning, "gold");
		assert.equal(overridden.gentleCardSuccess, "success");
	} finally {
		if (originalContent !== null) {
			fs.writeFileSync(userConfigFile, originalContent, "utf8");
		} else if (fs.existsSync(userConfigFile)) {
			fs.unlinkSync(userConfigFile);
		}
		resetAll();
	}
});

test("installWelcomeHeaderGuard - protects Welcome Dashboard against late foreign overwrites", () => {
	const mockTheme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	};
	let activeHeader: any = null;
	const mockCtx: any = {
		hasUI: true,
		mode: "tui",
		ui: {
			setHeader(factory: any) {
				activeHeader = factory;
			},
		},
	};

	let welcomeActive = true;
	installWelcomeHeaderGuard(mockCtx, () => welcomeActive);

	// 1. Own welcome header installs correctly
	const cuteFactory: any = () => ({ render: () => ["╔═ la Gentlewoman ═╗"] });
	cuteFactory.__isCuteWelcome = true;
	mockCtx.ui.setHeader(cuteFactory);
	assert.equal(activeHeader, cuteFactory);

	// 2. Foreign extension (e.g. gentle-pi startup-banner deferred setTimeout) tries to overwrite
	const foreignBannerFactory: any = () => ({ render: () => ["GIT: main", "MCP: 3"] });
	mockCtx.ui.setHeader(foreignBannerFactory);

	// Active header MUST remain the cute factory, foreign overwrite is blocked!
	assert.equal(activeHeader, cuteFactory, "Foreign overwrite must be blocked while Welcome Dashboard is active");

	// 3. User disables welcome (/welcome off) -> header is cleared
	welcomeActive = false;
	mockCtx.ui.setHeader(undefined);
	assert.equal(activeHeader, undefined, "Header should be cleared when welcome is toggled off");

	// 4. Foreign extension sets header while welcome is disabled -> passes and is adapted
	mockCtx.ui.setHeader(foreignBannerFactory);
	assert.ok(activeHeader !== null && activeHeader !== undefined);
	assert.ok(typeof activeHeader === "function");
	const rendered = activeHeader({}, mockTheme).render(40);
	assert.ok(Array.isArray(rendered));
});

test("formatTranscriptChildren - groups multiple consecutive bash executions into ONE single unified card", () => {
	const mockTheme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	};
	class BashExecutionComponent {
		cmd: string;
		out: string;
		constructor(cmd: string, out: string) {
			this.cmd = cmd;
			this.out = out;
		}
		render() { return [`$ ${this.cmd}`, this.out]; }
	}
	class ToolExecutionComponent {
		toolName: string;
		cmd: string;
		out: string;
		constructor(toolName: string, cmd: string, out: string) {
			this.toolName = toolName;
			this.cmd = cmd;
			this.out = out;
		}
		render() { return [`$ ${this.cmd}`, this.out]; }
	}
	class AssistantMessageComponent {
		render() { return ["Assistant says hi"]; }
	}

	const children: any[] = [
		new BashExecutionComponent("git status", "On branch develop"),
		new ToolExecutionComponent("bash", "git diff", "diff output"),
		new BashExecutionComponent("npm test", "✔ all tests pass"),
		new AssistantMessageComponent(),
		new ToolExecutionComponent("bash", "echo done", "done!"),
	];

	const { lines, mouseChildren } = formatTranscriptChildren(children, 70, mockTheme);

	// The first 3 consecutive bash commands MUST be merged into ONE single card!
	// That card starts with ╔═ >_ bash and ends with ╚════
	const firstCardStart = lines.findIndex((l) => l.includes("╔═ >_ bash"));
	assert.ok(firstCardStart !== -1, "First bash card must start");
	const firstCardEnd = lines.findIndex((l, idx) => idx > firstCardStart && l.includes("╚═"));
	assert.ok(firstCardEnd !== -1, "First bash card must close");

	const cardSlice = lines.slice(firstCardStart, firstCardEnd + 1).join("\n");
	assert.ok(cardSlice.includes("$ git status"), "Contains first bash command");
	assert.ok(cardSlice.includes("$ git diff"), "Contains second bash command");
	assert.ok(cardSlice.includes("$ npm test"), "Contains third bash command");

	// There should NOT be 3 separate bash cards for the first 3 commands!
	const allCardHeaders = lines.filter((l) => l.includes("╔═ >_ bash"));
	assert.equal(allCardHeaders.length, 2, "Exactly 2 bash cards total: 1 for the first 3 grouped commands, 1 for the trailing command");

	assert.ok(mouseChildren.length >= children.length, "All children must be mapped in mouseLayout with spacers");
});

test("tuneTuiScroll - accelerates slow mouse wheel scroll", () => {
	resetAll();
	const mockTui = {
		wheelScrollLines: 1, // Pi default
	};
	tuneTuiScroll(mockTui);
	assert.equal(mockTui.wheelScrollLines, 3, "Default wheel scroll lines should be tuned to 3");

	// Ignores non-tui or missing wheelScrollLines gracefully
	tuneTuiScroll(null);
	tuneTuiScroll({});
});

test("formatBashOutputLines - command header Dracula with pink $, output Dracula", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const rawLines = [
		"\x1b[38;2;240;149;200m$ cat ~/.pi/agent/settings.json\x1b[39m",
		'  "defaultModel": "kimi-k2.6",',
		'  "defaultProvider": "opencode-go",',
	];

	const formatted = formatBashOutputLines(rawLines, mockTheme, "bashOutput");
	// 1. `$` stays pink, command gets Dracula highlighting (no keyword here, so plain rest)
	assert.ok(formatted[0].startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(formatted[0].includes("cat ~/.pi/agent/settings.json"));
	assert.ok(!formatted[0].includes("240;149;200m$ cat"));
	// 2. `cat` of a highlightable file (json) gets Dracula highlighting, not terracotta
	assert.ok(formatted[1].includes("[syntaxString]"));
	assert.ok(formatted[1].includes('"defaultModel"'));
	assert.ok(!formatted[1].includes("[bashOutput]"));

	// 3. safeFg handles direct hex color codes
	const hexColored = safeFg(mockTheme, "#db8c65", "hello");
	assert.ok(hexColored.includes("\x1b[38;2;219;140;101mhello\x1b[39m"));
});

test("formatTranscriptChild - frames read in lilac, write/edit in light blue, errors in coral", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	// 1. Read tool execution renders in lilac card
	class ReadToolComponent {
		toolName = "read";
		render() { return ["read /tmp/file.txt", "line 1 content"]; }
	}
	assert.ok(isReadComponent(new ReadToolComponent() as any));
	const readRender = formatTranscriptChild(new ReadToolComponent() as any, 60, mockTheme);
	assert.ok(readRender[0].includes("[read]"));
	assert.ok(readRender[0].includes("read"));
	assert.ok(readRender[1].includes("read /tmp/file.txt"));

	// 2. Write tool execution renders in light-blue card
	class WriteToolComponent {
		toolName = "write";
		render() { return ["write /tmp/file.txt", "wrote 10 lines"]; }
	}
	assert.ok(isWriteComponent(new WriteToolComponent() as any));
	const writeRender = formatTranscriptChild(new WriteToolComponent() as any, 60, mockTheme);
	assert.ok(writeRender[0].includes("[write]"));
	assert.ok(writeRender[1].includes("write /tmp/file.txt"));

	// 3. Edit counts as write (same celeste card)
	class EditToolComponent {
		toolName = "edit";
		render() { return ["edit /tmp/file.txt", "+1 -0"]; }
	}
	assert.ok(isWriteComponent(new EditToolComponent() as any));
	assert.ok(!isReadComponent(new EditToolComponent() as any));
	const editRender = formatTranscriptChild(new EditToolComponent() as any, 60, mockTheme);
	assert.ok(editRender[0].includes("[write]"));

	// 4. Bash is neither read nor write
	class BashToolComponent {
		toolName = "bash";
		render() { return ["$ echo hi"]; }
	}
	assert.ok(!isReadComponent(new BashToolComponent() as any));
	assert.ok(!isWriteComponent(new BashToolComponent() as any));

	// 5. Top-level error Text renders in coral card
	class Text {
		render() { return ["Error: 503: auth_unavailable: no auth available"]; }
	}
	const errLines = ["Error: 503: auth_unavailable: no auth available"];
	assert.ok(looksLikeErrorLines(errLines));
	assert.ok(isErrorTextComponent(new Text() as any, errLines));
	const errRender = formatTranscriptChild(new Text() as any, 70, mockTheme);
	assert.ok(errRender[0].includes("[error]"));
	assert.ok(errRender[0].includes("error"));
	assert.ok(errRender.slice(1, -1).join("\n").includes("Error: 503"));

	// 6. Normal Text mentioning errors casually stays natural
	class PlainText {
		render() { return ["some note about error handling in docs"]; }
	}
	// NOTE: class name here is PlainText, not Text, so it stays natural.
	const plainRender = formatTranscriptChild(new PlainText() as any, 70, mockTheme);
	assert.equal(plainRender[0], "some note about error handling in docs");
});

test("isGrepComponent - matches grep tool executions only", () => {
	assert.ok(isGrepComponent({ toolName: "grep" } as any));
	assert.equal(isGrepComponent({ toolName: "read" } as any), false);
	assert.equal(isGrepComponent({ toolName: "bash" } as any), false);
	assert.equal(isGrepComponent(null as any), false);
});

test("formatGrepLines - highlights paths, line numbers, and code without extra card bounding box", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	const lines = [
		"grep /user_has_org_access/ in src/",
		"src/schema.sql:106: CREATE FUNCTION get_user()",
		"src/schema.sql:107- const x = 42;",
		"... (5 more lines, to expand)",
	];
	const formatted = formatGrepLines(lines, mockTheme);
	assert.equal(formatted[0], lines[0], "header passes untouched");
	assert.ok(formatted[1].includes("[read]src/schema.sql[/read]"), "path styled in lilac/read");
	assert.ok(formatted[1].includes("[syntaxNumber]106[/syntaxNumber]"), "line number styled in number gold");
	assert.ok(formatted[1].includes("[syntaxType]CREATE[/syntaxType]"), "SQL keywords styled Dracula");
	assert.ok(formatted[2].includes("[syntaxNumber]107[/syntaxNumber]"), "dash context line number styled");
	assert.equal(formatted[3], lines[3], "hint line passes untouched");
});

test("formatAssistantProse - Dracula highlighting on prose, bold headings, colored and fenced lines intact", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	const colored = "\x1b[35mcolored link line\x1b[39m";
	const out = formatAssistantProse([
		'plain prose with "quoted string" and 42 items',
		"",
		"### Heading",
		colored,
		"```python",
		"plain code line",
		"```",
	], mockTheme);
	assert.ok(out[0].includes('[syntaxString]"quoted string"[/syntaxString]'), "quotes get Dracula green");
	assert.ok(out[0].includes("[syntaxNumber]42[/syntaxNumber]"), "numbers get Dracula orange");
	assert.ok(out.some((l) => l.includes("[pinkMuted]")), "horizontal pink divider inserted before heading");
	assert.ok(out.some((l) => l.includes("\x1b[1m") && l.includes("### Heading")));
	assert.ok(out.includes(colored), "already-colored lines untouched");
	assert.ok(out.includes("```python"));
	assert.ok(out.includes("plain code line"), "fenced code untouched");
	assert.ok(out.includes("```"));
	assert.deepEqual(formatAssistantProse([], mockTheme), []);
});

test("highlightUncoloredSegments - keeps OSC 133 and APC sequences atomic without corruption", () => {
	const mockHighlight = (t: string) => `[${t}]`;
	const OSC133_ZONE_END = "\x1b]133;B\x07";
	const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
	const line = OSC133_ZONE_END + OSC133_ZONE_FINAL + "¿Me los pasás?";

	const out = highlightUncoloredSegments(line, mockHighlight);
	// Both OSC sequences must survive completely intact (never parsed as text or 133;C leaking)
	assert.ok(out.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL), "OSC 133 markers must remain atomic at start");
	assert.ok(out.includes("[¿Me los pasás?]"), "text after OSC markers must be highlighted");
	assert.ok(!out.includes("133;C]"), "133;C must never be treated as visible plain text");
});

test("isMemoryComponent - matches mem_ tools only", () => {
	assert.ok(isMemoryComponent({ toolName: "mem_search" } as any));
	assert.ok(isMemoryComponent({ toolName: "mem_timeline" } as any));
	assert.ok(isMemoryComponent({ toolName: "mem_doctor" } as any));
	assert.equal(isMemoryComponent({ toolName: "fetch_content" } as any), false);
	assert.equal(isMemoryComponent({ toolName: "web_search" } as any), false);
	assert.equal(isMemoryComponent({ toolName: "read" } as any), false);
	assert.equal(isMemoryComponent({ render: () => ["some memory note"] } as any), false);
	assert.equal(isMemoryComponent(null as any), false);
});

test("formatTranscriptChildren - groups consecutive memory calls into ONE single salmon card", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	class MemTool {
		toolName: string;
		msg: string;
		constructor(toolName: string, msg: string) { this.toolName = toolName; this.msg = msg; }
		render() { return [this.msg]; }
	}
	class AssistantMessageComponent {
		render() { return ["plain prose stays free"]; }
	}
	const children: any[] = [
		new MemTool("mem_search", "search supabase..."),
		new MemTool("mem_timeline", "timeline #1624"),
		new AssistantMessageComponent(),
		new MemTool("mem_doctor", "doctor ok"),
	];
	const { lines, mouseChildren } = formatTranscriptChildren(children, 70, mockTheme);
	const headers = lines.filter((l) => l.includes("engram"));
	assert.equal(headers.length, 2, "2 salmon engram cards: 1 grouped (2 calls) + 1 single");
	assert.ok(headers[0].includes("[salmon]"));
	const cardSlice = lines.join("\n");
	assert.ok(cardSlice.includes("search supabase..."));
	assert.ok(cardSlice.includes("timeline #") && cardSlice.includes("[syntaxNumber]1624[/syntaxNumber]"));
	assert.ok(cardSlice.includes("plain prose stays free"));
	assert.ok(mouseChildren.length >= children.length, "All children must be mapped in mouseLayout with spacers");
});

test("transformTranscriptLines - bolds markdown headings, leaves code fences alone", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	assert.ok(bolden(mockTheme, "hi").includes("\x1b[1m"));
	const out = transformTranscriptLines([
		"### 1. Supabase en Engram",
		"plain prose",
		"```python",
		"# comment inside fence stays plain",
		"```",
	], mockTheme);
	assert.ok(out[0].includes("\x1b[1m"), "heading gets bolder typeface");
	assert.ok(out[0].includes("### 1. Supabase en Engram"), "heading text intact");
	assert.equal(out[1], "plain prose");
	assert.equal(out[2], "```python");
	assert.equal(out[3], "# comment inside fence stays plain", "no bold inside fences");
	assert.equal(out[4], "```");
});

test("isSearchComponent - matches web_search, search alias and search headers, nothing else", () => {
	// pi-web-access registers `web_search` by default (renders `search ...`)
	assert.ok(isSearchComponent({ toolName: "web_search" } as any));
	assert.ok(isSearchComponent({ toolName: "search" } as any));
	// Renamed tools keep rendering the `search ...` header: sniffed fallback
	assert.ok(isSearchComponent({ toolName: "buscar", render: () => ["search 2 queries"] } as any));
	assert.ok(looksLikeSearchLines(["", "  search \"ghcr.io supabase...\""]));
	// fetch_content, read and plain messages mentioning search stay out
	assert.equal(isSearchComponent({ toolName: "fetch_content" } as any), false);
	assert.equal(isSearchComponent({ toolName: "read" } as any), false);
	assert.equal(isSearchComponent({ render: () => ["let me search the docs for you"] } as any), false);
	assert.equal(looksLikeSearchLines(["fetch https://example.com/a"]), false);
	assert.equal(looksLikeSearchLines([]), false);
});

test("formatTranscriptChild - frames web_search in dusty-rose card", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	class WebSearchToolComponent {
		toolName = "web_search";
		render() { return ['search 2 queries', '2/2 queries, 10 sources']; }
	}
	const framed = formatTranscriptChild(new WebSearchToolComponent() as any, 60, mockTheme);
	assert.ok(framed[0].includes("[secondary]"));
	assert.ok(framed[0].includes("search"));
	assert.ok(framed[1].includes("search 2 queries"));
	assert.ok(framed[framed.length - 1].includes("╚"));
});

test("isFetchComponent - matches fetch_content, fetch alias and fetch headers, nothing else", () => {
	// pi-web-access registers `fetch_content` by default (renders `fetch <url>`)
	assert.ok(isFetchComponent({ toolName: "fetch_content" } as any));
	assert.ok(isFetchComponent({ toolName: "fetch" } as any));
	// Renamed tools keep rendering the `fetch <url>` header: sniffed fallback
	assert.ok(isFetchComponent({ toolName: "descargar", render: () => ["fetch https://example.com/a"] } as any));
	assert.ok(looksLikeFetchLines(["", "  fetch https://example.com/a ..."]));
	// web_search, read and plain messages mentioning fetch stay out
	assert.equal(isFetchComponent({ toolName: "web_search" } as any), false);
	assert.equal(isFetchComponent({ toolName: "read" } as any), false);
	assert.equal(isFetchComponent({ render: () => ["let me fetch the docs for you"] } as any), false);
	assert.equal(looksLikeFetchLines(["search 2 queries"]), false);
	assert.equal(looksLikeFetchLines([]), false);
});

test("formatTranscriptChild - frames fetch_content in pink card with dark background intact", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	class FetchContentToolComponent {
		toolName = "fetch_content";
		render() { return ["fetch https://example.com/docs", "mode: raw", '{"ok":true}']; }
	}
	const framed = formatTranscriptChild(new FetchContentToolComponent() as any, 60, mockTheme);
	assert.ok(framed[0].includes("[pink]"));
	assert.ok(framed[0].includes("fetch"));
	assert.ok(framed[1].includes("fetch https://example.com/docs"));
	assert.ok(framed[framed.length - 1].includes("╚"));
});

test("formatTranscriptChildren - groups consecutive errors into ONE single coral card", () => {
	const mockTheme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
	};
	class Text {
		msg: string;
		constructor(msg: string) { this.msg = msg; }
		render() { return [this.msg]; }
	}
	class Spacer {
		render() { return [""]; }
	}
	const children: any[] = [
		new Text("Error: 503: auth_unavailable (1)"),
		new Spacer(),
		new Text("Error: 503: auth_unavailable (2)"),
		new Text("Error: Retry failed after 3 attempts: 503"),
	];

	const { lines, mouseChildren } = formatTranscriptChildren(children, 70, mockTheme);
	const headers = lines.filter((l) => l.includes("\u26A0 error"));
	assert.equal(headers.length, 1, "Exactly 1 coral error card for the grouped errors");
	const cardSlice = lines.join("\n");
	assert.ok(cardSlice.includes("auth_unavailable (1)"));
	assert.ok(cardSlice.includes("auth_unavailable (2)"));
	assert.ok(cardSlice.includes("Retry failed after 3 attempts"));
	assert.ok(mouseChildren.length >= children.length, "All children must be mapped in mouseLayout with spacers");
});

test("highlightCodeLine - Dracula-style tokens via theme syntax roles", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const line = `const styled = format("hi"); // comment 42`;
	const out = highlightCodeLine(line, mockTheme);
	assert.ok(out.includes("[syntaxKeyword]const[/syntaxKeyword]"));
	assert.ok(out.includes("[syntaxFunction]format[/syntaxFunction]"));
	assert.ok(out.includes('[syntaxString]"hi"[/syntaxString]'));
	assert.ok(out.includes("[syntaxComment]// comment 42[/syntaxComment]"));

	// Plain code without theme passes through untouched
	assert.equal(highlightCodeLine(line), line);
	assert.equal(highlightCodeLine("", mockTheme), "");

	// Capitalized identifiers get the type (gold) tone
	const typed = highlightCodeLine("class Foo extends Container", mockTheme);
	assert.ok(typed.includes("[syntaxType]Foo[/syntaxType]"));
	assert.ok(typed.includes("[syntaxType]Container[/syntaxType]"));
});

test("formatWriteDiffLines - highlights diff code, keeps diff tones and headers", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	assert.ok(toolFileHighlightable("src/cute-transcript.ts"));
	assert.ok(!toolFileHighlightable("README.md"));
	assert.ok(!toolFileHighlightable(undefined));
	assert.equal(toolFilePath({ args: { path: "src/a.ts" } } as any), "src/a.ts");
	assert.equal(toolFilePath({} as any), undefined);
	// Fallback detection from header line (tool without args object in component)
	assert.equal(toolFilePath({} as any, ["edit src/cute-theme.ts", "+1 -0"]), "src/cute-theme.ts");
	assert.equal(toolFilePath({} as any, ["✎ write src/hud.ts", "+1 -0"]), "src/hud.ts");
	assert.equal(toolFilePath({} as any, ["read package.json:1-10"]), "package.json");

	const raw = [
		"edit src/cute-transcript.ts",
		"✓ +2 / -2",
		"+258 const styled = format(x); // added",
		"-12 let old = 1;",
		" 254 const kept = true;",
		"ctrl+o to expand",
	];
	const styled = formatWriteDiffLines(raw, "src/cute-transcript.ts", mockTheme);

	// Header and hint lines pass through untouched
	assert.equal(styled[0], raw[0]);
	assert.ok(styled[1].includes("[toolDiffAdded]+2[/toolDiffAdded]"));
	assert.ok(styled[1].includes("[toolDiffRemoved]-2[/toolDiffRemoved]"));
	assert.equal(styled[5], raw[5]);

	// Added line: green prefix + highlighted code
	assert.ok(styled[2].includes("[toolDiffAdded]+258 [/toolDiffAdded]"));
	assert.ok(styled[2].includes("[syntaxKeyword]const[/syntaxKeyword]"));

	// Removed line: red prefix + highlighted code
	assert.ok(styled[3].includes("[toolDiffRemoved]-12 [/toolDiffRemoved]"));
	assert.ok(styled[3].includes("[syntaxKeyword]let[/syntaxKeyword]"));

	// Context line: muted prefix + highlighted code
	assert.ok(styled[4].includes("[toolDiffContext] 254 [/toolDiffContext]"));

	// Missing theme passes through untouched
	assert.deepEqual(formatWriteDiffLines(raw, "src/a.ts"), raw);
});


test("formatReadLines - highlights plain read code Dracula-style and preserves headers", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const raw = [
		"read src/cute-transcript.ts:50-119",
		"const x: number = 42;",
		"    return current;",
		"ctrl+o to expand",
	];
	const styled = formatReadLines(raw, "src/cute-transcript.ts", mockTheme);

	// Header and hint untouched
	assert.equal(styled[0], raw[0]);
	assert.equal(styled[3], raw[3]);

	// Code lines highlighted Dracula-style
	assert.ok(styled[1].includes("[syntaxKeyword]const[/syntaxKeyword]"));
	assert.ok(styled[2].includes("[syntaxKeyword]return[/syntaxKeyword]"));

	// Indentation preserved
	assert.ok(styled[2].startsWith("    "));
});


test("formatBashOutputLines - plain output uses Dracula, cat-of-code highlights", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	assert.equal(extractBashDisplayPath("$ cat src/a.ts"), "src/a.ts");
	assert.equal(extractBashDisplayPath("$ head -n 20 src/a.ts"), "src/a.ts");
	assert.equal(extractBashDisplayPath("$ cat 'my file.txt'"), "my file.txt");
	assert.equal(extractBashDisplayPath("$ git status"), undefined);
	assert.equal(extractBashDisplayPath("$ npm test"), undefined);
	assert.equal(extractBashDisplayPath("$ cat"), undefined);

	const rawLines = [
		"$ npm test",
		"pass 10",
		"$ cat src/a.ts",
		"const x = 1;",
	];
	const formatted = formatBashOutputLines(rawLines, mockTheme, "bashOutput");
	// Plain command output uses Dracula (number highlighted), no terracotta wash
	assert.ok(formatted[1].includes("[syntaxNumber]10[/syntaxNumber]"));
	assert.ok(!formatted[1].includes("[bashOutput]"));
	// Code dump output gets highlighted instead
	assert.ok(formatted[3].includes("[syntaxKeyword]const[/syntaxKeyword]"));
	assert.ok(!formatted[3].includes("[bashOutput]"));
});


test("extractHeredoc - detects interpreter heredocs and redirect targets", () => {
	const h1 = extractHeredoc("$ python3 - <<'EOF'");
	assert.equal(h1?.delimiter, "EOF");
	assert.equal(h1?.interpreter, "python3");

	const h2 = extractHeredoc("$ cat > src/a.ts <<'EOF'");
	assert.equal(h2?.delimiter, "EOF");
	assert.equal(h2?.target, "src/a.ts");

	assert.equal(extractHeredoc("$ git status"), undefined);
	assert.equal(extractHeredoc("$ npm test"), undefined);
});

test("hasKeptColor - pink echo and muted pass, green/red stay", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	// Bare command-echo pink (bashMode #F095C8) is NOT a kept color ...
	assert.equal(hasKeptColor("\x1b[38;2;240;149;200ms = open(p)\x1b[39m", mockTheme), false);
	// ... nor are plain / muted lines ...
	assert.equal(hasKeptColor("plain output", mockTheme), false);
	assert.equal(hasKeptColor("\x1b[38;2;167;142;155mmuted note\x1b[39m", mockTheme), false);
	// ... but diff green and error red are preserved.
	assert.equal(hasKeptColor("\x1b[32m+ added\x1b[39m", mockTheme), true);
	assert.equal(hasKeptColor("\x1b[38;2;255;113;143mError: boom\x1b[39m", mockTheme), true);
});

test("formatBashOutputLines - pink python heredoc body highlights Dracula-style", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	const pink = (t: string) => `\x1b[38;2;240;149;200m${t}\x1b[39m`;

	const rawLines = [
		pink("$ python3 - <<'EOF'"),
		pink("s = open(p)"),
		pink("const x = 1;"),
		pink("EOF"),
		"OK done",
	];
	const formatted = formatBashOutputLines(rawLines, mockTheme, "bashOutput");

	// Header gets Dracula on the command (`$` stays pink), terminator stays pink echo
	assert.ok(formatted[0].startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(formatted[0].includes("python3"));
	assert.equal(formatted[3], rawLines[3]);
	// Heredoc body is highlighted, not left pink (`open(` becomes a function token)
	assert.ok(formatted[1].includes("[syntaxFunction]open[/syntaxFunction]"));
	assert.ok(!formatted[1].includes("240;149;200"));
	assert.ok(formatted[2].includes("[syntaxKeyword]const[/syntaxKeyword]"));
	// Post-heredoc output uses Dracula too (type token), no terracotta wash
	assert.ok(formatted[4].includes("[syntaxType]OK[/syntaxType]"));
	assert.ok(!formatted[4].includes("[bashOutput]"));
});

test("formatBashCommandHeader - keeps $ pink and highlights command Dracula-style", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const out = formatBashCommandHeader("$ git fetch origin --prune", mockTheme);
	assert.ok(out.startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(out.includes("git fetch"));

	const kw = formatBashCommandHeader("$ const x = 1;", mockTheme);
	assert.ok(kw.includes("[syntaxKeyword]const[/syntaxKeyword]"));

	// No theme falls back to the original line
	assert.equal(formatBashCommandHeader("$ echo hi"), "$ echo hi");
	assert.equal(formatBashCommandHeader("$"), "$");
});

test("formatBashOutputLines - shell heredoc body highlights Dracula-style", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	const pink = (t: string) => `\x1b[38;2;240;149;200m${t}\x1b[39m`;

	const rawLines = [
		pink("$ bash <<'EOF'"),
		pink("const x = 1;"),
		pink("EOF"),
		"done",
	];
	const formatted = formatBashOutputLines(rawLines, mockTheme, "bashOutput");
	assert.ok(formatted[0].startsWith("[bashMode]$ [/bashMode]"));
	assert.ok(formatted[1].includes("[syntaxKeyword]const[/syntaxKeyword]"));
	assert.equal(formatted[2], rawLines[2]);
	// Trailing plain output stays Dracula-style plain (no terracotta wash)
	assert.equal(formatted[3], "done");
	assert.ok(!formatted[3].includes("[bashOutput]"));
});

test("terminal insets - herdr reserves edge columns, plain env stays full-bleed", () => {
	const base = { insetLeft: 0, insetRight: 0, herdrInsetLeft: 0, herdrInsetRight: 1 } as any;

	assert.equal(isHerdrSession({ HERDR_ENV: "1" }), true);
	assert.equal(isHerdrSession({ HERDR_PANE_ID: "w3:p1" }), true);
	assert.equal(isHerdrSession({}), false);

	// Inside Herdr the right column stays clear for its bar
	assert.deepEqual(resolveEdgeInsets(base, { HERDR_ENV: "1" }), { left: 0, right: 1 });
	// Outside Herdr everything renders full-bleed
	assert.deepEqual(resolveEdgeInsets(base, {}), { left: 0, right: 0 });
	// Manual insets always apply, negatives clamp to zero
	assert.deepEqual(
		resolveEdgeInsets({ insetLeft: 2, insetRight: 0, herdrInsetLeft: 0, herdrInsetRight: 0 } as any, {}),
		{ left: 2, right: 0 },
	);
	assert.deepEqual(
		resolveEdgeInsets({ insetLeft: -3, insetRight: -1, herdrInsetLeft: 0, herdrInsetRight: 0 } as any, {}),
		{ left: 0, right: 0 },
	);

	// Layout defaults carry the terminal section
	resetCuteLayoutCache();
	const layout = loadCuteLayout();
	assert.equal(layout.terminal.insetLeft, 0);
	assert.equal(layout.terminal.herdrInsetRight, 1);
});

test("truncateAnsiAware - never severs escapes and resets color on cut", () => {
	const pink = "\x1b[38;2;240;149;200mhello\x1b[39m";
	assert.equal(truncateAnsiAware(pink, 10), pink);
	assert.equal(truncateAnsiAware("plain", 10), "plain");

	const cut = truncateAnsiAware(pink, 3);
	assert.ok(!cut.endsWith("\x1b[38;2;240;149;200mhel".slice(-1)));
	assert.ok(cut.endsWith("\x1b[39m"), "reset appended so color cannot bleed");
	assert.ok(!cut.includes("\x1b[39m\x1b[39m"));

	const plainCut = truncateAnsiAware("abcdef", 3);
	assert.equal(plainCut, "abc");
	assert.ok(!plainCut.includes("\x1b"));
});

test("frameCategoryBox - colored long lines keep border and reset (image read repro)", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	const pink = (t: string) => `\x1b[38;2;240;149;200m${t}\x1b[39m`;
	const file = "read /tmp/pi-clipboard-93da2d4a-1bfc-4922-a0fe-e0f0c9e439e8.png";

	// Fits: content intact, original reset preserved, border in card tone
	const wide = frameCategoryBox([pink(file)], "✎ read", "read", 100, mockTheme);
	assert.ok(wide[1].includes(file));
	assert.ok(wide[1].includes("\x1b[39m"));
	assert.ok(wide[1].endsWith("[read]║[/read]"));

	// Overflows: clean cut with reset, border intact and never pink-bleed
	const narrow = frameCategoryBox([pink(file)], "✎ read", "read", 60, mockTheme);
	assert.ok(narrow[1].endsWith("[read]║[/read]"));
	assert.ok(narrow[1].includes("\x1b[39m"));
	assert.ok(!/\x1b\[38;2;240;149;200m[^\x1b]*\[read\]║/.test(narrow[1]));
});

test("truncateAnsiAware - kitty APC and OSC travel atomic, never counted", () => {
	const gfx = "_G1,a=T,f=100;AAAA\\";
	// Pure graphics + short text fits: untouched, no reset appended
	assert.equal(truncateAnsiAware(gfx + "Hi", 10), gfx + "Hi");
	// Long text after graphics: graphics preserved whole, text cut, reset appended
	const cut = truncateAnsiAware(gfx + "Read image file here", 4);
	assert.ok(cut.startsWith(gfx), "graphics sequence preserved whole");
	assert.ok(cut.endsWith("[39m"), "reset appended");
	assert.ok(cut.includes("Read"), "text budget honored");
	assert.ok(!cut.includes("here"), "overflow text cut");
});

test("frameCategoryBox - smuggled graphics escapes keep border intact", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;
	const gfx = "_G1,a=T,f=100;AAAA\\";
	const boxed = frameCategoryBox([gfx + "Read image file [image/png]"], "✎ read", "read", 60, mockTheme);
	assert.ok(boxed[1].startsWith("[read]║[/read]"), "left border intact");
	assert.ok(boxed[1].endsWith("[read]║[/read]"), "right border intact");
	assert.ok(boxed[1].includes(gfx), "graphics sequence not severed");
});

test("Syntax check across all source files", () => {
	const srcFiles = [
		"index.ts",
		"src/cute-theme.ts",
		"src/cute-strings.ts",
		"src/cute-layout.ts",
		"src/cute-paths.ts",
		"src/cute-colors.ts",
		"src/cute-metrics.ts",
		"src/hud.ts",
		"src/footer.ts",
		"src/sidebar.ts",
		"src/welcome.ts",
		"src/editor.ts",
		"src/todos.ts",
		"src/cute-transcript.ts"
	];
	for (const f of srcFiles) {
		assert.ok(fs.existsSync(f), `File exists: ${f}`);
	}
});

test("formatTokenCount - formats M, k, and plain counts cleanly", () => {
	assert.equal(formatTokenCount(1_000_000), "1.0M");
	assert.equal(formatTokenCount(2_500_000), "2.5M");
	assert.equal(formatTokenCount(10_000_000), "10M");
	assert.equal(formatTokenCount(128_000), "128k");
	assert.equal(formatTokenCount(24_520), "24.5k");
	assert.equal(formatTokenCount(4_400), "4.4k");
	assert.equal(formatTokenCount(850), "850");
	assert.equal(formatTokenCount(0), "0");
});

test("getContextThreshold - dynamic semáforo based on custom percent brackets", () => {
	const mockPalette = {
		mint: (s: string) => `[mint]${s}[/mint]`,
		gold: (s: string) => `[gold]${s}[/gold]`,
		orange: (s: string) => `[orange]${s}[/orange]`,
		coral: (s: string) => `[coral]${s}[/coral]`,
	} as any;

	// 0% to 39% -> Verde (Óptimo)
	const optimal0 = getContextThreshold(0, mockPalette);
	assert.equal(optimal0.label, "● Óptimo");
	assert.equal(optimal0.color("test"), "[mint]test[/mint]");

	const optimal39 = getContextThreshold(39.4, mockPalette);
	assert.equal(optimal39.label, "● Óptimo");
	assert.equal(optimal39.color("test"), "[mint]test[/mint]");

	// 39.5% rounds to 40% -> immediately turns Oro/Dorado (Medio)
	const roundedGold = getContextThreshold(39.5, mockPalette);
	assert.equal(roundedGold.label, "● Medio");
	assert.equal(roundedGold.color("test"), "[gold]test[/gold]");

	// 40% to 64% -> Oro/Dorado (Medio)
	const medium40 = getContextThreshold(40, mockPalette);
	assert.equal(medium40.label, "● Medio");
	assert.equal(medium40.color("test"), "[gold]test[/gold]");

	const medium64 = getContextThreshold(64.4, mockPalette);
	assert.equal(medium64.label, "● Medio");
	assert.equal(medium64.color("test"), "[gold]test[/gold]");

	// 64.5% rounds to 65% -> immediately turns Naranja (Alerta)
	const alert645 = getContextThreshold(64.5, mockPalette);
	assert.equal(alert645.label, "● Alerta");
	assert.equal(alert645.color("test"), "[orange]test[/orange]");

	// 65% to 79% -> Naranja (Alerta)
	const alert65 = getContextThreshold(65, mockPalette);
	assert.equal(alert65.label, "● Alerta");
	assert.equal(alert65.color("test"), "[orange]test[/orange]");

	const alert794 = getContextThreshold(79.4, mockPalette);
	assert.equal(alert794.label, "● Alerta");
	assert.equal(alert794.color("test"), "[orange]test[/orange]");

	// 79.5% rounds to 80% -> immediately turns Rojo/Coral (Crítico)
	const critical795 = getContextThreshold(79.5, mockPalette);
	assert.equal(critical795.label, "● Crítico");
	assert.equal(critical795.color("test"), "[coral]test[/coral]");

	// 80% to 100% -> Rojo/Coral (Crítico)
	const critical80 = getContextThreshold(80, mockPalette);
	assert.equal(critical80.label, "● Crítico");
	assert.equal(critical80.color("test"), "[coral]test[/coral]");

	const critical100 = getContextThreshold(100, mockPalette);
	assert.equal(critical100.label, "● Crítico");
	assert.equal(critical100.color("test"), "[coral]test[/coral]");
});
