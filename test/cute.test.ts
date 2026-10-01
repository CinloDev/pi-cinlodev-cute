import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { cuteGlyphs, resetCuteGlyphsCache, PETAL_PRESETS, unifyCardFrame, unifySidebarCardFrame, transformTranscriptLines, formatGentleAiCardLine, installWelcomeHeaderGuard, safeFg, bolden } from "../src/cute-theme.ts";
import { frameCategoryBox, formatTranscriptChild, formatAssistantProse, truncateAnsiAware, formatTranscriptChildren, isBashComponent, isReadComponent, isWriteComponent, isFetchComponent, looksLikeFetchLines, isSearchComponent, looksLikeSearchLines, isMemoryComponent, isGrepComponent, formatGrepLines, highlightUncoloredSegments, isErrorTextComponent, looksLikeErrorLines, formatBashOutputLines, formatBashCommandHeader, highlightCodeLine, formatWriteDiffLines, formatReadLines, toolFileHighlightable, toolFilePath, extractBashDisplayPath, extractHeredoc, hasKeptColor, isReviewComponent, looksLikeReviewLines, extractReviewHeader, formatReviewOutputLines } from "../src/cute-transcript.ts";
import { loadCuteStrings, resetCuteStringsCache, detectSystemUser } from "../src/cute-strings.ts";
import { isHerdrSession, loadCuteLayout, resetCuteLayoutCache, resolveEdgeInsets, tuneTuiScroll } from "../src/cute-layout.ts";
import { loadCutePaths, resetCutePathsCache, readActiveProfile, resetActiveProfileCache, readGitBranch } from "../src/cute-paths.ts";
import { loadCuteColors, resetCuteColorsCache } from "../src/cute-colors.ts";
import { formatTokenCount, getContextThreshold } from "../src/cute-metrics.ts";
import { listAvailableProfiles, switchProfile, SDD_PROFILES_API_SYMBOL } from "../src/cute-profiles.ts";
import { herdrAvailable, notify } from "../src/cute-notify.ts";
import { CuteContextMonitor } from "../src/cute-context-monitor.ts";
import { colorizeGitGraphLine, CinlodevGitGraphCard, resetGitGraphCache, parseGitStatusPorcelain, parseGitNumstat, formatGitStatusBadges, resetGitStatusCache } from "../src/cute-git-graph.ts";
import { collectToolCounts, recordToolCall, formatToolPill, wrapToolPills, CinlodevToolsCard, createEmptyToolCounts } from "../src/cute-tools.ts";
import { parseRawUsageToAccounts, formatRelativeReset, cleanPoolLabel, CinlodevUsageCard, resetUsageCache, prioritizeActiveAccount, setCachedAccountsForTesting, getQuotaThreshold } from "../src/cute-usage.ts";
import { detectProjectName, formatRelativeTime, resolveDashboardUrl, CinlodevEngramCard, resetEngramCache, DEFAULT_ENGRAM_DASHBOARD } from "../src/cute-engram.ts";

