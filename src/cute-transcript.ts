import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadCuteStrings, detectSystemUser } from "./cute-strings.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { safeFg, bolden, stripAnsi, transformTranscriptLines } from "./cute-theme.ts";

export interface CuteFrameOptions {
	title?: string;
	toneKey?: string;
	width: number;
}

/**
 * Calculates visible terminal column width, ignoring ANSI sequences and
 * accounting for 2-column wide characters and emojis (e.g. 🤖, 🌷).
 */
export function calcVisibleWidth(text: string): number {
	const plain = stripAnsi(text);
	let width = 0;
	let lastCharWidth = 0;
	for (const char of plain) {
		const cp = char.codePointAt(0) ?? 0;
		if (cp === 0xfe0f) {
			// Emoji variation selector promotes a 1-column symbol (like ☁ \u2601) to 2 columns in terminal
			if (lastCharWidth === 1) {
				width += 1;
				lastCharWidth = 2;
			}
			continue;
		}
		if (cp >= 0xfe00 && cp <= 0xfe0e) {
			// Other variation selectors are 0-width
			continue;
		}
		if (
			(cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
			(cp >= 0x2e80 && cp <= 0xa4cf) || // CJK Radicals, Kangxi, CJK Unified Ideographs
			(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
			(cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
			(cp >= 0xfe10 && cp <= 0xfe19) || // Vertical forms
			(cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
			(cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x1f300 && cp <= 0x1faff) // Emojis, Symbols (🤖, 🌷, etc.)
		) {
			width += 2;
			lastCharWidth = 2;
		} else if (cp >= 0x20) {
			width += 1;
			lastCharWidth = 1;
		}
	}
	return width;
}

/**
 * Truncates a string to fit within a given visible terminal width.
 * NOTE: not ANSI-safe (it can sever escape sequences mid-way); prefer
 * truncateAnsiAware for any line that may carry colors.
 */
export function truncateToVisibleWidth(text: string, maxWidth: number): string {
	if (calcVisibleWidth(text) <= maxWidth) return text;
	let current = "";
	for (const char of text) {
		if (calcVisibleWidth(current + char) > maxWidth) break;
		current += char;
	}
	return current;
}

/**
 * Escape sequences that must travel as atomic zero-width units: CSI colors,
 * OSC / iTerm2 inline images, and Kitty keyboard/graphics (APC) sequences.
 * Image attachments can smuggle these into read lines; counting or cutting
 * them breaks the frame.
 */
const ESCAPE_ATOM = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\/g;
const ESCAPE_ATOM_SINGLE = /^(?:\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\)$/;

/**
 * ANSI-aware truncation: escape sequences travel as atomic zero-width units
 * so they are never severed, and only plain text consumes the width budget.
 * When the cut lands inside colored text a reset is appended so color never
 * bleeds into the frame border or the padded fill.
 */
export function truncateAnsiAware(text: string, maxWidth: number): string {
	if (calcVisibleWidth(text) <= maxWidth) return text;
	const parts = text.split(/(\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\)/g);
	let out = "";
	let cut = false;
	for (const part of parts) {
		if (!part) continue;
		if (ESCAPE_ATOM_SINGLE.test(part)) {
			out += part;
			continue;
		}
		for (const char of part) {
			if (calcVisibleWidth(out + char) > maxWidth) {
				cut = true;
				break;
			}
			out += char;
		}
		if (cut) break;
	}
	ESCAPE_ATOM.lastIndex = 0;
	if (cut && ESCAPE_ATOM.test(text)) out += "\x1b[39m";
	return out;
}

/**
 * Frames an array of content lines in a symmetric double-line CUTE card:
 * ╔═ Title ══════════════════════════════════════════════════════════════╗
 * ║ content                                                              ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 * Guarantees exact width on every line, closing the quadrant symmetrically.
 */
export function frameCategoryBox(
	rawLines: string[],
	title: string,
	toneKey: string,
	width: number,
	theme?: Theme,
): string[] {
	const color = (s: string): string => (theme ? safeFg(theme, toneKey, s) : s);
	const safeWidth = Math.max(30, width);
	const innerWidth = safeWidth - 4; // ║ + space + content + space + ║

	// Clean leading and trailing empty lines
	const lines = [...rawLines];
	while (lines.length && stripAnsi(lines[0] ?? "").trim() === "") lines.shift();
	while (lines.length && stripAnsi(lines[lines.length - 1] ?? "").trim() === "") lines.pop();
	if (!lines.length) return [];

	const titleStr = title ? ` ${title} ` : "";
	const titleWidth = calcVisibleWidth(titleStr);
	// ╔═ (2) + titleStr (titleWidth) + ═.repeat(fillLen) + ╗ (1) = safeWidth
	// fillLen = safeWidth - titleWidth - 3
	const fillLen = Math.max(0, safeWidth - titleWidth - 3);
	const top = color("╔═" + titleStr + "═".repeat(fillLen) + "╗");
	const bot = color("╚" + "═".repeat(safeWidth - 2) + "╝");

	const body = lines.map((line) => {
		const truncated = truncateAnsiAware(line, innerWidth);
		const w = calcVisibleWidth(truncated);
		const pad = " ".repeat(Math.max(0, innerWidth - w));
		return color("║") + " " + truncated + pad + " " + color("║");
	});

	return [top, ...body, bot];
}

/**
 * Checks whether a transcript component is a bash execution
 * (either interactive BashExecutionComponent or ToolExecutionComponent with toolName: "bash").
 */
export function isBashComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name === "BashExecutionComponent" || (typeof (child as any).command === "string" && Array.isArray((child as any).outputLines))) return true;
	if (name === "ToolExecutionComponent" && (child as any).toolName === "bash") return true;
	if ((child as any).toolName === "bash") return true;
	return false;
}

export function isSpacer(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	return name === "Spacer";
}

/**
 * Checks whether a transcript component is a read tool execution
 * (ToolExecutionComponent with toolName: "read").
 */
export function isReadComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name === "ToolExecutionComponent" && (child as any).toolName === "read") return true;
	if ((child as any).toolName === "read") return true;
	return false;
}

/**
 * Checks whether a transcript component is a write/edit tool execution
 * (ToolExecutionComponent with toolName: "write" or "edit").
 */
export function isWriteComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	const toolName = (child as any).toolName;
	if (name === "ToolExecutionComponent" && (toolName === "write" || toolName === "edit")) return true;
	if (toolName === "write" || toolName === "edit") return true;
	return false;
}

/**
 * Checks whether a transcript component is a grep tool execution
 * (toolName === "grep").
 */
export function isGrepComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	const toolName = (child as any).toolName;
	if (name === "ToolExecutionComponent" && toolName === "grep") return true;
	if (toolName === "grep") return true;
	return false;
}

/**
 * Formats grep tool output lines without framing:
 * Renders file paths in subtle lilac/accent, line numbers in syntax gold/orange,
 * and code content in Dracula-style syntax highlighting.
 * Header lines (grep /pattern/ in path) and hints pass through untouched.
 */
export function formatGrepLines(rawLines: string[], theme?: Theme): string[] {
	const lines = unwrapNativeCard(rawLines);
	if (!theme || !lines.length) return lines;
	return lines.map((line, idx) => {
		const plain = stripAnsi(line);
		const trimmed = plain.trim();
		if (!trimmed) return line;

		// 1. Tool call header: "grep /pattern/ in path..." or "⌕ grep ..."
		if (idx === 0 && /^(?:[⌕\u2315\u270E]\s*)?grep\s+/i.test(trimmed)) {
			return line;
		}

		// 2. Summary line ("→ 13 matches"), expand hint ("ctrl+o to expand"), or truncation notice
		if (
			trimmed.includes("matches") ||
			trimmed.includes("to expand") ||
			trimmed.startsWith("... (") ||
			trimmed.startsWith("[Truncated:")
		) {
			return line;
		}

		// 3. Match format: "filepath:linenum:code" or "filepath:linenum-code"
		const match = /^([^\s:]+):(\d+)[:\-](.*)$/.exec(plain);
		if (match) {
			const filePath = match[1];
			const lineNum = match[2];
			const code = match[3];

			const coloredPath = safeFg(theme, "read", filePath, "accent");
			const separator = safeFg(theme, "syntaxPunctuation", ":", "muted");
			const coloredLineNum = safeFg(theme, "syntaxNumber", lineNum, "warning");
			const highlightedCode = highlightCodeLine(code, theme);

			return `${coloredPath}${separator}${coloredLineNum}${separator}${highlightedCode}`;
		}

		// 4. Continued lines or wrapped matches: highlight if it looks like code
		return highlightCodeLine(line, theme);
	});
}

/**
 * Tool names that render a `fetch <url>` header (pi-web-access registers
 * `fetch_content` by default; `fetch` is kept as an alias). Tool names are
 * user-renamable, so rendered headers are sniffed as a fallback.
 */
const FETCH_TOOL_NAMES = new Set(["fetch", "fetch_content"]);

/**
 * Checks whether a transcript component is a fetch tool execution.
 * Matches by toolName (`fetch_content` / `fetch`) or, when the tool was
 * renamed, by its rendered `fetch <url>` header line.
 */
export function isFetchComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	if (typeof toolName === "string" && FETCH_TOOL_NAMES.has(toolName)) return true;
	// Header sniff applies only to tool executions (renamed tools keep
	// rendering `fetch <url>`), never to plain messages that mention fetch.
	if (typeof toolName !== "string") return false;
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines) return looksLikeFetchLines(lines);
	return false;
}

/**
 * True when rendered lines open with a `fetch <url>` tool header
 * (e.g. pi-web-access `fetch_content` with a custom tool name).
 */
export function looksLikeFetchLines(rawLines: string[]): boolean {
	const lines = unwrapNativeCard(rawLines);
	for (const line of lines) {
		const plain = stripAnsi(line).trim();
		if (!plain) continue;
		return /^(?:[✿❀❁✾★✣≡⌕+☷⌖✎\u270E]\s*)?fetch\s+/i.test(plain);
	}
	return false;
}

