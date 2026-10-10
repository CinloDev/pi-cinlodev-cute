import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg, bolden, stripAnsi } from "../cute-theme.ts";
import { highlightUncoloredSegments } from "./transcript-ansi.ts";

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
export function formatAssistantProse(rawLines: string[], theme?: Theme, _width = 80): string[] {
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