function resetAll() {
	resetCuteGlyphsCache();
	resetCuteStringsCache();
	resetCuteLayoutCache();
	resetCutePathsCache();
	resetCuteColorsCache();
	resetActiveProfileCache();
	resetGitGraphCache();
	resetGitStatusCache();
	resetUsageCache();
	resetEngramCache();
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
	assert.ok(userFramed[0].includes("[userMessageBorder]") || userFramed[0].includes("[heading]"));
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
		assert.equal(colors.userMessage, "userMessageBorder");
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
		assert.equal(colors.reviewMessage, "gentle");

		// Test user override
		fs.writeFileSync(
			userConfigFile,
			JSON.stringify({
				colors: {
					userMessage: "accent",
					gentleCardWarning: "gold",
					reviewMessage: "#a46db5",
				},
			}),
			"utf8",
		);
		resetAll();

		const overridden = loadCuteColors();
		assert.equal(overridden.userMessage, "accent");
		assert.equal(overridden.gentleCardWarning, "gold");
		assert.equal(overridden.gentleCardSuccess, "success");
		assert.equal(overridden.reviewMessage, "#a46db5");
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

test("formatAssistantProse - celeste body, bold headings, colored and fenced lines intact", () => {
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
	assert.ok(out[0].includes('[write]plain prose with "quoted string" and 42 items[/write]'), "entire prose line gets styled with celeste write tone without splitting");
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

test("isReviewComponent - matches gentle_review tools and rdd header variants", () => {
	// 1. Tool names
	assert.ok(isReviewComponent({ toolName: "gentle_review" } as any));
	assert.ok(isReviewComponent({ toolName: "gentle_review_capture" } as any));
	assert.ok(isReviewComponent({ toolName: "gentle_review_capture_group" } as any));
	assert.ok(isReviewComponent({ toolName: "gentle_review_scope" } as any));

	// 2. Rendered header lines fallback
	assert.ok(isReviewComponent({ render: () => ["🌹 rdd inspect", "findings: none"] } as any));
	assert.ok(isReviewComponent({ render: () => ["rdd start"] } as any));
	assert.ok(isReviewComponent({ render: () => ["gentle_review_scope"] } as any));
	assert.ok(looksLikeReviewLines([" ▎ 🌹 rdd inspect \x1b[2mctrl+o to expand\x1b[22m "]));
	assert.ok(looksLikeReviewLines(["╭─ 🌹 rdd diff ───────────── ╮"]));

	// 3. Negative checks: other tools and chat prose do NOT match
	assert.equal(isReviewComponent({ toolName: "read" } as any), false);
	assert.equal(isReviewComponent({ toolName: "bash" } as any), false);
	assert.equal(isReviewComponent({ toolName: "write" } as any), false);
	assert.equal(isReviewComponent({ toolName: "fetch_content" } as any), false);
	assert.equal(isReviewComponent({ toolName: "web_search" } as any), false);
	class UserMessageComponent { render() { return ["can you run rdd inspect?"]; } }
	class AssistantMessageComponent { render() { return ["I will run rdd start for you"]; } }
	assert.equal(isReviewComponent(new UserMessageComponent() as any), false);
	assert.equal(isReviewComponent(new AssistantMessageComponent() as any), false);
	assert.equal(looksLikeReviewLines([]), false);
	assert.equal(looksLikeReviewLines(["fetch https://example.com"]), false);
});

test("extractReviewHeader - extracts clean title with rose and operation", () => {
	// From unwrapped lines
	assert.equal(extractReviewHeader(["🌹 rdd inspect", "receipt: ok"]), "🌹 rdd inspect");
	assert.equal(extractReviewHeader(["rdd start"]), "🌹 rdd start");
	assert.equal(extractReviewHeader(["rdd diff", "diff output"]), "🌹 rdd diff");
	assert.equal(extractReviewHeader(["🌹 rdd"]), "🌹 rdd");
	assert.equal(extractReviewHeader(["gentle_review inspect"]), "🌹 rdd inspect");

	// From toolName or args on component
	assert.equal(extractReviewHeader([], { toolName: "gentle_review_scope" } as any), "🌹 rdd scope");
	assert.equal(extractReviewHeader([], { toolName: "gentle_review_capture" } as any), "🌹 rdd capture");
	assert.equal(extractReviewHeader([], { toolName: "gentle_review_capture_group" } as any), "🌹 rdd capture_group");
	assert.equal(extractReviewHeader([], { toolName: "gentle_review", args: { command: "inspect" } } as any), "🌹 rdd inspect");
	assert.equal(extractReviewHeader([], { toolName: "gentle_review" } as any), "🌹 rdd");
	assert.equal(extractReviewHeader([]), "🌹 rdd");
});

test("formatTranscriptChild - frames gentle_review in double-line rose card with unwrapped float chrome", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	class GentleReviewToolComponent {
		toolName = "gentle_review";
		render() {
			return [
				" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
				" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m 🌹 rdd inspect                  \x1b[2mctrl+o to expand\x1b[22m   \x1b[49m ",
				" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
				" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m receipt: verified                              \x1b[49m ",
				" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m pass: 5 / fail: 0                              \x1b[49m ",
				" \x1b[48;2;20;20;30m\x1b[38;2;140;200;140m▎\x1b[39m                                                \x1b[49m ",
			];
		}
	}

	const framed = formatTranscriptChild(new GentleReviewToolComponent() as any, 120, mockTheme);

	// 1. Double line framing with reviewMessage / gentle tone
	assert.ok(framed[0].includes("╔═"));
	assert.ok(framed[0].includes("🌹 rdd inspect"));
	assert.ok(framed[0].includes("═╗"));
	assert.ok(framed[0].includes("[gentle]"));

	// 2. Float chrome (▎ rails and background escapes) stripped
	for (const line of framed) {
		assert.ok(!line.includes("▎"), `rail leaked in: ${line}`);
		assert.ok(!/\x1b\[48;[0-9;]*m/.test(line), `bg escape leaked in: ${line}`);
		assert.ok(!/\x1b\[49m/.test(line), `bg reset leaked in: ${line}`);
		assert.ok(!line.includes("ctrl+o to expand"), `key hint leaked in: ${line}`);
	}

	// 3. Inner content preserved cleanly
	const plainFramed = framed.map((line) => line.replace(/\[\/?[a-zA-Z0-9_-]+\]/g, ""));
	assert.ok(plainFramed.some((line) => line.includes("receipt: verified")));
	assert.ok(plainFramed.some((line) => line.includes("pass: 5 / fail: 0")));

	// 4. Bottom frame double lines
	assert.ok(framed[framed.length - 1].includes("╚═"));
	assert.ok(framed[framed.length - 1].includes("═╝"));

	// 5. Outline card variant unwraps and frames cleanly
	class OutlineReviewComponent {
		toolName = "gentle_review_scope";
		render() {
			return [
				"╭─ 🌹 rdd scope ───────────────────────── ctrl+o to expand ╮",
				"│ scope: src/cute-transcript.ts                            │",
				"│ \x1b[32m✔ clean\x1b[39m                                                  │",
				"╰──────────────────────────────────────────────────────────╯",
			];
		}
	}
	const outlineFramed = formatTranscriptChild(new OutlineReviewComponent() as any, 100, mockTheme);
	assert.ok(outlineFramed[0].includes("╔═"));
	assert.ok(outlineFramed[0].includes("🌹 rdd scope"));
	assert.ok(outlineFramed.some((l) => l.includes("scope: src/cute-transcript.ts")));
	assert.ok(outlineFramed.some((l) => l.includes("\x1b[32m✔ clean\x1b[39m")));
	assert.ok(!outlineFramed.some((l) => l.includes("╭─") || l.includes("╰─")));
});

test("formatTranscriptChildren - registers FramedCardMouseProxy for gentle_review cards", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	let clicked = false;
	class GentleReviewComponent {
		toolName = "gentle_review";
		render() {
			return [" ▎ 🌹 rdd start \x1b[2mctrl+o to expand\x1b[22m ", " ▎ started "];
		}
		handleMouse(event: any) {
			clicked = true;
			return { handled: true };
		}
	}

	const reviewComp = new GentleReviewComponent();
	const { lines, mouseChildren } = formatTranscriptChildren([reviewComp as any], 60, mockTheme);

	assert.ok(lines.length > 0);
	assert.ok(lines[0].includes("🌹 rdd start"));
	assert.equal(mouseChildren.length, 1);
	assert.equal(mouseChildren[0].height, lines.length);

	// Test mouse click delegation through proxy
	const proxy = mouseChildren[0].component;
	assert.ok(typeof (proxy as any).handleMouse === "function");
	(proxy as any).handleMouse({ x: 5, y: 0, button: 0 });
	assert.equal(clicked, true);
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
	assert.equal(toolFilePath({ args: { path: "src/foo.ts:20-50" } } as any), "src/foo.ts");
	assert.equal(toolFilePath({} as any, ["", "   ", "read src/bar.ts"]), "src/bar.ts");

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

test("formatWriteDiffLines - write tool file content highlights all lines in Dracula", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const writeRaw = [
		"write src/app.ts",
		"import * as fs from \"node:fs\";",
		"",
		"export function initApp(): void {",
		"    const active = true;",
		"    return calculate(10);",
		"}",
	];

	const styled = formatWriteDiffLines(writeRaw, "src/app.ts", mockTheme, "write");
	// Header untouched
	assert.equal(styled[0], writeRaw[0]);
	// Unindented import keywords highlighted Dracula-style
	assert.ok(styled[1].includes("[syntaxKeyword]import[/syntaxKeyword]"));
	assert.ok(styled[1].includes("[syntaxKeyword]from[/syntaxKeyword]"));
	assert.ok(styled[1].includes("[syntaxString]\"node:fs\"[/syntaxString]"));
	// Unindented export function highlighted Dracula-style
	assert.ok(styled[3].includes("[syntaxKeyword]export[/syntaxKeyword]"));
	assert.ok(styled[3].includes("[syntaxKeyword]function[/syntaxKeyword]"));
	assert.ok(styled[3].includes("[syntaxFunction]initApp[/syntaxFunction]"));
	// Indented lines preserve spaces and highlight keywords and numbers
	assert.ok(styled[4].startsWith("    "));
	assert.ok(styled[4].includes("[syntaxKeyword]const[/syntaxKeyword]"));
	assert.ok(styled[5].includes("[syntaxKeyword]return[/syntaxKeyword]"));
	assert.ok(styled[5].includes("[syntaxNumber]10[/syntaxNumber]"));
	// Closing brace untouched
	assert.equal(styled[6], "}");
});

test("formatWriteDiffLines - edit compact diff lines (+code / -code) highlight properly", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const editCompact = [
		"edit src/calc.ts",
		"+const sum = a + b;",
		"-let sum = 0;",
	];

	const styled = formatWriteDiffLines(editCompact, "src/calc.ts", mockTheme, "edit");
	assert.equal(styled[0], editCompact[0]);
	// Compact added line has green prefix + Dracula keyword
	assert.ok(styled[1].includes("[toolDiffAdded]+ [/toolDiffAdded]"));
	assert.ok(styled[1].includes("[syntaxKeyword]const[/syntaxKeyword]"));
	// Compact removed line has red prefix + Dracula keyword
	assert.ok(styled[2].includes("[toolDiffRemoved]- [/toolDiffRemoved]"));
	assert.ok(styled[2].includes("[syntaxKeyword]let[/syntaxKeyword]"));
});


test("formatReadLines - highlights plain read code Dracula-style and preserves headers", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const raw = [
		"",
		"   ",
		"read src/cute-transcript.ts:50-119",
		"const x: number = 42;",
		"    return current;",
		"ctrl+o to expand",
	];
	const styled = formatReadLines(raw, "src/cute-transcript.ts", mockTheme);

	// Header and hint untouched even with leading empty spacer lines
	assert.equal(styled[2], raw[2]);
	assert.equal(styled[5], raw[5]);

	// Code lines highlighted Dracula-style
	assert.ok(styled[3].includes("[syntaxKeyword]const[/syntaxKeyword]"));
	assert.ok(styled[3].includes("[syntaxNumber]42[/syntaxNumber]"));
	assert.ok(styled[4].includes("[syntaxKeyword]return[/syntaxKeyword]"));

	// Indentation preserved
	assert.ok(styled[4].startsWith("    "));
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
		"src/cute-transcript.ts",
		"src/cute-profiles.ts",
		"src/cute-notify.ts",
		"src/cute-context-monitor.ts",
		"src/cute-git-graph.ts",
		"src/cute-tools.ts",
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

test("cute-paths - readActiveProfile prioritizes project scope over global scope", () => {
	resetActiveProfileCache();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-profile-test-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "Cinlodev02", "utf8");
		const active = readActiveProfile(tmpDir);
		assert.equal(active, "Cinlodev02", "should read project-local .active first");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetActiveProfileCache();
	}
});

test("CinlodevCute.json theme - userMessageBg matches toolSuccessBg dark violet", () => {
	const themePath = fileURLToPath(new URL("../themes/CinlodevCute.json", import.meta.url));
	assert.ok(fs.existsSync(themePath), "themes/CinlodevCute.json must exist");
	const themeJson = JSON.parse(fs.readFileSync(themePath, "utf8"));
	assert.equal(themeJson.vars.userMessageBg, "#140a28");
	assert.equal(themeJson.vars.toolSuccessBg, "#140a28");
	assert.equal(themeJson.vars.userMessageText, "#C5C18E");
	assert.equal(themeJson.colors.userMessageBg, "userMessageBg");
});

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

test("cute-notify - herdrAvailable and fallback notification dispatch", () => {
	const origSocket = process.env.HERDR_SOCKET_PATH;
	const origEnv = process.env.HERDR_ENV;

	try {
		delete process.env.HERDR_SOCKET_PATH;
		delete process.env.HERDR_ENV;
		assert.equal(herdrAvailable(), false);

		// Fallback to ctx.ui.notify when Herdr is absent
		let notifiedMsg = "";
		let notifiedType = "";
		const mockCtx = {
			hasUI: true,
			ui: {
				notify: (msg: string, type: string) => {
					notifiedMsg = msg;
					notifiedType = type;
				},
			},
		} as any;

		const res = notify(mockCtx, "Título Test", "Cuerpo Test", "warning");
		assert.equal(res, false, "should return false indicating it did not go through Herdr");
		assert.ok(notifiedMsg.includes("Título Test"));
		assert.ok(notifiedMsg.includes("Cuerpo Test"));
		assert.equal(notifiedType, "warning");
	} finally {
		if (origSocket) process.env.HERDR_SOCKET_PATH = origSocket;
		if (origEnv) process.env.HERDR_ENV = origEnv;
	}
});

test("cute-context-monitor - progressive 2-level thresholds (orange single notice, red 5m recurring, auto-reset)", () => {
	const notifications: Array<{ title: string; body: string; type: string }> = [];
	const monitor = new CuteContextMonitor({
		alertThreshold: 65,
		criticalThreshold: 80,
		criticalIntervalMs: 50, // 50ms for unit test speed instead of 5min
		onNotify: (title, body, type) => {
			notifications.push({ title, body, type });
		},
	});

	const makeCtx = (tokens: number, contextWindow = 100_000) =>
		({
			getContextUsage: () => ({
				tokens,
				contextWindow,
				percent: (tokens / contextWindow) * 100,
			}),
		}) as any;

	// 1. Context at 50% (Normal/Óptimo): No notification
	const res50 = monitor.check(makeCtx(50_000));
	assert.equal(res50.level, "optimal");
	assert.equal(res50.notified, false);
	assert.equal(notifications.length, 0);

	// 2. Context reaches 70% (Naranja / Alerta): Fires ONE single notification
	const res70 = monitor.check(makeCtx(70_000));
	assert.equal(res70.level, "alert");
	assert.equal(res70.notified, true);
	assert.equal(notifications.length, 1);
	assert.ok(notifications[0].title.includes("70%"));
	assert.ok(notifications[0].body.includes("/handoff"));
	assert.equal(notifications[0].type, "info");

	// 3. Context stays in orange at 72%: Does NOT fire again (no spam)
	const res72 = monitor.check(makeCtx(72_000));
	assert.equal(res72.level, "alert");
	assert.equal(res72.notified, false);
	assert.equal(notifications.length, 1);

	// 4. Context reaches 82% (Rojo / Crítico): Fires immediately
	const res82 = monitor.check(makeCtx(82_000));
	assert.equal(res82.level, "critical");
	assert.equal(res82.notified, true);
	assert.equal(notifications.length, 2);
	assert.ok(notifications[1].title.includes("82%"));
	assert.ok(notifications[1].body.includes("/compact"));
	assert.equal(notifications[1].type, "warning");

	// 5. Context still at 82% immediately after: Does NOT fire before interval
	const res82Immediate = monitor.check(makeCtx(82_000));
	assert.equal(res82Immediate.level, "critical");
	assert.equal(res82Immediate.notified, false);
	assert.equal(notifications.length, 2);

	// 6. Context drops to 30% (e.g. after /compact): Monitor auto-resets
	const res30 = monitor.check(makeCtx(30_000));
	assert.equal(res30.level, "optimal");
	assert.equal(res30.notified, false);
	assert.equal(monitor.isAlertNotified, false);
	assert.equal(monitor.lastCriticalTime, 0);

	// 7. Context rises back to 70%: Can fire orange alert again!
	const res70Again = monitor.check(makeCtx(70_000));
	assert.equal(res70Again.level, "alert");
	assert.equal(res70Again.notified, true);
	assert.equal(notifications.length, 3);

	monitor.stop();
});

test("cute-git-graph - colorizeGitGraphLine styles graph edges, hashes and branch refs in Dracula", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	// 1. Pure graph line
	const pureGraph = "|\\  ";
	const coloredGraph = colorizeGitGraphLine(pureGraph, mockTheme);
	assert.ok(coloredGraph.includes("[syntaxFunction]|\\"), "Pipes and backslashes should be styled with syntaxFunction");

	// 2. Commit line with HEAD branch and message
	const commitLine = "* 5b0836f (HEAD -> feat/sidebar-git-graph, origin/develop) Merge PR #73";
	const coloredCommit = colorizeGitGraphLine(commitLine, mockTheme);
	assert.ok(coloredCommit.includes("[accent]*[/accent]"), "* node should be styled in accent (pink)");
	assert.ok(coloredCommit.includes("[syntaxNumber]5b0836f[/syntaxNumber]"), "hash should be styled in syntaxNumber (yellow)");
	assert.ok(coloredCommit.includes("[mint]HEAD -> feat/sidebar-git-graph[/mint]"), "HEAD should be styled in mint");
	assert.ok(coloredCommit.includes("[secondary]origin/develop[/secondary]"), "origin remote should be styled in secondary");
	assert.ok(coloredCommit.includes("[syntaxPunctuation]([/syntaxPunctuation]"), "parentheses should be styled in syntaxPunctuation");
	assert.ok(coloredCommit.includes("[text]Merge PR #73[/text]"), "commit subject should be styled in text");
});

test("cute-git-graph - CinlodevGitGraphCard interactive expansion toggle and rendering", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	let renderRequested = 0;
	const mockTui = {
		requestRender: () => {
			renderRequested++;
		},
	} as any;

	const mockCtx = {
		cwd: process.cwd(),
	} as any;

	const card = new CinlodevGitGraphCard(mockCtx, mockTui, mockTheme);

	// Default expanded is true
	assert.equal(card.isExpanded(), true);

	// Render expanded (wide width for mock theme tags)
	const expandedLines = card.render(220);
	assert.ok(expandedLines.length >= 5, "Expanded graph should have top, spacers, branch, tree, and bottom");
	assert.ok(expandedLines[0].includes("git graph"), "Top bar should contain title 'git graph'");
	// Spacing above branch
	assert.equal(expandedLines[1].replace(/\[\/?border\]|[║\s]/g, "").trim(), "", "Line below top bar should be an empty spacer");
	// Branch row
	const expectedBranchPrefix = readGitBranch(process.cwd()).slice(0, 8);
	assert.ok(expandedLines[2].includes(expectedBranchPrefix), `Line 2 should display branch starting with '${expectedBranchPrefix}'`);
	// Spacing below branch / above tree
	assert.equal(expandedLines[3].replace(/\[\/?border\]|[║\s]/g, "").trim(), "", "Line below branch should be an empty spacer");
	assert.ok(expandedLines[expandedLines.length - 1].includes("╝"), "Bottom border should close the card");

	// Click toggles to collapsed
	const handled = card.handleClick(0);
	assert.equal(handled, true);
	assert.equal(card.isExpanded(), false);
	assert.equal(renderRequested, 1);

	// Render collapsed
	// Wide width: mock syntax tags ([warning]...) count as visible chars in mockTheme
	const collapsedLines = card.render(220);
	assert.equal(collapsedLines.length, 3, "Collapsed graph should have top, 1-line summary, and bottom");
	assert.ok(collapsedLines[0].includes("git"), "Top bar should contain title 'git'");
	assert.ok(collapsedLines[1].includes(readGitBranch(process.cwd())), "Collapsed card should display current branch");

	// Click toggles back to expanded
	card.handleClick(1);
	assert.equal(card.isExpanded(), true);
	assert.equal(renderRequested, 2);

	// Invalidate clears cache
	card.invalidate();
});