/** Renders a child best-effort for content sniffing; undefined when it throws. */
function tryRender(child: Component, width: number): string[] | undefined {
	try {
		return (child as unknown as { render?: (w: number) => string[] }).render?.(width);
	} catch {
		return undefined;
	}
}

/**
 * Tool names that render a `search ...` header (pi-web-access registers
 * `web_search` by default; `search` is kept as an alias). Like fetch,
 * tool names are user-renamable, so headers are sniffed as a fallback.
 */
const SEARCH_TOOL_NAMES = new Set(["search", "web_search"]);

/**
 * Checks whether a transcript component is a search tool execution.
 * Matches by toolName (`web_search` / `search`) or by its rendered
 * `search ...` header line when the tool was renamed.
 */
export function isSearchComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	if (typeof toolName === "string" && SEARCH_TOOL_NAMES.has(toolName)) return true;
	if (typeof toolName !== "string") return false;
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines) return looksLikeSearchLines(lines);
	return false;
}

/**
 * True when rendered lines open with a `search ...` tool header.
 */
export function looksLikeSearchLines(rawLines: string[]): boolean {
	const lines = unwrapNativeCard(rawLines);
	for (const line of lines) {
		const plain = stripAnsi(line).trim();
		if (!plain) continue;
		return /^(?:[✿❀❁✾★✣≡⌕+☷⌖✎\u270E]\s*)?search\s+/i.test(plain);
	}
	return false;
}

/**
 * Known gentle_review / RDD tool names.
 */
const REVIEW_TOOL_NAMES = new Set([
	"gentle_review",
	"gentle_review_capture",
	"gentle_review_capture_group",
	"gentle_review_scope",
]);

/**
 * Checks whether a transcript component is a gentle_review / RDD tool execution.
 * Matches by toolName (gentle_review, gentle_review_capture, etc.) or by
 * rendered lines that match `🌹 rdd ...`, `rdd ...`, or `gentle_review...`.
 */
export function isReviewComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name === "UserMessageComponent" || name === "AssistantMessageComponent") return false;
	const toolName = (child as any).toolName;
	if (typeof toolName === "string" && (REVIEW_TOOL_NAMES.has(toolName) || toolName.startsWith("gentle_review"))) {
		return true;
	}
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines) return looksLikeReviewLines(lines);
	return false;
}

/**
 * True when rendered lines open with a review / RDD header (e.g. `🌹 rdd inspect`, `rdd start`).
 */
export function looksLikeReviewLines(rawLines: string[]): boolean {
	const lines = unwrapNativeCard(rawLines);
	for (const line of lines) {
		const plain = stripAnsi(line).trim();
		if (!plain) continue;
		return /(?:🌹\s*)?rdd\b/i.test(plain) || /^gentle_review(?:_|\b)/i.test(plain);
	}
	return false;
}

/**
 * Extracts a clean title for the card header (e.g. "🌹 rdd inspect", "🌹 rdd start").
 * Fallbacks to "🌹 rdd" when no specific operation is found.
 */
export function extractReviewHeader(rawLines: string[], child?: Component): string {
	const lines = unwrapNativeCard(rawLines);
	for (const line of lines) {
		const plain = stripAnsi(line).trim();
		if (!plain) continue;
		const rddMatch = /(?:🌹\s*)?rdd(?:\s+([a-z0-9_-]+))?/i.exec(plain);
		if (rddMatch) {
			const op = rddMatch[1]?.trim();
			return op ? `🌹 rdd ${op}` : "🌹 rdd";
		}
		const reviewMatch = /^gentle_review(?:_([a-z0-9_-]+))?(?:\s+([a-z0-9_-]+))?/i.exec(plain);
		if (reviewMatch) {
			const op = reviewMatch[2]?.trim() || reviewMatch[1]?.trim();
			return op ? `🌹 rdd ${op}` : "🌹 rdd";
		}
	}
	if (child) {
		const toolName = (child as any).toolName;
		const args = (child as any).toolArgs ?? (child as any).args ?? (child as any).input;
		const opFromArgs =
			typeof args === "object" && args !== null
				? (args.command || args.op || args.subcommand || args.action)
				: undefined;

		if (typeof toolName === "string") {
			if (toolName === "gentle_review_capture") return "🌹 rdd capture";
			if (toolName === "gentle_review_capture_group") return "🌹 rdd capture_group";
			if (toolName === "gentle_review_scope") return "🌹 rdd scope";
			if (toolName === "gentle_review") {
				if (typeof opFromArgs === "string" && opFromArgs.trim()) {
					return `🌹 rdd ${opFromArgs.trim()}`;
				}
				return "🌹 rdd";
			}
			const subMatch = /^gentle_review_([a-z0-9_-]+)/i.exec(toolName);
			if (subMatch && subMatch[1]) {
				return `🌹 rdd ${subMatch[1]}`;
			}
		}
	}
	return "🌹 rdd";
}

/**
 * Formats lines of a subagent component (e.g. subagent_status, subagent_run):
 * Highlights agent name, task ID, status, and turn/call metrics with Dracula palette.
 */
export function formatSubagentLines(rawLines: string[], theme?: Theme): string[] {
	const lines = unwrapNativeCard(rawLines);
	if (!theme || !lines.length) return lines;

	return lines.map((line) => {
		const plain = stripAnsi(line).trim();
		if (!plain) return line;

		// 1. Tool call header: "* agent status · taskId" or "agent status · taskId"
		if (/^(?:[✿❀❁✾★✣≡⌕+☷⌖✎\u270E*]\s*)?agent\s+(?:status|run|result|reply|cancel|continue|list)/i.test(plain)) {
			const parts = plain.split("·").map((p) => p.trim());
			const action = safeFg(theme, "heading", parts[0] || "agent status", "accent");
			if (parts.length > 1) {
				const rest = parts.slice(1).map((p) => safeFg(theme, "syntaxString", p, "info")).join(safeFg(theme, "syntaxPunctuation", " · ", "muted"));
				return `${action} ${safeFg(theme, "syntaxPunctuation", "·", "muted")} ${rest}`;
			}
			return action;
		}

		// 2. Status line: "taskId · agent-name · status · mode · cwd: ... · X turns · Y tool calls · last: Z"
		if (plain.includes("·") && (plain.includes("turns") || plain.includes("tool calls") || plain.includes("running") || plain.includes("completed"))) {
			const tokens = plain.split("·").map((t) => t.trim());
			// For compact display in cards without overflowing box borders, prioritize:
			// taskId · agent · status · X turns · Y calls · last: Z
			const filtered = tokens.filter((t) => !t.startsWith("cwd:"));
			return filtered
				.map((token) => {
					if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(token)) {
						return safeFg(theme, "syntaxNumber", token, "warning"); // task id
					}
					if (token === "running" || token === "queued" || token === "waiting") {
						return safeFg(theme, "warning", `⏳ ${token}`, "warning");
					}
					if (token === "completed" || token === "finished") {
						return safeFg(theme, "success", `✔ ${token}`, "success");
					}
					if (token === "failed" || token === "error" || token === "cancelled") {
						return safeFg(theme, "error", `✖ ${token}`, "error");
					}
					if (token.includes("turns") || token.includes("tool calls")) {
						return token.replace(/\b(\d+)\b/g, (_m, num) => safeFg(theme, "syntaxNumber", num, "accent"));
					}
					if (token.startsWith("last:")) {
						const lastPart = token.slice(5).trim();
						return `${safeFg(theme, "muted", "last: ", "muted")}${safeFg(theme, "syntaxString", lastPart, "info")}`;
					}
					return safeFg(theme, "text", token, "muted");
				})
				.join(safeFg(theme, "syntaxPunctuation", " · ", "muted"));
		}

		return line;
	});
}

/**
 * Formats inner lines of an RDD / gentle_review card:
 * Preserves pre-colored output (pass/fail status, kept colors),
 * strips float chrome, and highlights structured lines.
 */
export function formatReviewOutputLines(rawLines: string[], theme?: Theme): string[] {
	const lines = unwrapNativeCard(rawLines);
	if (!theme || !lines.length) return lines;
	return lines.map((line) => {
		const plain = stripAnsi(line);
		if (plain.trim() === "") return "";
		if (hasKeptColor(line, theme)) return line;
		const leadingSpace = line.match(/^(\s*)/)?.[1] ?? "";
		const content = plain.slice(leadingSpace.length);
		if (!content) return "";
		return leadingSpace + highlightCodeLine(content, theme);
	});
}

/**
 * Formats lines inside an Engram memory card:
 * Highlights paths, URLs, quoted text, numbers, and identifiers Dracula-style
 * using theme syntax roles while preserving existing ANSI formatting.
 */
export function formatMemoryOutputLines(rawLines: string[], theme?: Theme): string[] {
	const lines = unwrapNativeCard(rawLines);
	if (!theme || !lines.length) return lines;
	return lines.map((line) => {
		const plain = stripAnsi(line);
		if (plain.trim() === "") return line;
		if (hasKeptColor(line, theme)) return line;
		const leadingSpace = line.match(/^(\s*)/)?.[1] ?? "";
		const content = plain.slice(leadingSpace.length);
		if (!content) return line;
		return leadingSpace + highlightCodeLine(content, theme);
	});
}

/**
 * Checks whether a transcript component is a subagent tool execution
 * (subagent_status, subagent_run, subagent_result, subagent_list_tasks, etc.)
 */
export function isSubagentComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	if (typeof toolName === "string" && toolName.startsWith("subagent_")) return true;
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines && lines.length > 0) {
		const plain = stripAnsi(lines[0]).trim();
		if (/^(?:[✿❀❁✾★✣≡⌕+☷⌖✎\u270E*]\s*)?agent\s+(?:status|run|result|reply|cancel|continue|list)/i.test(plain)) {
			return true;
		}
	}
	return false;
}

