import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cuteGlyphs, resetCuteGlyphsCache, PETAL_PRESETS, unifyCardFrame, unifySidebarCardFrame, transformTranscriptLines, formatGentleAiCardLine, installWelcomeHeaderGuard, safeFg } from "../src/cute-theme.ts";
import { frameCategoryBox, formatTranscriptChild, formatTranscriptChildren, isBashComponent, isReadComponent, isWriteComponent, isErrorTextComponent, looksLikeErrorLines, formatBashOutputLines, formatBashCommandHeader, highlightCodeLine, formatWriteDiffLines, formatReadLines, toolFileHighlightable, toolFilePath, extractBashDisplayPath, extractHeredoc, hasKeptColor } from "../src/cute-transcript.ts";
import { loadCuteStrings, resetCuteStringsCache, detectSystemUser } from "../src/cute-strings.ts";
import { isHerdrSession, loadCuteLayout, resetCuteLayoutCache, resolveEdgeInsets, tuneTuiScroll } from "../src/cute-layout.ts";
import { loadCutePaths, resetCutePathsCache } from "../src/cute-paths.ts";
import { loadCuteColors, resetCuteColorsCache } from "../src/cute-colors.ts";

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
	assert.deepEqual(PETAL_PRESETS.sparkles, ["✦", "✧", "★", "☆"]);
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

test("transformTranscriptLines - adapts Gentle AI cards with tulip to double-line mint green frame and robot", () => {
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
	assert.ok(transformed[1].includes("[gentle]"));

	assert.ok(transformed[2].includes("║"));
	assert.ok(transformed[2].includes("2 lines"));
	assert.ok(transformed[2].includes("[gentle]"));

	assert.ok(transformed[3].includes("╚"));
	assert.ok(transformed[3].includes("═"));
	assert.ok(transformed[3].includes("╝"));
	assert.ok(transformed[3].includes("[gentle]"));
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
	assert.ok(transformed.includes("[gentle]"));
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

	// 2. Assistant Message renders naturally without extra bounding box
	class AssistantMessageComponent {
		render() { return ["# Title", "Explicación del asistente"]; }
	}
	const asstRender = formatTranscriptChild(new AssistantMessageComponent() as any, 60, mockTheme);
	assert.equal(asstRender[0], "# Title");
	assert.equal(asstRender[1], "Explicación del asistente");

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

	// 5. Gentle AI Tool Call Card adapts to double lines, robot glyph and mint green
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
	assert.ok(toolRender[0].includes("[gentle]"));
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
		assert.equal(colors.gentleCardSuccess, "gentle");
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
		assert.equal(overridden.gentleCardSuccess, "gentle");
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

	assert.equal(mouseChildren.length, children.length, "All children must be mapped in mouseLayout");
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
	assert.equal(mouseChildren.length, children.length, "All children must be mapped in mouseLayout");
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

	const raw = [
		"edit src/cute-transcript.ts",
		"+258 const styled = format(x); // added",
		"-12 let old = 1;",
		" 254 const kept = true;",
		"ctrl+o to expand",
	];
	const styled = formatWriteDiffLines(raw, "src/cute-transcript.ts", mockTheme);

	// Header and hint lines pass through untouched
	assert.equal(styled[0], raw[0]);
	assert.equal(styled[4], raw[4]);

	// Added line: green prefix + highlighted code
	assert.ok(styled[1].includes("[toolDiffAdded]+258 [/toolDiffAdded]"));
	assert.ok(styled[1].includes("[syntaxKeyword]const[/syntaxKeyword]"));

	// Removed line: red prefix + highlighted code
	assert.ok(styled[2].includes("[toolDiffRemoved]-12 [/toolDiffRemoved]"));
	assert.ok(styled[2].includes("[syntaxKeyword]let[/syntaxKeyword]"));

	// Context line: muted prefix + highlighted code
	assert.ok(styled[3].includes("[toolDiffContext] 254 [/toolDiffContext]"));

	// Prose files and missing theme pass through untouched
	assert.deepEqual(formatWriteDiffLines(raw, "README.md", mockTheme), raw);
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

test("Syntax check across all source files", () => {
	const srcFiles = ["index.ts", "src/cute-theme.ts", "src/cute-strings.ts", "src/cute-layout.ts", "src/cute-paths.ts", "src/cute-colors.ts", "src/hud.ts", "src/footer.ts", "src/sidebar.ts", "src/welcome.ts", "src/editor.ts", "src/todos.ts", "src/cute-transcript.ts"];
	for (const f of srcFiles) {
		assert.ok(fs.existsSync(f), `File exists: ${f}`);
	}
});
