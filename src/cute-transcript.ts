import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadCuteStrings } from "./cute-strings.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { safeFg, stripAnsi, transformTranscriptLines } from "./cute-theme.ts";

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
	for (const char of plain) {
		const cp = char.codePointAt(0) ?? 0;
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
		} else if (cp >= 0x20) {
			width += 1;
		}
	}
	return width;
}

/**
 * Truncates a string to fit within a given visible terminal width.
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
		const truncated = truncateToVisibleWidth(line, innerWidth);
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
	"sh", "bash", "zsh", "fish", "sql", "json", "jsonc", "yaml", "yml", "toml",
]);

/** True when the tool file path points to a highlightable code format. */
export function toolFileHighlightable(filePath: unknown): boolean {
	if (typeof filePath !== "string" || filePath.length === 0) return false;
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return HIGHLIGHTABLE_EXTENSIONS.has(ext);
}

/** Reads the target file path from a read/write/edit tool component's args. */
export function toolFilePath(child: Component): string | undefined {
	const args = (child as unknown as { args?: Record<string, unknown> })?.args;
	if (!args || typeof args !== "object") return undefined;
	const p = (args as Record<string, unknown>).path ?? (args as Record<string, unknown>).file_path;
	return typeof p === "string" ? p : undefined;
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
 * Never throws and never corrupts: on any doubt the plain code is returned.
 */
export function highlightCodeLine(code: string, theme?: Theme): string {
	if (!theme || !code) return code;
	let out = "";
	let last = 0;
	let m: RegExpExecArray | null;
	const re = new RegExp(CODE_TOKEN, "g");
	try {
		while ((m = re.exec(code)) !== null) {
			if (m.index > last) out += code.slice(last, m.index);
			const [tok, comment, str, kw, num, fn, ty] = m;
			if (comment) out += safeFg(theme, "syntaxComment", tok, "muted");
			else if (str) out += safeFg(theme, "syntaxString", tok, "green");
			else if (kw) out += safeFg(theme, "syntaxKeyword", tok, "accent");
			else if (num) out += safeFg(theme, "syntaxNumber", tok, "warning");
			else if (fn) out += safeFg(theme, "syntaxFunction", tok, "text");
			else if (ty) out += safeFg(theme, "syntaxType", tok, "heading");
			else out += tok;
			last = m.index + tok.length;
			if (tok.length === 0) break;
		}
	} catch {
		return code;
	}
	if (last < code.length) out += code.slice(last);
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
 * Formats read tool lines: if the line contains code that is plain text (not yet
 * ANSI-highlighted by Pi or when collapsed/fallback), highlights it Dracula-style
 * using the theme syntax roles. Headers and already-highlighted lines pass through.
 */
export function formatReadLines(rawLines: string[], filePath?: string, theme?: Theme): string[] {
	if (!theme || !toolFileHighlightable(filePath)) return rawLines;
	return rawLines.map((line, idx) => {
		const plain = stripAnsi(line);
		const trimmed = plain.trim();
		if (!trimmed) return line;

		// The very first line is usually the tool call header: `read path/to/file`
		if (idx === 0 && (trimmed.startsWith("read ") || trimmed.startsWith("✎ read"))) {
			return line;
		}

		// Hint / expansion / status lines
		if (trimmed.startsWith("ctrl+o") || trimmed.includes("to expand") || trimmed.startsWith("...")) {
			return line;
		}

		// If line already contains non-default ANSI syntax color sequences from Pi highlightCode, preserve it
		const hasSyntaxAnsi = /\x1b\[38;2;(?!246;239;243|167;142;155|118;97;107)\d+;\d+;\d+m|\x1b\[3[1-6]m/.test(line);
		if (hasSyntaxAnsi) {
			return line;
		}

		// Otherwise, highlight Dracula-style preserving indentation
		const leadingSpace = line.match(/^(\s*)/)?.[1] ?? "";
		const code = plain.slice(leadingSpace.length);
		if (!code) return line;
		return leadingSpace + highlightCodeLine(code, theme);
	});
}

export function formatWriteDiffLines(rawLines: string[], filePath?: string, theme?: Theme): string[] {
	if (!theme || !toolFileHighlightable(filePath)) return rawLines;
	return rawLines.map((line) => {
		const plain = stripAnsi(line);
		let prefix = "";
		let code = "";
		let tone = "";
		let m = WRITE_DIFF_ADDED.exec(plain);
		if (m) {
			prefix = `+${m[1]} `;
			code = m[2] ?? "";
			tone = "toolDiffAdded";
		} else if ((m = WRITE_DIFF_REMOVED.exec(plain))) {
			prefix = `-${m[1]} `;
			code = m[2] ?? "";
			tone = "toolDiffRemoved";
		} else if ((m = WRITE_DIFF_CONTEXT.exec(plain))) {
			prefix = ` ${m[1]} `;
			code = m[2] ?? "";
			tone = "toolDiffContext";
		} else {
			return line;
		}
		if (!code) return line;
		const highlighted = highlightCodeLine(code, theme);
		return safeFg(theme, tone, prefix, "muted") + highlighted;
	});
}

/**
 * Strips empty lines and horizontal border divider lines (e.g. ─── or ═══)
 * from raw bash component output so it nests cleanly inside our card.
 */
export function cleanBashLines(rawLines: string[]): string[] {
	return rawLines.filter((line) => {
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
 * Falls back to the original line when no theme is available.
 */
export function formatBashCommandHeader(line: string, theme?: Theme): string {
	if (!theme) return line;
	const plain = stripAnsi(line);
	const m = /^(\s*\$\s?)(.*)$/.exec(plain);
	if (!m) return line;
	const prefix = m[1] ?? "$ ";
	const cmd = m[2] ?? "";
	if (!cmd) return line;
	return safeFg(theme, "bashMode", prefix, "pink") + highlightCodeLine(cmd, theme);
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
	const color = (s: string): string => (theme ? safeFg(theme, colorKey, s) : `\x1b[38;2;219;140;101m${s}\x1b[39m`);

	// Tracks whether the current `$` section is highlightable code (a `cat`-style
	// file dump or a code-interpreter heredoc) plus the heredoc terminator.
	let highlightMode = false;
	let heredocEnd: string | undefined;
	return lines.map((line) => {
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
		if (trimmed.startsWith("$") || plain.trimStart().startsWith("$ ")) {
			const heredoc = extractHeredoc(trimmed);
			if (heredoc && (HEREDOC_CODE_COMMANDS.has(heredoc.interpreter) || HEREDOC_SHELL_COMMANDS.has(heredoc.interpreter) || toolFileHighlightable(heredoc.target))) {
				highlightMode = true;
				heredocEnd = heredoc.delimiter;
			} else {
				highlightMode = toolFileHighlightable(extractBashDisplayPath(trimmed));
				heredocEnd = undefined;
			}
			return formatBashCommandHeader(line, theme);
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
	const user = strings.welcomePersona.user || "CinloDev";

	// User Message (configurable via colors.userMessage, default 'heading' / #E0C27A)
	if (name === "UserMessageComponent") {
		const rawLines = child.render(width - 4);
		return frameCategoryBox(rawLines, `❀ ${user}`, colors.userMessage, width, theme);
	}

	// Bash execution (single child fallback)
	if (isBashComponent(child)) {
		const rawLines = child.render(width - 4);
		const cleaned = cleanBashLines(rawLines);
		const styled = formatBashOutputLines(cleaned.length ? cleaned : rawLines, theme, colors.bashOutput);
		return frameCategoryBox(styled, ">_ bash", colors.bashMessage, width, theme);
	}

	// Read tool execution in soft lilac card (#C5A3E0 / colors.readMessage)
	// with Dracula-style syntax highlighting for code lines.
	if (isReadComponent(child)) {
		const rawLines = child.render(width - 4);
		const styled = formatReadLines(rawLines, toolFilePath(child), theme);
		return frameCategoryBox(styled, "\u270E read", colors.readMessage, width, theme);
	}

	// Write / edit tool execution in barely-blue card (#A5CBE8 / colors.writeMessage)
	// with Dracula-style syntax highlighting inside diff lines.
	if (isWriteComponent(child)) {
		const rawLines = child.render(width - 4);
		const styled = formatWriteDiffLines(rawLines, toolFilePath(child), theme);
		return frameCategoryBox(styled, "\u270E write", colors.writeMessage, width, theme);
	}

	// Top-level Pi error Text in coral card (same tone as error typography / colors.errorMessage)
	if (isErrorTextComponent(child)) {
		const rawLines = child.render(width - 4);
		return frameCategoryBox(rawLines, "\u26A0 error", colors.errorMessage, width, theme);
	}

	// All other components (Assistant, Tools, Notices) pass through transformTranscriptLines
	// so Gentle AI cards (review start/consent/completed), warning notices, and tools adopt
	// double lines, the robot glyph 🤖 and themed tones (mint green / yellow / error).
	const rawLines = child.render(width);
	return transformTranscriptLines(rawLines, theme);
}

/**
 * Formats a list of transcript children with intelligent grouping:
 * - Groups consecutive bash executions into ONE SINGLE unified sunset orange card.
 * - Formats user messages with the golden user box.
 * - Frames read executions in soft lilac and write/edit in barely-blue.
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
	const user = strings.welcomePersona.user || "CinloDev";

	let i = 0;
	while (i < children.length) {
		const child = children[i];
		const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";

		// 1. User Message
		if (name === "UserMessageComponent") {
			const rawLines = child.render(width - 4);
			const boxed = frameCategoryBox(rawLines, `❀ ${user}`, colors.userMessage, width, theme);
			mouseChildren.push({ component: child, height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 2. Group consecutive bash executions into ONE single unified card
		if (isBashComponent(child)) {
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
			const rawLines = child.render(width - 4);
			const styled = formatReadLines(rawLines, toolFilePath(child), theme);
			const boxed = frameCategoryBox(styled, "\u270E read", colors.readMessage, width, theme);
			mouseChildren.push({ component: child, height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 4. Write / edit tool execution in barely-blue card
		if (isWriteComponent(child)) {
			const rawLines = child.render(width - 4);
			const styled = formatWriteDiffLines(rawLines, toolFilePath(child), theme);
			const boxed = frameCategoryBox(styled, "\u270E write", colors.writeMessage, width, theme);
			mouseChildren.push({ component: child, height: boxed.length });
			lines.push(...boxed);
			i++;
			continue;
		}

		// 5. Group consecutive top-level error Texts into ONE single coral card
		if (isErrorTextComponent(child)) {
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
				if (combinedLines.length > 0) {
					combinedLines.push(""); // subtle separation between errors
				}
				combinedLines.push(...raw);
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

		// 6. Other components (assistant messages, remaining tools, notices)
		const rawLines = child.render(width);
		const transformed = transformTranscriptLines(rawLines, theme);
		mouseChildren.push({ component: child, height: transformed.length });
		lines.push(...transformed);
		i++;
	}

	return { lines, mouseChildren };
}