/**
 * Checks whether a transcript component is an agent status poll specifically.
 */
export function isAgentStatusComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	if (toolName === "subagent_status") return true;
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines && lines.length > 0) {
		const plain = stripAnsi(lines[0]).trim();
		return /^(?:[✿❀❁✾★✣≡⌕+☷⌖✎\u270E*]\s*)?agent\s+status\b/i.test(plain);
	}
	return false;
}

/**
 * Checks whether a transcript component is a memory (Engram) tool execution.
 * Engram registers every tool under the `mem_` prefix (mem_search,
 * mem_save, mem_timeline, mem_doctor, ...), so a prefix match is enough
 * and no header sniffing is needed.
 */
export function isMemoryComponent(child: Component): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	return typeof toolName === "string" && toolName.startsWith("mem_");
}

/**
 * Detects top-level Pi error lines (showError Text components):
 * lines starting with "Error:" plus known provider failure signatures
 * (auth_unavailable, Retry failed). Strict on purpose so normal assistant
 * messages that merely mention the word "error" are never wrapped.
 */
export function looksLikeErrorLines(rawLines: string[]): boolean {
	for (const line of rawLines) {
		const plain = stripAnsi(line).trim();
		if (!plain) continue;
		if (/^Error\s*:/i.test(plain)) return true;
		if (/auth_unavailable/i.test(plain)) return true;
		if (/Retry failed after/i.test(plain)) return true;
	}
	return false;
}

/**
 * Checks whether a transcript child is a plain Text error (Pi showError path:
 * `new Text(theme.fg("error", ...))` added directly to chatContainer).
 * Restricted to constructor name "Text" so AssistantMessageComponent texts
 * that merely discuss errors keep rendering naturally.
 */
export function isErrorTextComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name !== "Text") return false;
	if (renderedLines) return looksLikeErrorLines(renderedLines);
	try {
		const lines = (child as unknown as { render?: (w: number) => string[] }).render?.(80) ?? [];
		return looksLikeErrorLines(lines);
	} catch {
		return false;
	}
}

/**
 * Extensions whose diff code is safe to syntax-highlight. Prose formats
 * (markdown, plain text) are excluded so ordinary words like "for", "new"
 * or "class" never get sprinkled with keyword colors.
 */
const HIGHLIGHTABLE_EXTENSIONS = new Set([
	"ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts",
	"py", "rb", "rs", "go", "java", "kt", "swift",
	"c", "h", "cpp", "hpp", "cc", "cs", "php",
	"css", "scss", "less", "html", "xml", "vue", "svelte",
	"sh", "bash", "zsh", "fish", "sql", "json", "jsonc", "json5", "yaml", "yml", "toml",
	"graphql", "gql", "prisma", "env", "ini", "lua", "zig", "dart",
]);

/** True when the tool file path points to a highlightable code format. */
export function toolFileHighlightable(filePath: unknown): boolean {
	if (typeof filePath !== "string" || filePath.length === 0) return false;
	const clean = filePath.replace(/:\d+(?:-\d+)?$/, "");
	const ext = clean.split(".").pop()?.toLowerCase() ?? "";
	return HIGHLIGHTABLE_EXTENSIONS.has(ext);
}

/** Reads the target file path from a read/write/edit tool component's args or rendered header. */
export function toolFilePath(child: Component, renderedLines?: string[]): string | undefined {
	const args = (child as unknown as { args?: Record<string, unknown> })?.args;
	if (args && typeof args === "object") {
		const p = (args as Record<string, unknown>).path ?? (args as Record<string, unknown>).file_path;
		if (typeof p === "string" && p.length > 0) {
			return p.replace(/:\d+(?:-\d+)?$/, "");
		}
	}
	// Fallback: extract path from rendered header lines, e.g. "edit src/cute-theme.ts" or "read foo.ts:1-10"
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines && lines.length > 0) {
		const unwrapped = unwrapNativeCard(lines);
		for (const line of unwrapped) {
			const plain = stripAnsi(line ?? "").trim();
			const m = /(?:[≡✎\u270E\+]\s*)?(?:edit|write|read)\s+(\S+)/i.exec(plain);
			if (m && m[1]) {
				// Strip line ranges like ":1-10" or ":50" from read paths
				const clean = m[1].replace(/:\d+(?:-\d+)?$/, "");
				return clean;
			}
		}
	}
	return undefined;
}

const CODE_KEYWORDS =
	"const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|" +
	"import|from|export|default|new|typeof|instanceof|in|of|class|extends|implements|" +
	"interface|type|enum|public|private|protected|static|readonly|async|await|yield|" +
	"try|catch|finally|throw|this|super|void|delete|null|undefined|true|false|" +
	"def|lambda|as|with|pass|elif|except|raise|fn|mut|match|struct|impl|trait|pub|" +
	"package|func|defer|select|fallthrough|namespace|using|virtual|override|template";

const CODE_TOKEN =
	"(\\/\\/.*$)" +
	"|('(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)" +
	`|\\b(${CODE_KEYWORDS})\\b` +
	"|\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b" +
	"|([A-Za-z_$][\\w$]*)(?=\\s*\\()" +
	"|\\b([A-Z][\\w$]*)\\b";

/**
 * Dracula-style single-line code highlighter bound to the active CUTE theme's
 * `syntax*` roles (keyword pink, string green, function light-blue, number
 * orange, type gold, comment muted) so edit diffs match the native `read`
 * highlighting. Self-contained on purpose: Pi's `highlightCode` is not
 * resolvable from this package at runtime, and the passed `theme` is enough.
 * When `defaultRole` is supplied (e.g. "write"), uncolored non-token text
 * is styled with that role, enabling celeste prose with Dracula tokens.
 * Never throws and never corrupts: on any doubt the plain code is returned.
 */
export function highlightCodeLine(code: string, theme?: Theme, defaultRole?: string): string {
	if (!theme || !code) return code;
	const wrap = (s: string): string => {
		if (!defaultRole || !s || s.trim() === "") return s;
		return safeFg(theme, defaultRole, s, "text");
	};
	let out = "";
	let last = 0;
	let m: RegExpExecArray | null;
	const re = new RegExp(CODE_TOKEN, "g");
	try {
		while ((m = re.exec(code)) !== null) {
			if (m.index > last) out += wrap(code.slice(last, m.index));
			const [tok, comment, str, kw, num, fn, ty] = m;
			if (comment) out += safeFg(theme, "syntaxComment", tok, "muted");
			else if (str) out += safeFg(theme, "syntaxString", tok, "green");
			else if (kw) out += safeFg(theme, "syntaxKeyword", tok, "accent");
			else if (num) out += safeFg(theme, "syntaxNumber", tok, "warning");
			else if (fn) out += safeFg(theme, "syntaxFunction", tok, "text");
			else if (ty) out += safeFg(theme, "syntaxType", tok, "heading");
			else out += wrap(tok);
			last = m.index + tok.length;
			if (tok.length === 0) break;
		}
	} catch {
		return code;
	}
	if (last < code.length) out += wrap(code.slice(last));
	return out;
}

const WRITE_DIFF_ADDED = /^\+(\d+)\s?(.*)$/;
const WRITE_DIFF_REMOVED = /^-(\d+)\s?(.*)$/;
const WRITE_DIFF_CONTEXT = /^ (\d+)\s?(.*)$/;

/**
 * Formats edit/write diff lines for the celeste card: keeps Pi's diff prefix
 * (`+ln` / `-ln` / ` ln`) in its native diff tone so add/remove semantics stay
 * crisp, and syntax-highlights the code portion Dracula-style when the tool
 * targets a highlightable code file. Headers, hints and prose files pass
 * through untouched (preserving Pi's native colors exactly).
 */
/**
 * Formats read tool lines:
 * - Formats line numbers (e.g. "   1 │ " or "   1 ") with syntaxNumber (gold/orange) and punctuation.
 * - Highlights code content Dracula-style using theme syntax roles.
 * - Headers, hint/truncation lines, and image notes pass through.
 */
export function formatReadLines(rawLines: string[], filePath?: string, theme?: Theme): string[] {
	const lines = unwrapNativeCard(rawLines);
	if (!theme || !toolFileHighlightable(filePath)) return lines;
	let headerHandled = false;
	return lines.map((line) => {
		const plain = stripAnsi(line);
		const trimmed = plain.trim();
		if (!trimmed) return "";

		// 1. Tool call header: `read path/to/file` or `≡ read path/to/file` or `✎ read ...`
		if (!headerHandled && /^(?:[≡✎\u270E\+]\s*)?read\s+\S+/i.test(trimmed)) {
			headerHandled = true;
			return line;
		}

		// 2. Hint / expansion / status lines
		if (
			trimmed.startsWith("ctrl+o") ||
			trimmed.includes("to expand") ||
			trimmed.startsWith("...") ||
			trimmed.startsWith("[Truncated")
		) {
			return line;
		}

		// 3. Check for line number prefix formats emitted by Pi or tools:
		// e.g. "   1 │ code" or "   1 : code" or "   1 code"
		const m = /^(\s*\d+)(?:\s+([│:])\s*|\s+)(.*)$/.exec(plain);
		if (m) {
			const lineNum = m[1];
			const sep = m[2];
			const code = m[3] ?? "";
			const styledNum = safeFg(theme, "syntaxNumber", lineNum, "warning");
			const styledSep = sep ? ` ${safeFg(theme, "syntaxPunctuation", sep, "muted")} ` : " ";
			const highlighted = highlightCodeLine(code, theme);
			return `${styledNum}${styledSep}${highlighted}`;
		}

		// 4. Normal code lines without line numbers: highlight Dracula preserving indentation
		const leadingSpace = plain.match(/^(\s*)/)?.[1] ?? "";
		const code = plain.slice(leadingSpace.length);
		if (!code) return line;
		return leadingSpace + highlightCodeLine(code, theme);
	});
}