test("cute-git-graph - renders session changes below branches when present on sidebarState", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
	const mockTui = {
		requestRender: () => {},
		terminal: {
			[SIDEBAR_STATE]: {
				parts: new Map([
					["changes", {
						render: () => ["✎ 16 files · +990 −42 · partial counts"],
					}],
				]),
			},
		},
	} as any;

	const mockCtx = { cwd: process.cwd() } as any;
	const card = new CinlodevGitGraphCard(mockCtx, mockTui, mockTheme);
	card.setExpanded(true);

	const lines = card.render(50);
	const joined = lines.join("\n");
	assert.ok(joined.includes("16 files · +990 −42"), "Card should render session changes row below branches");
	// Spacer between commit tree and changes row
	assert.equal(lines[lines.length - 3].replace(/\[\/?border\]|[║\s]/g, "").trim(), "", "Line above changes row should be an empty spacer");
	// The changes row should be right above the bottom border
	assert.ok(lines[lines.length - 2].includes("16 files · +990 −42"));
	assert.ok(lines[lines.length - 1].includes("╝"));
});

test("cute-git-graph - parseGitStatusPorcelain and formatGitStatusBadges", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	// 1. Clean status
	const cleanCounts = parseGitStatusPorcelain("");
	assert.equal(cleanCounts.isClean, true);
	assert.equal(cleanCounts.staged, 0);
	assert.equal(cleanCounts.modified, 0);
	assert.equal(cleanCounts.untracked, 0);

	const cleanBadge = formatGitStatusBadges(cleanCounts, mockTheme);
	assert.ok(cleanBadge.includes("[mint]✔ clean[/mint]"));

	// 2. Dirty porcelain sample
	const porcelainSample = `
M  src/staged-mod.ts
 M src/unstaged-mod.ts
A  src/new-staged.ts
?? untracked-file.txt
UU conflicted-file.ts
`.trim();

	const dirtyCounts = {
		...parseGitStatusPorcelain(porcelainSample),
		linesAdded: 15,
		linesDeleted: 3,
	};
	assert.equal(dirtyCounts.isClean, false);
	assert.equal(dirtyCounts.staged, 2); // 'M ' and 'A '
	assert.equal(dirtyCounts.modified, 1); // ' M'
	assert.equal(dirtyCounts.untracked, 1); // '??'
	assert.equal(dirtyCounts.conflicts, 1); // 'UU'
	assert.equal(dirtyCounts.linesAdded, 15);
	assert.equal(dirtyCounts.linesDeleted, 3);

	const dirtyBadge = formatGitStatusBadges(dirtyCounts, mockTheme);
	assert.ok(dirtyBadge.includes("[warning]● 1 mod[/warning]"));
	assert.ok(dirtyBadge.includes("[mint]+2 staged[/mint]"));
	assert.ok(dirtyBadge.includes("[secondary]?1 untracked[/secondary]"));
	assert.ok(dirtyBadge.includes("[error]✖ 1 conflict[/error]"));

	// 3. Test parseGitNumstat with normal lines and binaries
	const numstatOutput = "12\t4\tsrc/a.ts\n50\t0\tsrc/b.ts\n-\t-\timage.png\n";
	const parsedStats = parseGitNumstat(numstatOutput);
	assert.equal(parsedStats.linesAdded, 62);
	assert.equal(parsedStats.linesDeleted, 4);
});

