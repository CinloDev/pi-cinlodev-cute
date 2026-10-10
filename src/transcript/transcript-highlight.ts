import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg, stripAnsi } from "../cute-theme.ts";
import { unwrapNativeCard } from "./transcript-unwrap.ts";

/**
 * File extensions that benefit from Dracula single-line code highlighting.
 * Prose (markdown, plain text) are excluded so ordinary words like "for", "new"
 * or "class" never get sprinkled with keyword colors.
 */
export const HIGHLIGHTABLE_EXTENSIONS = new Set([
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

function tryRender(child: Component, width: number): string[] | undefined {
	try {
		return child.render(width);
	} catch {
		return undefined;
	}
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
 * highlighting.
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