export function formatWriteDiffLines(
	rawLines: string[],
	filePath?: string,
	theme?: Theme,
	toolName?: string,
): string[] {
	const lines = unwrapNativeCard(rawLines);
	if (!theme || !toolFileHighlightable(filePath)) return lines;

	const isEditTool = toolName === "edit";
	let headerHandled = false;

	return lines.map((line) => {
		const plain = stripAnsi(line);
		const trimmed = plain.trim();
		if (!trimmed) return "";

		// 1. Tool call header: `write path/to/file` or `edit path/to/file`
		if (!headerHandled && /^(?:[≡✎\u270E\+]\s*)?(?:write|edit)\s+\S+/i.test(trimmed)) {
			headerHandled = true;
			return line;
		}

		// 2. Highlight collapsed summary lines like "✓ +2 / -2" or "+10 / -0"
		if (/^✓?\s*\+\d+\s*\/\s*-\d+/.test(trimmed)) {
			return line.replace(/^(\s*✓?\s*)(\+\d+)\s*\/\s*(-\d+)/, (_, check, added, removed) => {
				const checkStyled = check.includes("✓") ? safeFg(theme, "success", check, "green") : check;
				const addStyled = safeFg(theme, "toolDiffAdded", added, "green");
				const slash = safeFg(theme, "syntaxPunctuation", " / ", "muted");
				const remStyled = safeFg(theme, "toolDiffRemoved", removed, "red");
				return `${checkStyled}${addStyled}${slash}${remStyled}`;
			});
		}

		// 3. Hint / expansion / status lines
		if (
			trimmed.startsWith("ctrl+o") ||
			trimmed.includes("to expand") ||
			trimmed.startsWith("...") ||
			trimmed.startsWith("[Truncated")
		) {
			return line;
		}

		// 4. In edit mode (or when diff prefixes are present):
		// Match diff added (+...), removed (-...), or diff context with line number ( 123 ...)
		if (isEditTool || toolName !== "write") {
			const diffLineMatch = /^([+-])(?:\s*(\d+))?\s?(.*)$/.exec(plain);
			if (diffLineMatch) {
				const sym = diffLineMatch[1];
				const lineNum = diffLineMatch[2];
				const code = diffLineMatch[3] ?? "";
				const tone = sym === "+" ? "toolDiffAdded" : "toolDiffRemoved";
				const prefix = lineNum ? `${sym}${lineNum} ` : `${sym} `;
				const highlighted = highlightCodeLine(code, theme);
				return safeFg(theme, tone, prefix, "muted") + highlighted;
			}

			const contextMatch = /^(\s+)(\d+)\s(.*)$/.exec(plain);
			if (contextMatch) {
				const spaces = contextMatch[1];
				const lineNum = contextMatch[2];
				const code = contextMatch[3] ?? "";
				const prefix = `${spaces}${lineNum} `;
				const highlighted = highlightCodeLine(code, theme);
				return safeFg(theme, "toolDiffContext", prefix, "muted") + highlighted;
			}
		}

		// 5. Normal code lines (for write tool, or non-diff lines in edit):
		// Preserve leading whitespace and highlight code Dracula-style
		const leadingSpace = plain.match(/^(\s*)/)?.[1] ?? "";
		const code = plain.slice(leadingSpace.length);
		if (!code) return line;
		return leadingSpace + highlightCodeLine(code, theme);
	});
}

/**
 * ANSI background color escape sequences (\x1b[48;...m and \x1b[49m)
 * that leak from gentle-shell float cards.
 */