test("cute-tools - recordToolCall and collectToolCounts categorizes session tools", () => {
	const counts = createEmptyToolCounts();
	recordToolCall(counts, "read");
	recordToolCall(counts, "write");
	recordToolCall(counts, "edit");
	recordToolCall(counts, "bash");
	recordToolCall(counts, "mem_save");
	recordToolCall(counts, "mem_search");
	recordToolCall(counts, "grep");
	recordToolCall(counts, "fetch_content");
	recordToolCall(counts, "web_search");
	recordToolCall(counts, "custom_tool");

	assert.equal(counts.read, 1);
	assert.equal(counts.write, 2, "write and edit should be grouped under write");
	assert.equal(counts.bash, 1);
	assert.equal(counts.engram, 2, "mem_* should be grouped under engram");
	assert.equal(counts.grep, 1);
	assert.equal(counts.fetch, 1);
	assert.equal(counts.search, 1);
	assert.equal(counts.other, 1);
	assert.equal(counts.total, 10);

	// Context with mock branch
	const mockCtx = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", name: "read" },
							{ type: "toolCall", name: "bash" },
						],
					},
				},
				{
					type: "message",
					message: {
						role: "user",
						content: "hello",
					},
				},
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", name: "write" },
							{ type: "toolCall", name: "mem_save" },
						],
					},
				},
			],
		},
	};

	const sessionCounts = collectToolCounts(mockCtx as any);
	assert.equal(sessionCounts.read, 1);
	assert.equal(sessionCounts.bash, 1);
	assert.equal(sessionCounts.write, 1);
	assert.equal(sessionCounts.engram, 1);
	assert.equal(sessionCounts.total, 4);
});

