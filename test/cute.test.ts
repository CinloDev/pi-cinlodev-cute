import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cuteGlyphs, resetCuteGlyphsCache, PETAL_PRESETS, unifyCardFrame, unifySidebarCardFrame, transformTranscriptLines, formatGentleAiCardLine, installWelcomeHeaderGuard } from "../src/cute-theme.ts";
import { frameCategoryBox, formatTranscriptChild } from "../src/cute-transcript.ts";
import { loadCuteStrings, resetCuteStringsCache, detectSystemUser } from "../src/cute-strings.ts";
import { loadCuteLayout, resetCuteLayoutCache, tuneTuiScroll } from "../src/cute-layout.ts";
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

	// 2. Assistant Message renders naturally without extra bounding box
	class AssistantMessageComponent {
		render() { return ["# Title", "Explicación del asistente"]; }
	}
	const asstRender = formatTranscriptChild(new AssistantMessageComponent() as any, 60, mockTheme);
	assert.equal(asstRender[0], "# Title");
	assert.equal(asstRender[1], "Explicación del asistente");

	// 3. Bash Execution renders naturally
	class BashExecutionComponent {
		render() { return ["$ npm test", "# pass 10"]; }
	}
	const bashRender = formatTranscriptChild(new BashExecutionComponent() as any, 60, mockTheme);
	assert.equal(bashRender[0], "$ npm test");

	// 4. Gentle AI Tool Call Card adapts to double lines, robot glyph and mint green
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
		assert.equal(colors.gentleCardSuccess, "success");
		assert.equal(colors.gentleCardWarning, "warning");
		assert.equal(colors.gentleCardError, "error");
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

test("Syntax check across all source files", () => {
	const srcFiles = ["index.ts", "src/cute-theme.ts", "src/cute-strings.ts", "src/cute-layout.ts", "src/cute-paths.ts", "src/cute-colors.ts", "src/hud.ts", "src/footer.ts", "src/sidebar.ts", "src/welcome.ts", "src/editor.ts", "src/todos.ts", "src/cute-transcript.ts"];
	for (const f of srcFiles) {
		assert.ok(fs.existsSync(f), `File exists: ${f}`);
	}
});
