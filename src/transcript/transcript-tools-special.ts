import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { safeFg, stripAnsi } from "../cute-theme.ts";
import { unwrapNativeCard } from "./transcript-unwrap.ts";
import { highlightCodeLine } from "./transcript-highlight.ts";
import { hasKeptColor } from "./transcript-tools-system.ts";

/**
 * Tool names that render a `fetch <url>` header.
 */
export const FETCH_TOOL_NAMES = new Set(["fetch", "fetch_content"]);

export const TOOL_GLYPH_PREFIX = "(?:[✿❀❁✾★✣≡⌕+☷⌖✎\\u270E$🌹*]\\s*)?";
export const FETCH_HEADER_RE = new RegExp(`^${TOOL_GLYPH_PREFIX}fetch\\s+`, "i");
export const SEARCH_HEADER_RE = new RegExp(`^${TOOL_GLYPH_PREFIX}search\\s+`, "i");
export const SUBAGENT_HEADER_RE = new RegExp(`^${TOOL_GLYPH_PREFIX}agent\\s+(?:status|run|result|reply|cancel|continue|list)`, "i");
export const AGENT_STATUS_HEADER_RE = new RegExp(`^${TOOL_GLYPH_PREFIX}agent\\s+status\\b`, "i");

function tryRender(child: Component, width: number): string[] | undefined {
	try {
		return (child as unknown as { render?: (w: number) => string[] }).render?.(width);
	} catch {
		return undefined;
	}
}

/**
 * Checks whether a transcript component is a fetch tool execution.
 */
export function isFetchComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	if (typeof toolName === "string" && FETCH_TOOL_NAMES.has(toolName)) return true;
	if (typeof toolName !== "string") return false;
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines) return looksLikeFetchLines(lines);
	return false;
}

/**
 * True when rendered lines open with a `fetch <url>` tool header.
 */
export function looksLikeFetchLines(rawLines: string[]): boolean {
	const lines = unwrapNativeCard(rawLines);
	for (const line of lines) {
		const plain = stripAnsi(line).trim();
		if (!plain) continue;
		return FETCH_HEADER_RE.test(plain);
	}
	return false;
}

/**
 * Tool names that render a `search ...` header.
 */
export const SEARCH_TOOL_NAMES = new Set(["search", "web_search"]);

/**
 * Checks whether a transcript component is a search tool execution.
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
		return SEARCH_HEADER_RE.test(plain);
	}
	return false;
}

/**
 * Known gentle_review / RDD tool names.
 */
export const REVIEW_TOOL_NAMES = new Set([
	"gentle_review",
	"gentle_review_capture",
	"gentle_review_capture_group",
	"gentle_review_scope",
]);

/**
 * Checks whether a transcript component is a gentle_review / RDD tool execution.
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
 * True when rendered lines open with a review / RDD header.
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
 * Formats lines of a subagent component.
 */
export function formatSubagentLines(rawLines: string[], theme?: Theme): string[] {
	const lines = unwrapNativeCard(rawLines);
	if (!theme || !lines.length) return lines;

	return lines.map((line) => {
		const plain = stripAnsi(line).trim();
		if (!plain) return line;

		if (/^(?:[✿❀❁✾★✣≡⌕+☷⌖✎\u270E*]\s*)?agent\s+(?:status|run|result|reply|cancel|continue|list)/i.test(plain)) {
			const parts = plain.split("·").map((p) => p.trim());
			const action = safeFg(theme, "heading", parts[0] || "agent status", "accent");
			if (parts.length > 1) {
				const rest = parts.slice(1).map((p) => safeFg(theme, "syntaxString", p, "info")).join(safeFg(theme, "syntaxPunctuation", " · ", "muted"));
				return `${action} ${safeFg(theme, "syntaxPunctuation", "·", "muted")} ${rest}`;
			}
			return action;
		}

		if (plain.includes("·") && (plain.includes("turns") || plain.includes("tool calls") || plain.includes("running") || plain.includes("completed"))) {
			const tokens = plain.split("·").map((t) => t.trim());
			const filtered = tokens.filter((t) => !t.startsWith("cwd:"));
			return filtered
				.map((token) => {
					if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(token)) {
						return safeFg(theme, "syntaxNumber", token, "warning");
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
 * Formats inner lines of an RDD / gentle_review card.
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
 * Formats lines inside an Engram memory card.
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
 * Checks whether a transcript component is a subagent tool execution.
 */
export function isSubagentComponent(child: Component, renderedLines?: string[]): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	if (typeof toolName === "string" && toolName.startsWith("subagent_")) return true;
	const lines = renderedLines ?? tryRender(child, 80);
	if (lines && lines.length > 0) {
		const plain = stripAnsi(lines[0]).trim();
		if (SUBAGENT_HEADER_RE.test(plain)) {
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
		return AGENT_STATUS_HEADER_RE.test(plain);
	}
	return false;
}

/**
 * Checks whether a transcript component is a memory (Engram) tool execution.
 */
export function isMemoryComponent(child: Component): boolean {
	if (!child) return false;
	const toolName = (child as any).toolName;
	return typeof toolName === "string" && toolName.startsWith("mem_");
}

/**
 * Detects top-level Pi error lines.
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
 * Checks whether a transcript child is a plain Text error.
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
 * Mouse proxy for framed interactive cards.
 */
export class FramedCardMouseProxy implements Component {
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