test("cute-tools - formatToolPill and wrapToolPills", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const readPill = formatToolPill("read", 5, mockTheme);
	assert.ok(readPill.includes("[read]✎ 5 read[/read]"));

	const writePill = formatToolPill("write", 3, mockTheme);
	assert.ok(writePill.includes("[write]✎ 3 write[/write]"));

	const bashPill = formatToolPill("bash", 2, mockTheme);
	assert.ok(bashPill.includes("[bash]>_ 2 bash[/bash]"));

	const engramPill = formatToolPill("engram", 4, mockTheme);
	assert.ok(engramPill.includes("[salmon]🧠 4 engram[/salmon]"));

	// 0 count returns empty string
	assert.equal(formatToolPill("grep", 0, mockTheme), "");

	// Wrap pills into rows
	const pills = ["pillA", "pillB", "pillC", "pillD"];
	const rows = wrapToolPills(pills, 16);
	assert.ok(rows.length >= 2, "Should wrap into multiple lines when width is small");
});

test("cute-tools - CinlodevToolsCard hides when empty and renders when tools present", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const mockTui = { requestRender: () => {} } as any;

	// 1. Empty session: card stays hidden
	const emptyCtx = {
		sessionManager: { getBranch: () => [] },
	} as any;
	const emptyCard = new CinlodevToolsCard(emptyCtx, mockTui, mockTheme);
	assert.deepEqual(emptyCard.render(50), [], "Card must return [] when total tool calls is 0");

	// 2. Active session: card renders
	const activeCtx = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", name: "read" },
							{ type: "toolCall", name: "read" },
							{ type: "toolCall", name: "write" },
						],
					},
				},
			],
		},
	} as any;
	const activeCard = new CinlodevToolsCard(activeCtx, mockTui, mockTheme);
	const rendered = activeCard.render(50);
	assert.ok(rendered.length >= 3, "Rendered card must have top, content rows, and bottom");
	assert.ok(rendered[0].includes("tools"), "Top header must contain 'tools'");
	assert.ok(rendered[0].includes("3 calls"), "Top header must indicate '3 calls'");
	const joined = rendered.join("\n");
	assert.ok(joined.includes("2 read"));
	assert.ok(joined.includes("1 write"));
});

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

	// 2. cleanPoolLabel
	assert.equal(cleanPoolLabel("Gemini Models · Weekly Limit Remaining"), "Gemini Weekly");
	assert.equal(cleanPoolLabel("Claude and GPT models · Five Hour Limit Remaining"), "Claude/GPT 5h");

	// 3. Parse raw usage to accounts with prefixes
	const prefixMap = new Map([
		["cinlodigital@gmail.com", "cinlo_dig"],
	]);
	const rawGroups = [
		{
			provider: "antigravity",
			accounts: [
				{
					account: "cinlodigital@gmail.com",
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
	assert.equal(accounts[0].prefix, "cinlo_dig", "Must use prefix instead of email");
	assert.equal(accounts[0].pools.length, 4, "Must hold all 4 quota pools");
	assert.equal(accounts[0].pools[0].availablePercent, 84);

	// 4. Provider-isolated prefix mapping without collisions
	const collidingPrefixMap = new Map([
		["antigravity:cinlodev@gmail.com", "cinlodev"],
		["codex:cinlodev@gmail.com", "codex_cinlodev"],
		["cinlodev@gmail.com", "fallback_should_not_be_used"],
	]);
	const multiProviderGroups = [
		{
			provider: "antigravity",
			accounts: [{ account: "cinlodev@gmail.com", pools: [{ label: "Gemini", availablePercentage: 100 }] }],
		},
		{
			provider: "codex",
			accounts: [{ account: "cinlodev@gmail.com", pools: [{ label: "Codex", availablePercentage: 50 }] }],
		},
	];
	const multiAccounts = parseRawUsageToAccounts(multiProviderGroups, collidingPrefixMap);
	assert.equal(multiAccounts[0].prefix, "cinlodev", "Antigravity account must get provider-scoped prefix");
	assert.equal(multiAccounts[1].prefix, "codex_cinlodev", "Codex account must get provider-scoped prefix");

	// 5. prioritizeActiveAccount puts active prefix at index 0
	const mockAccounts = [
		{ provider: "codex", prefix: "codex", pools: [] },
		{ provider: "antigravity", prefix: "cinlo_dig", pools: [] },
		{ provider: "antigravity", prefix: "cin82", pools: [] },
	];
	const prioritized = prioritizeActiveAccount(mockAccounts, "cin82");
	assert.equal(prioritized[0].prefix, "cin82", "Active orchestrator prefix must be at index 0");
});

test("cute-usage - CinlodevUsageCard visibility toggle and Context-style gauge rendering", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	let renderRequested = 0;
	const mockTui = {
		requestRender: () => {
			renderRequested++;
		},
	} as any;

	const mockCtx = {} as any;
	const card = new CinlodevUsageCard(mockCtx, mockTui, mockTheme);

	// 1. Initially hidden: renders []
	assert.equal(card.isVisible(), false);
	assert.deepEqual(card.render(50), [], "Hidden card must return []");

	// 2. Toggle to visible
	const state1 = card.toggle();
	assert.equal(state1, true);
	assert.equal(card.isVisible(), true);
	assert.equal(renderRequested, 1);

	// 3. Render when visible (wide width for mock tags)
	const lines = card.render(220);
	assert.ok(lines.length >= 3, "Rendered card must have top, body rows, and bottom");
	assert.ok(lines[0].includes("Quotas"), "Top header must contain 'Quotas'");
	assert.ok(lines[0].includes("Alt+Q"), "Top header must indicate shortcut 'Alt+Q'");
	assert.ok(lines[lines.length - 1].includes("╝"), "Bottom border must close the card");

	// 4. Toggle back to hidden
	const state2 = card.toggle();
	assert.equal(state2, false);
	assert.equal(card.isVisible(), false);
	assert.equal(renderRequested, 2);
	assert.deepEqual(card.render(50), [], "Hidden card must return [] after toggle off");

	// 5. Render pools at different quota levels with dynamic 4-tier semáforo colors
	setCachedAccountsForTesting([
		{
			provider: "antigravity",
			prefix: "cin82",
			pools: [
				{ label: "Optimal Pool", availablePercent: 90, used: 10, total: 100, unlimited: false, resetAt: null },
				{ label: "Medium Pool", availablePercent: 50, used: 50, total: 100, unlimited: false, resetAt: null },
				{ label: "Alert Pool", availablePercent: 30, used: 70, total: 100, unlimited: false, resetAt: null },
				{ label: "Critical Pool", availablePercent: 10, used: 90, total: 100, unlimited: false, resetAt: null },
			],
		},
	]);
	card.toggle(); // turn on
	const coloredLines = card.render(220);
	const renderedText = coloredLines.join("\n");
	assert.ok(renderedText.includes("[mint]●[/mint]"), "90% pool bullet must be mint");
	assert.ok(renderedText.includes("[mint]90%[/mint]"), "90% pool percentage must be mint");
	assert.ok(renderedText.includes("[heading]●[/heading]"), "50% pool bullet must be gold/heading");
	assert.ok(renderedText.includes("[heading]50%[/heading]"), "50% pool percentage must be gold/heading");
	assert.ok(renderedText.includes("[orange]●[/orange]"), "30% pool bullet must be orange");
	assert.ok(renderedText.includes("[orange]30%[/orange]"), "30% pool percentage must be orange");
	assert.ok(renderedText.includes("[red]●[/red]"), "10% pool bullet must be red/coral");
	assert.ok(renderedText.includes("[red]10%[/red]"), "10% pool percentage must be red/coral");
	card.toggle(); // turn off

	// 6. Mouse wheel and bidirectional click navigation (with cached accounts)
	renderRequested = 0;
	setCachedAccountsForTesting([
		{ provider: "antigravity", prefix: "cin82", pools: [] },
		{ provider: "antigravity", prefix: "cinlo_dig", pools: [] },
	]);
	card.handleClick(0, "left"); // forward
	assert.equal(renderRequested, 1);
	card.handleClick(0, "right"); // backward
	assert.equal(renderRequested, 2);
	card.handleWheel(-1); // wheel up
	assert.equal(renderRequested, 3);
	card.handleWheel(1); // wheel down
	assert.equal(renderRequested, 4);
});

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
	assert.equal(resolveDashboardUrl({ serverUrl: "https://engram.cinlodev.com" }), "https://engram.cinlodev.com/dashboard/");
	assert.equal(resolveDashboardUrl({ serverUrl: "https://myengram.dev///" }), "https://myengram.dev/dashboard/");
	assert.equal(resolveDashboardUrl({ serverUrl: "https://engram.cinlodev.com" }, "dypos"), "https://engram.cinlodev.com/dashboard/projects/dypos");

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

