import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { loadCuteStrings, detectSystemUser } from "../cute-strings.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { safeFg, transformTranscriptLines } from "../cute-theme.ts";
import { frameCategoryBox } from "./transcript-ansi.ts";
import { unwrapNativeCard, isAsciiArtOrBanner } from "./transcript-unwrap.ts";
import { toolFilePath } from "./transcript-highlight.ts";
import {
	cleanBashLines,
	formatBashOutputLines,
	formatGrepLines,
	formatReadLines,
	formatWriteDiffLines,
} from "./transcript-tools-system.ts";
import {
	isFetchComponent,
	isSearchComponent,
	isReviewComponent,
	isMemoryComponent,
	isSubagentComponent,
	isAgentStatusComponent,
	isErrorTextComponent,
	extractReviewHeader,
	formatReviewOutputLines,
	formatMemoryOutputLines,
	formatSubagentLines,
	FramedCardMouseProxy,
} from "./transcript-tools-special.ts";
import { formatAssistantProse } from "./transcript-prose.ts";

/**
 * Checks whether a transcript component is a bash execution.
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
 * Checks whether a transcript component is a read tool execution.
 */
export function isReadComponent(child: Component): boolean {
	if (!child) return false;
	const name = (child as unknown as { constructor?: { name?: string } })?.constructor?.name ?? "";
	if (name === "ToolExecutionComponent" && (child as any).toolName === "read") return true;
	if ((child as any).toolName === "read") return true;
	return false;
}

/**
 * Checks whether a transcript component is a write/edit tool execution.
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
 * Checks whether a transcript component is a grep tool execution.
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
	if (isReadComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatReadLines(unwrapped, toolFilePath(child, unwrapped), theme);
		return frameCategoryBox(styled, "\u270E read", colors.readMessage, width, theme);
	}

	// Write / edit tool execution in barely-blue card (#A5CBE8 / colors.writeMessage)
	if (isWriteComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const styled = formatWriteDiffLines(unwrapped, toolFilePath(child, unwrapped), theme, (child as any).toolName);
		return frameCategoryBox(styled, "\u270E write", colors.writeMessage, width, theme);
	}

	// Fetch tool execution in pink card (#F095C8 / colors.fetchMessage)
	if (isFetchComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "fetch", colors.fetchMessage, width, theme);
	}

	// Search tool execution in dusty-rose card (#D7A0B8 / colors.searchMessage)
	if (isSearchComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "search", colors.searchMessage, width, theme);
	}

	// Review tool (RDD) execution in gentle tone (#a46db5 / colors.reviewMessage)
	if (isReviewComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		const title = extractReviewHeader(unwrapped, child);
		const styled = formatReviewOutputLines(unwrapped, theme);
		return frameCategoryBox(styled, title, colors.reviewMessage ?? "gentle", width, theme);
	}

	// Memory (Engram) tool execution in salmon card (#F0978A / colors.memoryMessage)
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

	// Grep tool execution without bounding box, but with full Dracula-style highlighting
	if (isGrepComponent(child)) {
		const rawLines = child.render(width);
		const unwrapped = unwrapNativeCard(rawLines);
		return formatGrepLines(unwrapped, theme);
	}

	// Top-level Pi error Text in coral card
	if (isErrorTextComponent(child)) {
		const rawLines = child.render(width - 4);
		const unwrapped = unwrapNativeCard(rawLines);
		return frameCategoryBox(unwrapped, "\u26A0 error", colors.errorMessage, width, theme);
	}

	// Assistant prose renders free (no card) with bolder headings and celeste body text
	if (name === "AssistantMessageComponent") {
		const rawLines = child.render(width);
		return formatAssistantProse(rawLines, theme, width);
	}

	const rawLines = child.render(width);
	const unwrapped = unwrapNativeCard(rawLines);
	return transformTranscriptLines(unwrapped, theme);
}

/**
 * Formats a list of transcript children with intelligent grouping.
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

	const ensureBreathingRoom = () => {
		if (lines.length > 0 && lines[lines.length - 1] !== "") {
			lines.push("");
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
						combinedLines.push("");
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
					combinedLines.push("");
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
					mouseChildren.push({ component: curr, height: 0 });
					i++;
				} else {
					break;
				}
			}

			let combinedLines: string[] = [];
			const allStatusPolls = agentGroup.every((c) => isAgentStatusComponent(c));

			if (allStatusPolls && agentGroup.length > 1) {
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
						combinedLines.push("");
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
					combinedLines.push("");
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

		// 7. Assistant prose and other components
		ensureBreathingRoom();
		const rawLines = child.render(width);
		if (isAsciiArtOrBanner(rawLines)) {
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
 * Renders any generic tool call output cleanly inside a CUTE category box.
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
