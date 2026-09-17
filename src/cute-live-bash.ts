import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadCuteColors } from "./cute-colors.ts";
import {
	cleanBashLines,
	formatBashCommandHeader,
	formatBashOutputLines,
	frameCategoryBox,
} from "./cute-transcript.ts";
import { safeFg } from "./cute-theme.ts";

let cuteLiveBashActive = false;

export function isCuteLiveBashActive(): boolean {
	return cuteLiveBashActive;
}

export function setCuteLiveBashActive(active: boolean): void {
	cuteLiveBashActive = active;
}

export interface BashRenderState {
	startedAt?: number;
	endedAt?: number;
	interval?: NodeJS.Timeout;
	hasResult?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	cachedLines?: string[];
	cachedWidth?: number;
	cachedExpanded?: boolean;
}

/**
 * Checks whether an execution result is considered an error,
 * either by Pi's context.isError flag or by standard shell error signatures.
 */
export function isBashExecutionError(isErrorFlag: boolean, rawText: string): boolean {
	if (isErrorFlag) return true;
	return /Command exited with code|Command was aborted|Command timed out|timed out after/i.test(rawText);
}

/**
 * Renders the body of a CUTE bash card:
 * - Command header ($ ...)
 * - Output preview (collapsed: last 5 non-empty lines; expanded: all lines)
 * - Status line (Running... (Xs) or Took Xs · Ctrl+O to expand)
 *
 * All lines are drawn with formatBashOutputLines and framed in frameCategoryBox.
 */
export function renderCuteBashBox(
	command: string,
	outputRaw: string,
	state: BashRenderState,
	expanded: boolean,
	width: number,
	theme?: Theme,
): string[] {
	const colors = loadCuteColors();

	// 1. Command header
	const cmdHeader = formatBashCommandHeader(`$ ${command || ""}`.trimEnd(), theme);

	// 2. Status message
	const now = Date.now();
	const started = state.startedAt ?? now;
	const isRunning = Boolean(state.isPartial && !state.hasResult);

	let statusText = "";
	if (isRunning) {
		const elapsedSec = Math.max(0, Math.round((now - started) / 1000));
		const rawStatus = `● Running... (${elapsedSec}s)`;
		statusText = theme ? safeFg(theme, "warning", rawStatus, "yellow") : rawStatus;
	} else {
		const ended = state.endedAt ?? now;
		const elapsedSec = Math.max(0, Math.round((ended - started) / 1000));
		const hint = expanded ? "Ctrl+O to collapse" : "Ctrl+O to expand";
		const took = `Took ${elapsedSec}s · ${hint}`;
		statusText = theme ? safeFg(theme, state.isError ? "error" : "dim", took, "muted") : took;
	}

	// 3. Process output lines
	const rawOutputLines = outputRaw.length > 0 ? outputRaw.split("\n") : [];
	const cleaned = cleanBashLines(rawOutputLines);
	const styledOutput = formatBashOutputLines(cleaned, theme, colors.bashOutput);

	let displayOutput: string[] = styledOutput;
	if (!expanded && styledOutput.length > 5) {
		displayOutput = styledOutput.slice(-5);
	}

	const contentLines: string[] = [cmdHeader];
	if (displayOutput.length > 0) {
		contentLines.push(...displayOutput);
	}
	contentLines.push(statusText);

	return frameCategoryBox(contentLines, ">_ bash", colors.bashMessage, width, theme);
}

/**
 * Creates a Component representing a live or completed bash card.
 */
export class CuteBashCardComponent implements Component {
	private command: string;
	private outputRaw: string;
	private state: BashRenderState;
	private expanded: boolean;
	private theme?: Theme;

	constructor(
		command: string,
		outputRaw: string,
		state: BashRenderState,
		expanded: boolean,
		theme?: Theme,
	) {
		this.command = command;
		this.outputRaw = outputRaw;
		this.state = state;
		this.expanded = expanded;
		this.theme = theme;
	}

	update(command: string, outputRaw: string, expanded: boolean, theme?: Theme): void {
		this.command = command;
		this.outputRaw = outputRaw;
		this.expanded = expanded;
		this.theme = theme;
	}