export const BG_ESCAPE_RE = /\x1b\[(?:48;[0-9;]*|49)m/g;

/**
 * Trailing interactive key hints appended to tool headers (e.g. "ctrl+o to expand", "ctrl+o to collapse").
 */
export const KEY_HINT_TRAILING_RE = /\s*(?:(?:ctrl|cmd|alt|opt|meta)\+[a-z0-9]+|\S+)?\s*to\s+(?:expand|collapse)\s*$/i;

/**
 * Strips background fill ANSI escapes (\x1b[48;...m and \x1b[49m) that leak from float cards.
 */
export function stripBackgroundAnsi(text: string): string {
	return text.replace(BG_ESCAPE_RE, "");
}

/**
 * Extracts the title / command from a native or quiet-tools card top border.
 * e.g. "╭─ ✿ $ npm test ───────────── ctrl+o to expand ╮" -> "$ npm test"
 *      "╭─ ✿ edit /path/to/file ───── ctrl+o to expand ╮" -> "edit /path/to/file"
 *      "╭─ ≡ read /path/to/file ───── ctrl+o to expand ╮" -> "read /path/to/file"
 */
export function extractCardHeaderTitle(headerLine: string): string {
	const plain = stripAnsi(headerLine).trim();
	let title = plain.replace(/^[╭┌][─═\s]*(?:[✿❀❁✾✣✎★≡⌕+☷⌖$]\s*)?/, "");
	title = title.replace(/\s*[─═]{2,}.*$/, "").replace(/[╮┐]$/, "").trim();
	title = title.replace(KEY_HINT_TRAILING_RE, "").trim();
	return title;
}

/**
 * Strips leading/trailing vertical card borders (│, ║, |) and surrounding ANSI escapes
 * from a card body line so inner content nests cleanly inside CUTE frames.
 */
export function stripCardLineBorders(line: string): string {
	let s = line.replace(BG_ESCAPE_RE, "");
	s = s.replace(/^((?:\x1b\[[0-9;]*m)*)\s*[│║|]((?:\x1b\[[0-9;]*m)*)\s?/, "");
	s = s.replace(/\s?((?:\x1b\[[0-9;]*m)*)[│║|]((?:\x1b\[[0-9;]*m)*)\s*$/, "");
	return s.trimEnd();
}

/**
 * Checks whether a line represents a tool call header line.
 */
export function isToolHeaderLine(line: string): boolean {
	const plain = stripAnsi(line).trim();
	if (!plain) return false;
	if (/^(?:\$\s*)?bash\s+\$/i.test(plain) || /^\$\s+\S/.test(plain)) return true;
	if (/(?:🌹\s*)?rdd\b/i.test(plain) || /^gentle_review(?:_|\b)/i.test(plain)) return true;
	if (/^(?:[≡⌕✎+⌖☷✿❀❁✾★✣\u270E$🌹*]\s*)?(?:read|write|edit|grep|find|ls|fetch|search|bash|rdd|gentle_review|agent)\b/i.test(plain)) return true;
	return false;
}

/**
 * Checks whether a line is a blank float card padding line
 * (e.g. contains only whitespace, block rails like ▎, or background escapes).
 */
export function isBlankFloatLine(line: string): boolean {
	const stripped = stripAnsi(line.replace(BG_ESCAPE_RE, "")).trim();
	return stripped === "" || /^[▎▏▍▌▋▊▉█│║|]$/.test(stripped);
}

/**
 * Checks whether an array of lines represents an ASCII art block, banner, or logo
 * rather than a tool float card or simple text.
 * Art banners typically contain:
 * - Specific banner text signatures (e.g. "N e k o - p i", "neko-banner", logo names)
 * - Dense 2x2 subpixel block elements (▀, ▄, █, ▌, ▐, ▘, ▝, ▖, ▗, ▚, ▞, ▛, ▜, ▙, ▟)
 *   used as graphic canvas pixels across multiple columns, rather than single-column vertical card rails (│, ║, ▎, ▏).
 */
export function isAsciiArtOrBanner(lines: string[]): boolean {
	if (!lines || lines.length === 0) return false;

	// 1. Signature check: known banners, custom partner/brand banners, or explicit logo titles
	const combinedPlain = lines.map((l) => stripAnsi(l)).join("\n");
	const strings = loadCuteStrings();
	const partner = strings.sidebarBanner?.partner?.trim();
	const brand = strings.sidebarBanner?.brand?.trim();

	if (partner && partner.length > 2) {
		const escapedPartner = partner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (new RegExp(escapedPartner, "i").test(combinedPlain)) {
			return true;
		}
	}
	if (brand && brand.length > 2) {
		const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (new RegExp(escapedBrand, "i").test(combinedPlain)) {
			return true;
		}
	}

	if (
		/neko[-_]?banner|neko[-_]?pi/i.test(combinedPlain) ||
		/N\s*e\s*k\s*o\s*-\s*p\s*i/i.test(combinedPlain) ||
		/banner|ascii[-_]?art/i.test(combinedPlain)
	) {
		return true;
	}

	// 2. Structural graphic check:
	// A float card uses ▎ or ▏ as a 1-character left border rail.
	// Dense ASCII art / subpixel drawings have MULTIPLE block characters in single lines (e.g. ▄█▀▌).
	let denseArtLines = 0;
	for (const line of lines) {
		const plain = stripAnsi(line);
		// Count block characters in this line
		const blockMatches = plain.match(/[▀▄█▌▐▘▝▖▗▚▞▛▜▙▟]/g);
		if (blockMatches && blockMatches.length >= 3) {
			denseArtLines++;
		}
	}

	// If at least 3 lines have dense multi-block graphic drawing characters, it's an art/banner canvas!
	return denseArtLines >= 3;
}

/**
 * Checks whether an array of lines carries gentle-shell float card chrome.
 */
export function hasFloatChrome(lines: string[]): boolean {
	if (isAsciiArtOrBanner(lines)) return false;
	return lines.some((line) => {
		const plain = stripAnsi(line).trim();
		return /^[▎▏▍▌▋▊▉█]/.test(plain) || /\x1b\[48;[0-9;]*m/.test(line);
	});
}

/**
 * Checks whether an array of lines carries outline card borders.
 */
export function hasOutlineChrome(lines: string[]): boolean {
	return lines.some((line) => {
		const plain = stripAnsi(line).trim();
		return /^[╭┌].*[╮┐]$/.test(plain) || /^[╰└].*[╯┘]$/.test(plain);
	});
}

const RAIL_CHARS = "▎▏▍▌▋▊▉█│║|";

// Cache to avoid repeatedly unwrapping immutable message lines on every render tick
const unwrapCache = new WeakMap<string[], string[]>();

/**
 * Strips leading rail (▎ or other block rail), trailing padding/rail, and leaking background ANSI
 * from a float card line.
 */
export function stripFloatLineChrome(line: string): string {
	let s = line.replace(BG_ESCAPE_RE, "");

	// Fast-path: only perform rail stripping if the line actually contains rail characters
	let hasRail = false;
	for (let i = 0; i < RAIL_CHARS.length; i++) {
		if (s.includes(RAIL_CHARS[i])) {
			hasRail = true;
			break;
		}
	}

	if (hasRail) {
		// Strip leading rail without nested quantifier explosion
		s = s.replace(/^\s*(?:\x1b\[[0-9;]*m)*\s*[▎▏▍▌▋▊▉█│║|](?:\x1b\[[0-9;]*m)*\s?/, "");

		// Strip trailing rail and padding linearly and deterministically (no ReDoS)
		s = s.trimEnd();
		s = s.replace(/[▎▏▍▌▋▊▉█│║|](?:\x1b\[[0-9;]*m)*$/, "");
		s = s.replace(/(?:\x1b\[[0-9;]*m|\s)+$/, "");
	}

	// Strip trailing key hint if present on a tool header
	if (isToolHeaderLine(s)) {
		s = s.replace(KEY_HINT_TRAILING_RE, "");
	}
	return s.trimEnd();
}

/**
 * Strips gentle-shell float card chrome and native outline card frames
 * (╭─ ..., │ ..., ╰─ ..., ▎ ...) and leaking background ANSI escapes
 * so inner content nests cleanly without double borders or color bleeds.
 */
export function unwrapNativeCard(lines: string[]): string[] {
	if (!lines || lines.length === 0) return [];

	const cached = unwrapCache.get(lines);
	if (cached) return cached;

	// Protect ASCII art, animations, and banner components from being stripped or deformed
	if (isAsciiArtOrBanner(lines)) {
		unwrapCache.set(lines, lines);
		return lines;
	}

	// Gentle AI notice / lifecycle cards (review start, consent, binary override)
	// are handled specifically by transformTranscriptLines and unifyCardFrame.
	if (lines.some((line) => {
		const plain = stripAnsi(line);
		const isRdd = /(?:🌹\s*)?rdd\b/i.test(plain) || /^gentle_review(?:_|\b)/i.test(plain);
		const hasGentleTitle = !isRdd && (plain.includes("Gentle AI") || plain.includes("🤖") || /[\u{1F339}\uFE0E🌹🌷]/u.test(plain));
		return (plain.includes("╭") || plain.includes("╔")) && hasGentleTitle;
	})) {
		unwrapCache.set(lines, lines);
		return lines;
	}

	// Step 1: Strip background fill ANSI escapes that leak from float cards
	const cleanedBg = lines.map((line) => line.replace(BG_ESCAPE_RE, ""));

	// Step 2: Unwrap outline card framing if present
	let workingLines = cleanedBg;
	if (hasOutlineChrome(cleanedBg)) {
		const outlineResult: string[] = [];
		let inCard = false;
		for (const line of cleanedBg) {
			const plain = stripAnsi(line).trim();
			if (/^[╭┌].*[╮┐]$/.test(plain)) {
				inCard = true;
				const title = extractCardHeaderTitle(line);
				if (title) outlineResult.push(title);
				continue;
			}
			if (/^[╰└].*[╯┘]$/.test(plain)) {
				inCard = false;
				continue;
			}
			if (inCard) {
				outlineResult.push(stripCardLineBorders(line));
			} else {
				outlineResult.push(line);
			}
		}
		workingLines = outlineResult;
	}

	// Step 3: Unwrap float card chrome (▎ rails, margins, blank float padding lines)
	if (hasFloatChrome(workingLines)) {
		const floatResult: string[] = [];
		for (const line of workingLines) {
			if (isBlankFloatLine(line)) {
				floatResult.push("");
			} else {
				floatResult.push(stripFloatLineChrome(line));
			}
		}

		// Drop leading blank float padding lines
		let start = 0;
		while (start < floatResult.length && floatResult[start].trim() === "") {
			start++;
		}
		// Drop trailing blank float padding lines
		let end = floatResult.length;
		while (end > start && floatResult[end - 1].trim() === "") {
			end--;
		}

		const trimmed = floatResult.slice(start, end);

		// Drop intermediate blank padding line between header and body if present
		if (trimmed.length > 1 && isToolHeaderLine(trimmed[0]) && trimmed[1].trim() === "") {
			trimmed.splice(1, 1);
		}

		unwrapCache.set(lines, trimmed);
		return trimmed;
	}

	unwrapCache.set(lines, workingLines);
	return workingLines;
}

const BASH_HEADER_VARIANTS_RE = /^(?:\$\s*)?(?:bash\s+\$\s+)(.*)$/i;
const BASH_STANDARD_HEADER_RE = /^(\$\s+)(.*)$/;

/**
 * Extracts the clean command from a bash header line, normalizing
 * "$ bash $ <cmd>", "bash $ <cmd>", or "$ <cmd>" and stripping any trailing key hints.
 */
export function extractBashCommand(line: string): string | undefined {
	const plain = stripAnsi(line).trim();
	const m1 = BASH_HEADER_VARIANTS_RE.exec(plain);
	if (m1) {
		return m1[1].replace(KEY_HINT_TRAILING_RE, "").trim();
	}
	const m2 = BASH_STANDARD_HEADER_RE.exec(plain);
	if (m2) {
		return m2[2].replace(KEY_HINT_TRAILING_RE, "").trim();
	}
	return undefined;
}

/**
 * Normalizes a bash header line back to "$ <command>".
 */
export function normalizeBashHeader(line: string): string {
	const cmd = extractBashCommand(line);
	if (cmd !== undefined) {
		return `$ ${cmd}`;
	}
	return line;
}

/**
 * Strips empty lines and horizontal border divider lines (e.g. ─── or ═══)
 * from raw bash component output so it nests cleanly inside our card.
 */
export function cleanBashLines(rawLines: string[]): string[] {
	const unwrapped = unwrapNativeCard(rawLines);
	return unwrapped
		.map((line) => normalizeBashHeader(line))
		.filter((line) => {
			const plain = stripAnsi(line).trim();
			if (plain === "") return false;
			if (/^[─═\-]+$/.test(plain)) return false;
			return true;
		});
}

/**
 * Extracts the displayed file path from a bash `$` header when the command
 * simply dumps a file (`cat`, `bat`, `head`, `tail`, `less`, `more`).
 * Returns undefined for any other command shape.
 */
/**
 * Interpreters whose `<<'EOF'` heredoc body is code worth highlighting.
 * Shells are included per user override (2026-09-15): Cinlo asked for
 * Dracula in bash too, accepting that echo prose may pick up keyword colors.
 */
const HEREDOC_CODE_COMMANDS = new Set([
	"python", "python3", "node", "nodejs", "ruby", "perl", "php",
	"deno", "bun", "tsx", "ts-node",
]);

/** Shell interpreters whose heredoc bodies also get Dracula highlighting. */
const HEREDOC_SHELL_COMMANDS = new Set([
	"sh", "bash", "zsh", "fish", "shell", "dash", "ksh",
]);

export interface BashHeredoc {
	delimiter: string;
	interpreter: string;
	target?: string;
}

/**
 * Detects a `<<'EOF'`-style heredoc in a bash `$` header line.
 * Captures the delimiter, the interpreter (first command word) and, for
 * `cat > file <<'EOF'` writes, the redirect target file.
 */
export function extractHeredoc(headerLine: string): BashHeredoc | undefined {
	const m = /<<-?\s*['"]?(\w+)['"]?/.exec(headerLine);
	if (!m) return undefined;
	const cmd = headerLine.trim().replace(/^\$\s*/, "");
	const interpreter = cmd.split(/\s+/)[0] ?? "";
	const target = /\d*>\s*(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))/.exec(cmd);
	return {
		delimiter: m[1],
		interpreter,
		target: target?.[1] ?? target?.[2] ?? target?.[3],
	};
}

/** Best-effort foreground ANSI for a theme role (undefined when unavailable). */
function themeRoleAnsi(theme: Theme | undefined, role: string): string | undefined {
	try {
		return theme?.getFgAnsi(role as never) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * True when the line carries colors that must be preserved verbatim (diff
 * green/red, native syntax highlighting, tool results, ...). Bare command-echo
 * pink (`bashMode`), bold markers, resets and the plain white/muted/dim roles
 * do NOT count as kept colors, so heredoc bodies and plain output stay eligible
 * for Dracula highlighting / terracotta styling.
 */
export function hasKeptColor(line: string, theme?: Theme): boolean {
	let s = line;
	const neutral: Array<string | undefined> = [
		themeRoleAnsi(theme, "bashMode"),
		themeRoleAnsi(theme, "text"),
		themeRoleAnsi(theme, "muted"),
		themeRoleAnsi(theme, "dim"),
	];
	for (const open of neutral) {
		if (open) s = s.split(open).join("");
	}
	// Fallback for themes without getFgAnsi (tests) and 256-color terminals:
	// strip CUTE's known plain-role sequences.
	s = s.replace(/\x1b\[38;2;(?:240;149;200|246;239;243|167;142;155|118;97;107)m/g, "");
	// Strip bold markers and bare resets.
	s = s.replace(/\x1b\[(?:1|22|39|49|0)m/g, "");
	// Basic 30-37 foreground colors still count as kept (diffs, errors, ...).
	return /\x1b\[[0-9;]*[a-zA-Z]/.test(s);
}

export function extractBashDisplayPath(headerLine: string): string | undefined {
	const m = /^\$\s*(?:cat|bat|head|tail|less|more)(?:\s+(?:-\S+|\d+))*\s+(?:"([^"]+)"|'([^']+)'|([^\s|><;&]+))/.exec(headerLine.trim());
	if (!m) return undefined;
	return m[1] ?? m[2] ?? m[3];
}

/**
 * Formats a `$ ...` bash command header: keeps the leading `$` in pink
 * (`bashMode`) and highlights the command itself Dracula-style.
 * Normalizes gentle-shell variants ("$ bash $ <cmd>", "bash $ <cmd>")
 * and strips trailing key hints ("ctrl+o to expand").
 * Falls back to the original line when no theme is available.
 */
export function formatBashCommandHeader(line: string, theme?: Theme): string {
	const cmd = extractBashCommand(line);
	if (cmd === undefined) {
		if (!theme) return line;
		const plain = stripAnsi(line);
		const m = /^(\s*\$\s?)(.*)$/.exec(plain);
		if (!m) return line;
		const prefix = m[1] ?? "$ ";
		const rest = m[2] ?? "";
		if (!rest) return line;
		return safeFg(theme, "bashMode", prefix, "pink") + highlightCodeLine(rest, theme);
	}
	if (!cmd) {
		return theme ? safeFg(theme, "bashMode", "$", "pink") : "$";
	}
	if (!theme) return `$ ${cmd}`;
	return safeFg(theme, "bashMode", "$ ", "pink") + highlightCodeLine(cmd, theme);
}

/**
 * Formats the lines inside a bash card:
 * - Frame (`>_ bash` border) keeps the terracotta/sunset tone via colors.bashMessage.
 * - Everything inside (command header, code dumps, heredocs, plain output)
 *   gets the same Dracula-style highlighting as read/write cards.
 * - Preserves lines with real colors (diff green/red, native highlighting, ...).
 *   Bare command-echo pink and white/muted/dim do not count as kept colors.
 */
export function formatBashOutputLines(
	lines: string[],
	theme?: Theme,
	colorKey = "bashOutput",
): string[] {
	if (!lines.length) return lines;
	const unwrapped = unwrapNativeCard(lines);
	const color = (s: string): string => (theme ? safeFg(theme, colorKey, s) : `\x1b[38;2;142;197;166m${s}\x1b[39m`);

	// Tracks whether the current `$` section is highlightable code (a `cat`-style
	// file dump or a code-interpreter heredoc) plus the heredoc terminator.
	let highlightMode = false;
	let heredocEnd: string | undefined;
	return unwrapped.map((line) => {
		const plain = stripAnsi(line);
		const trimmed = plain.trim();
		if (trimmed === "") return line;

		// 1. Heredoc terminator (e.g. `EOF`) closes code mode; it stays pink
		// as part of the command echo.
		if (heredocEnd && trimmed === heredocEnd) {
			highlightMode = false;
			heredocEnd = undefined;
			return line;
		}

		// 2. Command header line ($ ...) gets Dracula highlighting on the command,
		// keeping `$` pink, and decides whether the lines that follow are
		// highlightable code or plain output.
		const bashCmd = extractBashCommand(line);
		if (bashCmd !== undefined || trimmed.startsWith("$") || plain.trimStart().startsWith("$ ")) {
			const normalizedHeader = bashCmd !== undefined ? `$ ${bashCmd}` : line;
			const normTrimmed = stripAnsi(normalizedHeader).trim();
			const heredoc = extractHeredoc(normTrimmed);
			if (heredoc && (HEREDOC_CODE_COMMANDS.has(heredoc.interpreter) || HEREDOC_SHELL_COMMANDS.has(heredoc.interpreter) || toolFileHighlightable(heredoc.target))) {
				highlightMode = true;
				heredocEnd = heredoc.delimiter;
			} else {
				highlightMode = toolFileHighlightable(extractBashDisplayPath(normTrimmed));
				heredocEnd = undefined;
			}
			return formatBashCommandHeader(normalizedHeader, theme);
		}

		// 3. Lines with real colors (diff green/red, native highlighting, ...)
		// are preserved verbatim. Bare command-echo pink and white/muted/dim
		// stay eligible for highlighting / terracotta styling below.
		if (hasKeptColor(line, theme)) {
			return line;
		}

		// 4. Code sections (`cat` dumps, code/shell heredocs) get Dracula highlighting.
		if (highlightMode && theme) {
			const leadingSpace = plain.match(/^(\s*)/)?.[1] ?? "";
			const code = plain.slice(leadingSpace.length);
			if (!code) return line;
			return leadingSpace + highlightCodeLine(code, theme);
		}

		// 5. Plain output also gets Dracula highlighting (no terracotta wash inside).
		// When there is no theme, fall back to the terracotta color.
		if (theme) return highlightCodeLine(plain, theme);
		return color(plain);
	});
}

/**
 * Highlights plain uncolored text segments inside a line that may already
 * contain ANSI sequences (like markdown bold, links, list markers, OSC 133 semantic zones).
 * Preserves text that is already styled with foreground color or control escapes,
 * and passes plain text through the highlighter function.
 */
export function highlightUncoloredSegments(line: string, highlightFn: (text: string) => string): string {
	const ANSI_SPLIT = /(\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x1b]*(?:\x1b\\|\x07)|\x1b_[^\x1b]*\x1b\\)/g;
	const parts = line.split(ANSI_SPLIT);
	let hasActiveColor = false;
	let out = "";

	for (const part of parts) {
		if (!part) continue;
		if (ESCAPE_ATOM_SINGLE.test(part)) {
			if (/\x1b\[38;2;|\x1b\[3[0-7]m/.test(part)) {
				hasActiveColor = true;
			} else if (/\x1b\[39m|\x1b\[0m/.test(part)) {
				hasActiveColor = false;
			}
			out += part;
			continue;
		}

		if (hasActiveColor) {
			out += part;
		} else {
			out += highlightFn(part);
		}
	}
	return out;
}

/**
 * Formats git status and diff stat lines inside fenced code blocks in Dracula tones.
 */
export function formatGitBlockLine(line: string, theme: Theme): string {
	const plain = stripAnsi(line);

	// 1. On branch <branch>
	const branchMatch = /^(\s*On branch\s+)(\S+)(.*)$/.exec(plain);
	if (branchMatch) {
		return `${safeFg(theme, "dim", branchMatch[1])}${safeFg(theme, "write", branchMatch[2])}${safeFg(theme, "dim", branchMatch[3])}`;
	}

	// 2. Status headings & clean tree
	if (/^\s*(Changes to be committed|Changes not staged for commit|Untracked files):/i.test(plain)) {
		return safeFg(theme, "heading", line);
	}
	if (/^\s*nothing to commit,\s*working tree clean/i.test(plain)) {
		return safeFg(theme, "mint", line, "green");
	}

	// 3. Git status file entries
	const fileStatusMatch = /^(\s*)(modified|deleted|new file|renamed):\s+(\S+.*)$/.exec(plain);
	if (fileStatusMatch) {
		const indent = fileStatusMatch[1];
		const kind = fileStatusMatch[2];
		const filePath = fileStatusMatch[3];
		const kindRole = kind === "new file" ? "mint" : kind === "deleted" ? "red" : "warning";
		const fallbackTone = kind === "new file" ? "green" : kind === "deleted" ? "error" : "warning";
		return `${indent}${safeFg(theme, kindRole, kind + ":", fallbackTone)}   ${safeFg(theme, "write", filePath)}`;
	}

	// 4. Git hint lines: (use "git add ..." ...)
	if (/^\s*\((?:use "git|use 'git).*?\)\s*$/.test(plain)) {
		return safeFg(theme, "dim", line);
	}

	// 5. Diff stat line: path/file.ts | 42 ++++----
	const diffStatMatch = /^(\s*)([^\s|]+(?:\s+[^\s|]+)*)(\s+\|\s+)(\d+)(\s+)([+\-]+)$/.exec(plain);
	if (diffStatMatch) {
		const indent = diffStatMatch[1];
		const filePath = diffStatMatch[2];
		const bar = diffStatMatch[3];
		const num = diffStatMatch[4];
		const sp = diffStatMatch[5];
		const plussesMinuses = diffStatMatch[6];
		const coloredBars = plussesMinuses
			.replace(/\+/g, safeFg(theme, "mint", "+", "green"))
			.replace(/-/g, safeFg(theme, "red", "-", "error"));
		return `${indent}${safeFg(theme, "write", filePath)}${safeFg(theme, "dim", bar)}${safeFg(theme, "syntaxNumber", num, "warning")}${sp}${coloredBars}`;
	}

	// 6. Diff summary line: 3 files changed, 44 insertions(+), 40 deletions(-)
	if (/^\s*\d+\s+files?\s+changed/.test(plain)) {
		return plain
			.replace(/(\d+)(\s+files?\s+changed)/, (_, n, rest) => `${safeFg(theme, "syntaxNumber", n, "warning")}${rest}`)
			.replace(/(\d+)(\s+insertions?\(\+\))/, (_, n, rest) => safeFg(theme, "mint", `${n}${rest}`, "green"))
			.replace(/(\d+)(\s+deletions?\(-\))/, (_, n, rest) => safeFg(theme, "red", `${n}${rest}`, "error"));
	}

	return line;
}

/**
 * Formats assistant prose:
 * - Headings get a slightly heavier typeface (bold, gold).
 * - Body text receives celeste `write` tone on uncolored segments,
 *   preserving markdown bold (pinkBright), inline code (mint), links, and lists intact.
 * - Horizontal rules (--- / ───) receive theme border tone.
 * - Git status and git diff lines inside fenced code blocks receive rich Dracula colors.
 */
export function formatAssistantProse(rawLines: string[], theme?: Theme, width = 80): string[] {
	if (!theme || !rawLines.length) return rawLines;
	let inFence = false;
	const out: string[] = [];

	for (const line of rawLines) {
		const plain = stripAnsi(line);
		const isFence = /^\s*```/.test(plain);

		if (isFence) {
			inFence = !inFence;
			out.push(line);
			continue;
		}

		// Inside fenced code block
		if (inFence) {
			const styledGit = formatGitBlockLine(line, theme);
			out.push(styledGit);
			continue;
		}

		if (plain.trim() === "") {
			out.push(line);
			continue;
		}

		// Horizontal rule divider (---, ***, or ───)
		if (/^\s*[─\-*_]{3,}\s*$/.test(plain)) {
			out.push(safeFg(theme, "border", line));
			continue;
		}

		if (/^\s*#{1,6}\s+\S/.test(plain)) {
			out.push(bolden(theme, line));
			continue;
		}

		// Style plain uncolored text in celeste `write` tone, while leaving
		// already-colored markdown elements (bold pink, code mint, links) completely intact.
		out.push(
			highlightUncoloredSegments(line, (text) => {
				if (!text || text.trim() === "") return text;
				return safeFg(theme, "write", text, "text");
			}),
		);
	}

	return out;
}

/**
 * Wraps a tool component framed with a box so that mouse clicks anywhere
 * on the box (including top/bottom borders and inner body) map correctly
 * to the underlying component's click/expand handlers.
 */
class FramedCardMouseProxy implements Component {
	private target: Component;
	private boxHeight: number;

	constructor(target: Component, boxHeight: number) {
		this.target = target;
		this.boxHeight = boxHeight;
	}

	render(_width: number): string[] {
		return [];
	}

	handleMouse(event: any): any {
		if (typeof (this.target as any).handleMouse !== "function") return undefined;
		// Top border (row 0) or bottom border (row boxHeight - 1):
		// map to row 0 or 1 of child so clicking anywhere on the frame triggers expansion!
		let mappedY = event.y - 1;
		if (event.y === 0) mappedY = 0;
		else if (event.y >= this.boxHeight - 1) mappedY = Math.max(0, this.boxHeight - 3);

		return (this.target as any).handleMouse({
			...event,
			y: mappedY,
			height: Math.max(1, this.boxHeight - 2),
		});
	}
}

/**
 * Format a transcript child component:
 * Frames user messages in the CUTE golden box with ❀, bash executions
 * in the sunset orange box with >_ bash, while allowing
 * other components (assistant messages, non-bash tools) to render naturally.
 */
export function formatTranscriptChild(
	child: Component,
	width: number,
	theme?: Theme,
): string[] {
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	const strings = loadCuteStrings();
	const colors = loadCuteColors();
	const user = strings.welcomePersona.user || detectSystemUser();

	// User Message (configurable via colors.userMessage, default 'heading' / #E0C27A)
	if (name === "UserMessageComponent") {
		const rawLines = child.render(width - 4);
		return frameCategoryBox(rawLines, `❀ ${user}`, colors.userMessage, width, theme);
	}

	// Bash execution (single child fallback)
	if (isBashComponent(child)) {
		const rawLines = child.render(width - 4);
		const cleaned = cleanBashLines(rawLines);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatBashOutputLines(cleaned.length ? cleaned : unwrapped, theme, colors.bashOutput);
		return frameCategoryBox(styled, ">_ bash", colors.bashMessage, width, theme);
	}

	// Read tool execution in soft lilac card (#C5A3E0 / colors.readMessage)
	// with Dracula-style syntax highlighting for code lines.
	if (isReadComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatReadLines(unwrapped, toolFilePath(child, unwrapped), theme);
		return frameCategoryBox(styled, "\u270E read", colors.readMessage, width, theme);
	}

	// Write / edit tool execution in barely-blue card (#A5CBE8 / colors.writeMessage)
	// with Dracula-style syntax highlighting inside diff lines.
	if (isWriteComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatWriteDiffLines(unwrapped, toolFilePath(child, unwrapped), theme, (child as any).toolName);
		return frameCategoryBox(styled, "\u270E write", colors.writeMessage, width, theme);
	}

	// Fetch tool execution in pink card (#F095C8 / colors.fetchMessage).
	// Inner lines pass through untouched so the native dark tool background
	// (toolSuccessBg) is preserved; only the double-line frame is added.
	if (isFetchComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "fetch", colors.fetchMessage, width, theme);
	}

	// Search tool execution in dusty-rose card (#D7A0B8 / colors.searchMessage).
	// Softer sibling of the fetch pink so adjacent search/fetch blocks
	// stay distinguishable; inner dark background preserved untouched.
	if (isSearchComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "search", colors.searchMessage, width, theme);
	}

	// Review tool (RDD) execution in gentle tone (#a46db5 / colors.reviewMessage).
	if (isReviewComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const title = extractReviewHeader(unwrapped, child);
		const styled = formatReviewOutputLines(unwrapped, theme);
		return frameCategoryBox(styled, title, colors.reviewMessage ?? "gentle", width, theme);
	}

	// Memory (Engram) tool execution in salmon card (#F0978A / colors.memoryMessage)
	// with Dracula-style token highlighting inside.
	// Single-child fallback; consecutive memory calls are grouped into one
	// card by formatTranscriptChildren.
	if (isMemoryComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatMemoryOutputLines(unwrapped, theme);
		return frameCategoryBox(styled, "🧠 engram", colors.memoryMessage, width, theme);
	}

	// Subagent tool execution in cute cyan/accent card (colors.agentMessage / #8BE9FD)
	if (isSubagentComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatSubagentLines(unwrapped, theme);
		return frameCategoryBox(styled, "🤖 subagent", colors.agentMessage ?? "accent", width, theme);
	}

	// Grep tool execution without bounding box, but with full Dracula-style
	// syntax highlighting on matches, line numbers, and file paths.
	if (isGrepComponent(child)) {
		const rawLines = child.render(width);
		const unwrapped = unwrapNativeCard(rawLines);
		return formatGrepLines(unwrapped, theme);
	}

	// Top-level Pi error Text in coral card (same tone as error typography / colors.errorMessage)
	if (isErrorTextComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "\u26A0 error", colors.errorMessage, width, theme);
	}

	// Assistant prose renders free (no card) with bolder headings and celeste
	// body text; other components pass through transformTranscriptLines
	// so Gentle AI cards (review start/consent/completed), warning notices,
	// and tools adopt double lines, the robot glyph 🤖 and themed tones.
	if (name === "AssistantMessageComponent") {
		const rawLines = child.render(width);
		return formatAssistantProse(rawLines, theme, width);
	}
	const rawLines = child.render(width);
	const unwrapped = unwrapNativeCard(rawLines);
	return transformTranscriptLines(unwrapped, theme);
}

/**
 * Formats a list of transcript children with intelligent grouping:
 * - Groups consecutive bash executions into ONE SINGLE unified sunset orange card.
 * - Formats user messages with the golden user box.
 * - Frames read executions in soft lilac and write/edit in barely-blue.
 * - Frames fetch executions in pink (same tone as fetch title text).
 * - Frames search executions in dusty rose (softer sibling of fetch pink).
 * - Groups consecutive memory (Engram) calls into ONE single salmon card (🧠 engram).
 * - Groups consecutive top-level error Texts into ONE SINGLE coral card.
 * - Passes other components through transformTranscriptLines.
 */
export function formatTranscriptChildren(
	children: Component[],
	width: number,
	theme?: Theme,
): { lines: string[]; mouseChildren: Array<{ component: Component; height: number }> } {
	const lines: string[] = [];
	const mouseChildren: Array<{ component: Component; height: number }> = [];
	const strings = loadCuteStrings();
	const colors = loadCuteColors();
	const user = strings.welcomePersona.user || detectSystemUser();

	// Ensures exactly one blank breathing line before adding a card or block,
	// maintaining 1-to-1 mouse layout alignment with a dummy non-interactive spacer.
	const ensureBreathingRoom = () => {
		if (lines.length > 0 && lines[lines.length - 1] !== "") {
			lines.push("");
			// Empty object with no handleMouse absorbs mouse events on the breathing blank line
			// without forwarding ghost clicks to neighboring components.
			mouseChildren.push({ component: {} as any, height: 1 });
		}
	};

	let i = 0;
	while (i < children.length) {
		const child = children[i];
		const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";

		// 1. User Message
		if (name === "UserMessageComponent") {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const boxed = frameCategoryBox(rawLines, `❀ ${user}`, colors.userMessage, width, theme);
			mouseChildren.push({ component: child, height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 2. Group consecutive bash executions into ONE single unified card
		if (isBashComponent(child)) {
			ensureBreathingRoom();
			const bashGroup: Component[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isBashComponent(curr)) {
					bashGroup.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isBashComponent(children[i + 1])) {
					// Intervening spacer between bash calls - consume so group stays united
					mouseChildren.push({ component: curr, height: 0 });
					i++;
				} else {
					break;
				}
			}

			const combinedLines: string[] = [];
			for (let j = 0; j < bashGroup.length; j++) {
				const comp = bashGroup[j];
				const raw = comp.render(width - 4);
				const cleaned = cleanBashLines(raw);
				if (cleaned.length > 0) {
					if (combinedLines.length > 0) {
						combinedLines.push(""); // subtle separation between commands
					}
					const styled = formatBashOutputLines(cleaned, theme, colors.bashOutput);
					combinedLines.push(...styled);
				}
			}

			const cardLines = frameCategoryBox(
				combinedLines.length ? combinedLines : ["$"],
				">_ bash",
				colors.bashMessage,
				width,
				theme,
			);

			// Distribute mouse heights across the grouped children
			const avgHeight = Math.max(1, Math.floor(cardLines.length / bashGroup.length));
			for (let j = 0; j < bashGroup.length; j++) {
				const compHeight =
					j === bashGroup.length - 1
						? cardLines.length - avgHeight * (bashGroup.length - 1)
						: avgHeight;
				mouseChildren.push({ component: bashGroup[j], height: compHeight });
			}

			lines.push(...cardLines);
			continue;
		}

		// 3. Read tool execution in soft lilac card with Dracula highlighting
		if (isReadComponent(child)) {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const unwrapped = unwrapNativeCard(rawLines);
			const styled = formatReadLines(unwrapped, toolFilePath(child, unwrapped), theme);
			const boxed = frameCategoryBox(styled, "\u270E read", colors.readMessage, width, theme);
			mouseChildren.push({ component: new FramedCardMouseProxy(child, boxed.length), height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 4. Write / edit tool execution in barely-blue card
		if (isWriteComponent(child)) {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const unwrapped = unwrapNativeCard(rawLines);
			const styled = formatWriteDiffLines(unwrapped, toolFilePath(child, unwrapped), theme, (child as any).toolName);
			const boxed = frameCategoryBox(styled, "\u270E write", colors.writeMessage, width, theme);
			mouseChildren.push({ component: new FramedCardMouseProxy(child, boxed.length), height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 4b. Fetch tool execution in pink card; inner dark background preserved
		if (isFetchComponent(child)) {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const unwrapped = unwrapNativeCard(rawLines);
			const boxed = frameCategoryBox(unwrapped, "fetch", colors.fetchMessage, width, theme);
			mouseChildren.push({ component: new FramedCardMouseProxy(child, boxed.length), height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 4c. Search tool execution in dusty-rose card; inner dark background preserved
		if (isSearchComponent(child)) {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const unwrapped = unwrapNativeCard(rawLines);
			const boxed = frameCategoryBox(unwrapped, "search", colors.searchMessage, width, theme);
			mouseChildren.push({ component: new FramedCardMouseProxy(child, boxed.length), height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		if (isReviewComponent(child)) {
			ensureBreathingRoom();
			const rawLines = child.render(width - 4);
			const unwrapped = unwrapNativeCard(rawLines);
			const title = extractReviewHeader(unwrapped, child);
			const styled = formatReviewOutputLines(unwrapped, theme);
			const boxed = frameCategoryBox(styled, title, colors.reviewMessage ?? "gentle", width, theme);
			mouseChildren.push({ component: new FramedCardMouseProxy(child, boxed.length), height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 4d. Group consecutive memory (Engram) calls into ONE single salmon card
		if (isMemoryComponent(child)) {
			ensureBreathingRoom();
			const memGroup: Component[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isMemoryComponent(curr)) {
					memGroup.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isMemoryComponent(children[i + 1])) {
					// Intervening spacer between memory calls - consume so group stays united
					mouseChildren.push({ component: curr, height: 0 });
					i++;
				} else {
					break;
				}
			}

			const combinedLines: string[] = [];
			for (const comp of memGroup) {
				const raw = comp.render(width - 4);
				const unwrapped = unwrapNativeCard(raw);
				if (combinedLines.length > 0) {
					combinedLines.push(""); // subtle separation between calls
				}
				const styled = formatMemoryOutputLines(unwrapped, theme);
				combinedLines.push(...styled);
			}

			const cardLines = frameCategoryBox(
				combinedLines.length ? combinedLines : ["engram"],
				"🧠 engram",
				colors.memoryMessage,
				width,
				theme,
			);

			// Distribute mouse heights across the grouped children
			const avgHeight = Math.max(1, Math.floor(cardLines.length / memGroup.length));
			for (let j = 0; j < memGroup.length; j++) {
				const compHeight =
					j === memGroup.length - 1
						? cardLines.length - avgHeight * (memGroup.length - 1)
						: avgHeight;
				mouseChildren.push({ component: memGroup[j], height: compHeight });
			}

			lines.push(...cardLines);
			continue;
		}

		// 4e. Group consecutive subagent poll / status / run calls into ONE single cyan card
		if (isSubagentComponent(child)) {
			ensureBreathingRoom();
			const agentGroup: Component[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isSubagentComponent(curr)) {
					agentGroup.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isSubagentComponent(children[i + 1])) {
					// Intervening spacer between agent calls - consume so group stays united
					mouseChildren.push({ component: curr, height: 0 });
					i++;
				} else {
					break;
				}
			}

			// If all calls in the group are agent status polls, we coalesce them into the latest active status
			// plus a subtle indicator if multiple polls happened, so it doesn't flood 15 lines of status!
			let combinedLines: string[] = [];
			const allStatusPolls = agentGroup.every((c) => isAgentStatusComponent(c));

			if (allStatusPolls && agentGroup.length > 1) {
				// Take the latest status poll result, rendered at width to preserve contents
				const latest = agentGroup[agentGroup.length - 1];
				const raw = latest.render(width);
				const unwrapped = unwrapNativeCard(raw);
				const styled = formatSubagentLines(unwrapped, theme);
				const countHint = safeFg(theme, "muted", ` (${agentGroup.length} status polls coalesced)`, "muted");
				if (styled.length > 0) {
					styled[0] = `${styled[0]}${countHint}`;
				}
				combinedLines = styled;
			} else {
				for (const comp of agentGroup) {
					const raw = comp.render(width - 4);
					const unwrapped = unwrapNativeCard(raw);
					if (combinedLines.length > 0) {
						combinedLines.push(""); // subtle separation between calls
					}
					const styled = formatSubagentLines(unwrapped, theme);
					combinedLines.push(...styled);
				}
			}

			const cardLines = frameCategoryBox(
				combinedLines.length ? combinedLines : ["agent"],
				"🤖 subagent",
				colors.agentMessage ?? "accent",
				width,
				theme,
			);

			// Distribute mouse heights across the grouped children
			const avgHeight = Math.max(1, Math.floor(cardLines.length / agentGroup.length));
			for (let j = 0; j < agentGroup.length; j++) {
				const compHeight =
					j === agentGroup.length - 1
						? cardLines.length - avgHeight * (agentGroup.length - 1)
						: avgHeight;
				mouseChildren.push({ component: new FramedCardMouseProxy(agentGroup[j], compHeight), height: compHeight });
			}

			lines.push(...cardLines);
			continue;
		}

		// 5. Group consecutive top-level error Texts into ONE single coral card
		if (isErrorTextComponent(child)) {
			ensureBreathingRoom();
			const errorGroup: Component[] = [];
			while (i < children.length) {
				const curr = children[i];
				if (isErrorTextComponent(curr)) {
					errorGroup.push(curr);
					i++;
				} else if (isSpacer(curr) && i + 1 < children.length && isErrorTextComponent(children[i + 1])) {
					// Intervening spacer between errors - consume so group stays united
					mouseChildren.push({ component: curr, height: 0 });
					i++;
				} else {
					break;
				}
			}

			const combinedLines: string[] = [];
			for (let j = 0; j < errorGroup.length; j++) {
				const comp = errorGroup[j];
				const raw = comp.render(width - 4);
				const unwrapped = unwrapNativeCard(raw);
				if (combinedLines.length > 0) {
					combinedLines.push(""); // subtle separation between errors
				}
				combinedLines.push(...unwrapped);
			}

			const cardLines = frameCategoryBox(
				combinedLines.length ? combinedLines : ["Error"],
				"\u26A0 error",
				colors.errorMessage,
				width,
				theme,
			);

			// Distribute mouse heights across the grouped children
			const avgHeight = Math.max(1, Math.floor(cardLines.length / errorGroup.length));
			for (let j = 0; j < errorGroup.length; j++) {
				const compHeight =
					j === errorGroup.length - 1
						? cardLines.length - avgHeight * (errorGroup.length - 1)
						: avgHeight;
				mouseChildren.push({ component: errorGroup[j], height: compHeight });
			}

			lines.push(...cardLines);
			continue;
		}

		// 6. Grep tool execution (free, no card, Dracula highlighted)
		if (isGrepComponent(child)) {
			ensureBreathingRoom();
			const rawLines = child.render(width);
			const unwrapped = unwrapNativeCard(rawLines);
			const styled = formatGrepLines(unwrapped, theme);
			mouseChildren.push({ component: child, height: styled.length });
			lines.push(...styled);
			i++;
			continue;
		}

		// 7. Assistant prose (bolder headings, dracula text) and other
		// components (remaining tools, notices, custom banners) via transformTranscriptLines
		ensureBreathingRoom();
		const rawLines = child.render(width);
		if (isAsciiArtOrBanner(rawLines)) {
			// Keep custom banners and ASCII art untouched: preserve 24-bit ANSI background escapes,
			// exact spacing, and layout alignment without card wrapping or border stripping.
			mouseChildren.push({ component: child, height: rawLines.length });
			lines.push(...rawLines);
			i++;
			continue;
		}

		const transformed =
			name === "AssistantMessageComponent"
				? formatAssistantProse(rawLines, theme, width)
				: transformTranscriptLines(unwrapNativeCard(rawLines), theme);
		mouseChildren.push({ component: child, height: transformed.length });
		lines.push(...transformed);
		i++;
	}

	return { lines, mouseChildren };
}

/**
 * Renders any generic tool call output cleanly inside a CUTE category box,
 * unwrapping float card chrome and outline cards.
 */
export function formatToolCallCard(
	rawLines: string[],
	toolName: string,
	theme?: Theme,
	width = 80,
): string[] {
	const unwrapped = unwrapNativeCard(rawLines);
	const colors = loadCuteColors();
	return frameCategoryBox(unwrapped, toolName, colors.readMessage, width, theme);
}

/**
 * Renders a file preview cleanly unwrapped and highlighted.
 */
export function formatFilePreview(
	rawLines: string[],
	filePath?: string,
	theme?: Theme,
): string[] {
	const unwrapped = unwrapNativeCard(rawLines);
	return formatReadLines(unwrapped, filePath, theme);
}
