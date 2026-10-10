import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg } from "../cute-theme.ts";
import type { GitStatusCounts } from "./git-cli.ts";

/**
 * Colorizes a single line from `git log --graph --oneline --decorate`
 * with Dracula syntax roles:
 * - Graph nodes (*) in pink (accent)
 * - Graph edges (|, \, /) in cyan/celeste (syntaxFunction)
 * - Hashes in gold/orange (syntaxNumber)
 * - Ref decorations in mint / secondary / type
 * - Messages in text
 */
export function colorizeGitGraphLine(line: string, theme?: Theme): string {
	if (!theme || !line.trim()) return line;

	// 1. Pure graph connection lines (e.g. "|\\  ", "|/  ", "|   ")
	if (/^[\\/|_\s]+$/.test(line)) {
		return line.replace(/([\\/|_]+)/g, (m) => safeFg(theme, "syntaxFunction", m, "cyan"));
	}

	// 2. Commit line: (graph characters with *) (hash) (optional refs in parens) (subject)
	const m = /^([*\\/|_\s]*[*][*\\/|_\s]*)\s+([0-9a-f]{7,40})\s*(?:\(([^)]+)\))?\s*(.*)$/.exec(line);
	if (!m) {
		// Fallback: color any graph characters at the start
		return line.replace(/^([*\\/|_\s]+)/, (graph) =>
			graph
				.replace(/(\*)/g, (s) => safeFg(theme, "accent", s, "pink"))
				.replace(/([\\/|_]+)/g, (s) => safeFg(theme, "syntaxFunction", s, "cyan")),
		);
	}

	const graphPart = m[1];
	const hash = m[2];
	const refs = m[3];
	const subject = m[4];

	const coloredGraph = graphPart.replace(/(\*)|([\\/|_]+)/g, (_m, star, edge) => {
		if (star) return safeFg(theme, "accent", star, "pink");
		return safeFg(theme, "syntaxFunction", edge, "cyan");
	});

	const coloredHash = safeFg(theme, "syntaxNumber", hash, "yellow");

	let coloredRefs = "";
	if (refs) {
		const openParen = safeFg(theme, "syntaxPunctuation", "(", "muted");
		const closeParen = safeFg(theme, "syntaxPunctuation", ")", "muted");
		const refItems = refs
			.split(",")
			.map((item) => {
				const trimmed = item.trim();
				if (trimmed.includes("HEAD")) {
					return safeFg(theme, "mint", trimmed, "green");
				}
				if (trimmed.includes("origin") || trimmed.includes("upstream")) {
					return safeFg(theme, "secondary", trimmed, "magenta");
				}
				return safeFg(theme, "syntaxType", trimmed, "yellow");
			})
			.join(safeFg(theme, "syntaxPunctuation", ", ", "muted"));
		coloredRefs = ` ${openParen}${refItems}${closeParen}`;
	}

	const coloredSubject = subject ? ` ${safeFg(theme, "text", subject)}` : "";

	return `${coloredGraph} ${coloredHash}${coloredRefs}${coloredSubject}`;
}

export function formatGitStatusBadges(counts: GitStatusCounts, theme?: Theme): string {
	if (!theme) {
		return counts.isClean ? "clean" : "modified";
	}

	if (counts.isClean) {
		return safeFg(theme, "mint", "✔ clean", "green");
	}

	const items: string[] = [];
	if (counts.conflicts > 0) {
		items.push(safeFg(theme, "error", `✖ ${counts.conflicts} conflict`, "red"));
	}
	if (counts.modified > 0) {
		items.push(safeFg(theme, "warning", `● ${counts.modified} mod`, "yellow"));
	}
	if (counts.staged > 0) {
		items.push(safeFg(theme, "mint", `+${counts.staged} staged`, "green"));
	}
	if (counts.untracked > 0) {
		items.push(safeFg(theme, "secondary", `?${counts.untracked} untracked`, "magenta"));
	}

	const dot = safeFg(theme, "syntaxPunctuation", " · ", "muted");
	return items.join(dot);
}

export function formatFilePathWithDracula(filePath: string, c: { dim: (s: string) => string; cyan: (s: string) => string }): string {
	const lastSlash = filePath.lastIndexOf("/");
	if (lastSlash === -1) {
		return c.cyan(filePath);
	}
	const dir = filePath.slice(0, lastSlash + 1);
	const base = filePath.slice(lastSlash + 1);
	return `${c.dim(dir)}${c.cyan(base)}`;
}