	render(width: number): string[] {
		// Cache rendered lines once execution has finished and options are stable
		if (!this.state.isPartial && this.state.hasResult) {
			if (
				this.state.cachedLines &&
				this.state.cachedWidth === width &&
				this.state.cachedExpanded === this.expanded
			) {
				return this.state.cachedLines;
			}
		}

		const lines = renderCuteBashBox(
			this.command,
			this.outputRaw,
			this.state,
			this.expanded,
			width,
			this.theme,
		);

		if (!this.state.isPartial && this.state.hasResult) {
			this.state.cachedLines = lines;
			this.state.cachedWidth = width;
			this.state.cachedExpanded = this.expanded;
		}

		return lines;
	}

	dispose(): void {
		if (this.state.interval) {
			clearInterval(this.state.interval);
			this.state.interval = undefined;
		}
	}
}

/**
 * Resolves Pi coding-agent module dynamically to support both local node_modules
 * and globally installed mise / npx runtimes without breaking unit test execution.
 */
async function resolvePiModule(): Promise<any> {
	try {
		// @ts-ignore
		return await import("@earendil-works/pi-coding-agent");
	} catch {}

	try {
		const globalPath = path.join(
			path.dirname(process.execPath),
			"..",
			"lib",
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"dist",
			"index.js",
		);
		return await import(pathToFileURL(globalPath).href);
	} catch {}

	return undefined;
}

/**
 * Registers a live streaming override for the native `bash` tool.
 * Preserves the original `execute` logic with effective timeout (default 120s),
 * sets `renderShell: "self"`, and renders exclusively using CUTE's `frameCategoryBox`.
 */
export async function registerCuteLiveBash(pi: ExtensionAPI, cwd: string): Promise<void> {
	const piMod = await resolvePiModule();
	if (!piMod || typeof piMod.createBashToolDefinition !== "function") {
		setCuteLiveBashActive(false);
		return;
	}

	const baseDefinition = piMod.createBashToolDefinition(cwd);

	const customBashDefinition = {
		...baseDefinition,
		renderShell: "self" as const,

		async execute(
			toolCallId: string,
			params: { command: string; timeout?: number },
			signal: AbortSignal,
			onUpdate: any,
			ctx: any,
		) {
			const effectiveTimeout = params.timeout ?? 120;
			const effectiveParams = { ...params, timeout: effectiveTimeout };
			return baseDefinition.execute(toolCallId, effectiveParams, signal, onUpdate, ctx);
		},

		renderCall(args: any, theme: Theme, context: any): Component {
			const state: BashRenderState = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}

			const command = args?.command ?? "";
			let comp = context.lastComponent;
			if (comp instanceof CuteBashCardComponent) {
				comp.update(command, "", Boolean(context.expanded), theme);
			} else {
				comp = new CuteBashCardComponent(command, "", state, Boolean(context.expanded), theme);
			}
			return comp;
		},

		renderResult(result: any, options: any, theme: Theme, context: any): Component {
			const state: BashRenderState = context.state;
			state.isPartial = Boolean(options?.isPartial);
			state.hasResult = !state.isPartial;

			// Extract textual output from result.content
			let rawOutput = "";
			if (result?.content && Array.isArray(result.content)) {
				for (const item of result.content) {
					if (item.type === "text" && typeof item.text === "string") {
						rawOutput += item.text;
					}
				}
			}

			const isErr = isBashExecutionError(Boolean(context.isError), rawOutput);
			state.isError = isErr;

			// Live timer (1s) only while execution is partial
			if (options?.isPartial && !isErr) {
				if (!state.interval) {
					state.interval = setInterval(() => {
						context.invalidate();
					}, 1000);
					state.interval.unref();
				}
			} else {
				// Execution finished or aborted/error
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
				if (state.endedAt === undefined) {
					state.endedAt = Date.now();
				}
			}

			const command = context.args?.command ?? "";
			let comp = context.lastComponent;
			if (comp instanceof CuteBashCardComponent) {
				comp.update(command, rawOutput, Boolean(context.expanded), theme);
			} else {
				comp = new CuteBashCardComponent(
					command,
					rawOutput,
					state,
					Boolean(context.expanded),
					theme,
				);
			}
			return comp;
		},
	};

	try {
		pi.registerTool(customBashDefinition as any);
		setCuteLiveBashActive(true);
	} catch {
		setCuteLiveBashActive(false);
	}
}
