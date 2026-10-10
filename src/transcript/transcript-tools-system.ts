import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg, stripAnsi } from "../cute-theme.ts";
import { unwrapNativeCard, KEY_HINT_TRAILING_RE } from "./transcript-unwrap.ts";
import { highlightCodeLine, toolFileHighlightable } from "./transcript-highlight.ts";

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
 * Interpreters whose `<<'EOF'` heredoc body is code worth highlighting.
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
 * True when the line carries colors that must be preserved verbatim.
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
	s = s.replace(/\x1b\[38;2;(?:240;149;200|246;239;243|167;142;155|118;97;107)m/g, "");
	s = s.replace(/\x1b\[(?:1|22|39|49|0)m/g, "");
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
 * Formats the lines inside a bash card.
 */
export function formatBashOutputLines(
	lines: string[],
	theme?: Theme,
	colorKey = "bashOutput",
): string[] {
	if (!lines.length) return lines;
	const unwrapped = unwrapNativeCard(lines);
	const color = (s: string): string => (theme ? safeFg(theme, colorKey, s) : `\x1b[38;2;142;197;166m${s}\x1b[39m`);

	let highlightMode = false;
	let heredocEnd: string | undefined;
	return unwrapped.map((line) => {
		const plain = stripAnsi(line);
		const trimmed = plain.trim();
		if (trimmed === "") return line;

		if (heredocEnd && trimmed === heredocEnd) {
			highlightMode = false;
			heredocEnd = undefined;
			return line;
		}

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

		if (hasKeptColor(line, theme)) {
			return line;
		}

		if (highlightMode && theme) {
			const leadingSpace = plain.match(/^(\s*)/)?.[1] ?? "";
			const code = plain.slice(leadingSpace.length);
			if (!code) return line;
			return leadingSpace + highlightCodeLine(code, theme);
		}

		if (theme) return highlightCodeLine(plain, theme);
		return color(plain);
	});
}
