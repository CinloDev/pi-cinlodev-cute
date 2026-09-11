import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { cuteGlyphs, frameFg } from "./cute-theme";
import { loadCuteLayout } from "./cute-layout.ts";
import { formatProfileDisplay, loadCuteStrings } from "./cute-strings.ts";
import { formatCwd, readActiveProfile, readGitBranch } from "./cute-paths.ts";

type HudMode = "full" | "compact";

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (Math.abs(value) < 1_000) return `${Math.round(value)}`;
	if (Math.abs(value) < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}

function formatPercent(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "n/a";
	return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function shortModelName(model: string): string {
	// Reemplazar prefijos largos para que se vea compacto y limpio
	return model
		.replace("gemini-", "g-")
		.replace("claude-", "c-")
		.replace("cpamc/", "");
}

function shortThinkingLevel(level: string): string {
	switch (level.toLowerCase()) {
		case "minimal":
			return "min";
		case "low":
			return "low";
		case "medium":
			return "med";
		case "high":
			return "high";
		case "default":
			return "def";
		default:
			return level.slice(0, 4);
	}
}

function borderTop(theme: Theme, title: string, width: number): string {
	const g = cuteGlyphs(theme);
	const maxTitleLen = Math.max(0, width - 6);
	const styledTitle = visibleWidth(title) > maxTitleLen ? truncateToWidth(title, maxTitleLen) : title;
	const leftLen = 3 + visibleWidth(styledTitle) + 1; // tl + h + space + title + space
	const dashCount = Math.max(0, width - leftLen - 1);
	return frameFg(theme, `${g.tl}${g.h} `) + styledTitle + frameFg(theme, ` ${g.h.repeat(dashCount)}${g.tr}`);
}

function borderBottom(theme: Theme, width: number): string {
	const g = cuteGlyphs(theme);
	const dashCount = Math.max(0, width - 2);
	return frameFg(theme, `${g.bl}${g.h.repeat(dashCount)}${g.br}`);
}

function boxedLine(theme: Theme, content: string, width: number): string {
	const g = cuteGlyphs(theme);
	const innerWidth = Math.max(0, width - 2);
	const text = truncateToWidth(content, innerWidth, "…");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(text)));
	return frameFg(theme, g.v) + text + padding + frameFg(theme, g.v);
}

let cachedGitBranch: string = "no git";
let lastGitBranchRead = 0;

function getCachedGitBranch(cwd: string): string {
	const now = Date.now();
	if (now - lastGitBranchRead > loadCuteLayout().hud.gitBranchTtlMs) {
		lastGitBranchRead = now;
		cachedGitBranch = readGitBranch(cwd);
	}
	return cachedGitBranch;
}

let cachedActiveProfile: string | undefined = undefined;
let lastProfileRead = 0;

function getCachedActiveProfile(): string | undefined {
	const now = Date.now();
	if (now - lastProfileRead > loadCuteLayout().hud.activeProfileTtlMs) {
		lastProfileRead = now;
		cachedActiveProfile = readActiveProfile();
	}
	return cachedActiveProfile;
}

function collectStats(ctx: ExtensionContext | ExtensionCommandContext | any) {
	let assistantMessages = 0;
	let userMessages = 0;
	let toolResults = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cost = 0;

	const branch = ctx?.sessionManager?.getBranch?.() ?? [];
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			assistantMessages++;
			const assistant = message as AssistantMessage;
			const usage = assistant.usage;
			inputTokens += (usage?.input ?? 0) + (usage?.cacheRead ?? 0);
			outputTokens += usage?.output ?? 0;
			if (typeof usage?.cost === "number") {
				cost += usage.cost;
			} else if (usage?.cost && typeof usage.cost.total === "number") {
				cost += usage.cost.total;
			}
		} else if (message.role === "user") {
			userMessages++;
		} else if (message.role === "toolResult") {
			toolResults++;
		}
	}

	const context = ctx?.getContextUsage?.();
	const model = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
	const contextWindow = ctx?.model?.contextWindow;
	const contextPercent = context?.tokens && contextWindow ? (context.tokens / contextWindow) * 100 : undefined;
	const activeProfile = getCachedActiveProfile();

	return {
		assistantMessages,
		userMessages,
		toolResults,
		inputTokens,
		outputTokens,
		cost,
		contextTokens: context?.tokens,
		contextWindow,
		contextPercent,
		model,
		activeProfile,
		gitBranch: getCachedGitBranch(ctx?.cwd ?? process.cwd()),
		thinkingLevel: ctx?.thinkingLevel ?? "default",
		cwd: ctx?.cwd ?? process.cwd(),
		sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? "ephemeral",
	};
}

class GentlemanHudWidget implements Component {
	constructor(
		private readonly getContext: () => ExtensionContext | ExtensionCommandContext,
		private readonly theme: Theme,
		private readonly getMode: () => HudMode,
	) {}

	render(width: number): string[] {
		const theme = this.theme;
		const stats = collectStats(this.getContext());
		const mode = this.getMode();
		const safeWidth = Math.max(loadCuteLayout().hud.minWidth, width);
		const innerWidth = safeWidth - 2;

		const strings = loadCuteStrings();
		const user = strings.welcomePersona.user || "Cinlo";
		const title = theme.fg("accent", strings.hudTitle.replace("{user}", user));
		const sep = theme.fg("borderMuted", ` ${cuteGlyphs(theme).separator} `);

		const pctColor = stats.contextPercent && stats.contextPercent > 75 ? "warning" : "success";
		const pctStr = formatPercent(stats.contextPercent);
		const ctxTokensStr = stats.contextTokens ? formatNumber(stats.contextTokens) : "0";
		const ctxWinStr = stats.contextWindow ? formatNumber(stats.contextWindow) : "n/a";
		const cwdShort = formatCwd(stats.cwd);

		// Model variants (profile as icon plus name, no brackets)
		const profileDisplay = stats.activeProfile
			? formatProfileDisplay(cuteGlyphs(theme).profileIcon, loadCuteStrings().profileFormat, stats.activeProfile)
			: "";
		const profileLabelFull = stats.activeProfile
			? theme.fg("muted", "Profile: ") + theme.fg("success", profileDisplay)
			: "";
		const profileLabelCompact = stats.activeProfile
			? theme.fg("success", profileDisplay)
			: "";

		const modelLabelFull =
			theme.fg("muted", "Model: ") +
			theme.fg("text", stats.model) +
			" " +
			theme.fg("accent", `(${stats.thinkingLevel})`);
		const modelLabelCompact =
			theme.fg("muted", "Model: ") +
			theme.fg("text", shortModelName(stats.model)) +
			" " +
			theme.fg("accent", `(${stats.thinkingLevel})`);
		const modelLabelMini =
			theme.fg("text", shortModelName(stats.model)) +
			" " +
			theme.fg("accent", `(${shortThinkingLevel(stats.thinkingLevel)})`);

		// Context variants
		const ctxLabelFull =
			theme.fg("muted", "Ctx: ") +
			theme.fg("text", ctxTokensStr) +
			theme.fg("dim", `/${ctxWinStr}`) +
			" " +
			theme.fg(pctColor, `(${pctStr})`);
		const ctxLabelCompact =
			theme.fg("muted", "Ctx: ") +
			theme.fg("text", ctxTokensStr) +
			" " +
			theme.fg(pctColor, `(${pctStr})`);
		const ctxLabelMini =
			theme.fg("muted", "Ctx: ") +
			theme.fg(pctColor, pctStr);

		// Session variants
		const sessionLabelFull =
			theme.fg("muted", "Session: ") +
			theme.fg("text", String(stats.userMessages)) +
			theme.fg("dim", " usr · ") +
			theme.fg("text", String(stats.assistantMessages)) +
			theme.fg("dim", " ast · ") +
			theme.fg("text", String(stats.toolResults)) +
			theme.fg("dim", " tools");
		const sessionLabelCompact =
			theme.fg("text", String(stats.userMessages)) +
			theme.fg("dim", "u · ") +
			theme.fg("text", String(stats.assistantMessages)) +
			theme.fg("dim", "a · ") +
			theme.fg("text", String(stats.toolResults)) +
			theme.fg("dim", "t");

		// Token variants
		const tokenLabelFull =
			theme.fg("muted", "Tokens: ") +
			theme.fg("text", formatNumber(stats.inputTokens)) +
			theme.fg("dim", " in · ") +
			theme.fg("text", formatNumber(stats.outputTokens)) +
			theme.fg("dim", " out");
		const tokenLabelCompact =
			theme.fg("text", formatNumber(stats.inputTokens)) +
			theme.fg("dim", "↑ ") +
			theme.fg("text", formatNumber(stats.outputTokens)) +
			theme.fg("dim", "↓");

		// Cost & Cwd variants
		const costLabelFull = theme.fg("muted", "Cost: ") + theme.fg("success", `$${stats.cost.toFixed(4)}`);
		const costLabelCompact = theme.fg("success", `$${stats.cost.toFixed(4)}`);
		const branchGlyph = cuteGlyphs(theme).branch;
		const branchSuffix =
			stats.gitBranch && stats.gitBranch !== "no git"
				? `${sep}${theme.fg("secondary", `${branchGlyph} ${stats.gitBranch}`)}`
				: "";
		const cwdLabelFull =
			theme.fg("accent", "Dir: ") +
			`\x1b[1m${theme.fg("accent", cwdShort)}\x1b[22m` +
			branchSuffix;
		const cwdLabelCompact =
			theme.fg("accent", "Dir: ") +
			theme.fg("accent", cwdShort) +
			branchSuffix;

		// Un cuadradito de aire arriba: baja la card del HUD (y con ella el input)
		// una fila para que no quede pegada al contenido de arriba.
		const lines: string[] = ["", borderTop(theme, title, safeWidth)];

		if (mode === "compact") {
			let candidate = `  ${modelLabelCompact}${profileLabelCompact ? sep + profileLabelCompact : ""}${sep}${ctxLabelCompact}${sep}${theme.fg("muted", "Msg: ")}${theme.fg("text", `${stats.userMessages}/${stats.assistantMessages}`)}${sep}${costLabelFull}`;
			if (visibleWidth(candidate) > innerWidth) {
				candidate = `  ${modelLabelMini}${profileLabelCompact ? sep + profileLabelCompact : ""}${sep}${ctxLabelMini}${sep}${theme.fg("text", `${stats.userMessages}/${stats.assistantMessages}`)}${sep}${costLabelCompact}`;
			}
			lines.push(boxedLine(theme, candidate, safeWidth));
		} else {
			// Tier 1: Wide terminal (>= hud.tierWideMin cols) -> 2 lines
			const row1Wide = `  ${modelLabelFull}${profileLabelFull ? sep + profileLabelFull : ""}${sep}${ctxLabelFull}${sep}${sessionLabelFull}`;
			const row2Wide = `  ${tokenLabelFull}${sep}${costLabelFull}${sep}${cwdLabelFull}`;

			if (visibleWidth(row1Wide) <= innerWidth && visibleWidth(row2Wide) <= innerWidth) {
				lines.push(boxedLine(theme, row1Wide, safeWidth));
				lines.push(boxedLine(theme, row2Wide, safeWidth));
			} else {
				// Tier 2: Medium terminal (hud.tierMediumMin cols and up) -> 3 lines clean (no truncation)
				const row1Med = `  ${modelLabelFull}${profileLabelFull ? sep + profileLabelFull : ""}`;
				const row2Med = `  ${ctxLabelFull}${sep}${sessionLabelFull}`;
				const row3Med = `  ${tokenLabelFull}${sep}${costLabelFull}${sep}${cwdLabelFull}`;

				if (visibleWidth(row1Med) <= innerWidth && visibleWidth(row2Med) <= innerWidth && visibleWidth(row3Med) <= innerWidth) {
					lines.push(boxedLine(theme, row1Med, safeWidth));
					lines.push(boxedLine(theme, row2Med, safeWidth));
					lines.push(boxedLine(theme, row3Med, safeWidth));
				} else {
					// Tier 3: Narrow terminal (< hud.tierMediumMin cols) -> adaptive compact badges
					let row1 = `  ${modelLabelFull}`;
					if (visibleWidth(row1) > innerWidth) row1 = `  ${modelLabelCompact}`;
					if (visibleWidth(row1) > innerWidth) row1 = `  ${modelLabelMini}`;

					let row2 = `  ${ctxLabelFull}${sep}${sessionLabelCompact}`;
					if (visibleWidth(row2) > innerWidth) row2 = `  ${ctxLabelCompact}${sep}${sessionLabelCompact}`;
					if (visibleWidth(row2) > innerWidth) row2 = `  ${ctxLabelMini}${sep}${sessionLabelCompact}`;

					let row3 = `  ${tokenLabelFull}${sep}${costLabelFull}${sep}${cwdLabelFull}`;
					if (visibleWidth(row3) > innerWidth) row3 = `  ${tokenLabelCompact}${sep}${costLabelFull}${sep}${cwdLabelFull}`;
					if (visibleWidth(row3) > innerWidth) row3 = `  ${tokenLabelCompact}${sep}${costLabelCompact}${sep}${cwdLabelFull}`;
					if (visibleWidth(row3) > innerWidth) row3 = `  ${tokenLabelCompact}${sep}${costLabelCompact}${sep}${cwdLabelCompact}`;
					if (visibleWidth(row3) > innerWidth) row3 = `  ${tokenLabelCompact}${sep}${costLabelCompact}`;

					lines.push(boxedLine(theme, row1, safeWidth));
					lines.push(boxedLine(theme, row2, safeWidth));
					lines.push(boxedLine(theme, row3, safeWidth));
				}
			}
		}

		lines.push(borderBottom(theme, safeWidth));
		return lines;
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
	let hudEnabled = true;
	let hudMode: HudMode = "full";
	let statusEnabled = false;
	let latestCtx: ExtensionContext | ExtensionCommandContext | null = null;
	let activeTui: TUI | null = null;

	function renderStatus(ctx: any): string {
		const theme = ctx.ui.theme;
		const stats = collectStats(ctx);
		const context = formatPercent(stats.contextPercent);
		const model = ctx.model?.id ?? "no-model";
		const strings = loadCuteStrings();
		const user = strings.welcomePersona.user || "Cinlo";
		const statusLine = strings.hudStatusLine;
		const brand = statusLine.brand.replace("{user}", user);
		return [
			theme.fg("accent", brand),
			theme.fg("dim", statusLine.modelFmt.replace("{model}", model)),
			theme.fg("dim", statusLine.ctxFmt.replace("{context}", context)),
			theme.fg("dim", statusLine.toolsFmt.replace("{tools}", String(stats.toolResults))),
		].join(theme.fg("borderMuted", ` ${cuteGlyphs(theme).separator} `));
	}

	function updateStatus(ctx: any): void {
		if (!ctx?.hasUI) return;
		if (statusEnabled) {
			ctx.ui.setStatus("gentleman-hud", renderStatus(ctx));
		} else {
			ctx.ui.setStatus("gentleman-hud", undefined);
		}
	}

	function applyHudWidget(ctx: ExtensionContext | ExtensionCommandContext): void {
		latestCtx = ctx;
		if (!ctx.hasUI) return;

		if (hudEnabled) {
			ctx.ui.setWidget(
				"gentleman-hud",
				(tui: TUI, theme: Theme) => {
					activeTui = tui;
					return new GentlemanHudWidget(() => latestCtx ?? ctx, theme, () => hudMode);
				},
				{ placement: "aboveEditor" },
			);
		} else {
			ctx.ui.setWidget("gentleman-hud", undefined);
		}

		updateStatus(ctx);
		activeTui?.requestRender();
	}

	pi.registerCommand("hud", {
		description: loadCuteStrings().hudDescriptions.hud,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			latestCtx = ctx;

			if (ctx.mode !== "tui") {
				ctx.ui.notify(loadCuteStrings().notifys.notInTui, "warning");
				return;
			}

			const commandArg = args.trim().toLowerCase();

			if (commandArg === "off" || commandArg === "close" || commandArg === "hide") {
				hudEnabled = false;
				applyHudWidget(ctx);
				ctx.ui.notify(loadCuteStrings().notifys.deactivated, "info");
				return;
			}

			if (commandArg === "on" || commandArg === "open" || commandArg === "show") {
				hudEnabled = true;
				applyHudWidget(ctx);
				ctx.ui.notify(loadCuteStrings().notifys.activated, "info");
				return;
			}

			if (commandArg === "compact" || commandArg === "mini") {
				hudEnabled = true;
				hudMode = "compact";
				applyHudWidget(ctx);
				ctx.ui.notify(loadCuteStrings().notifys.compact, "info");
				return;
			}

			if (commandArg === "full") {
				hudEnabled = true;
				hudMode = "full";
				applyHudWidget(ctx);
				ctx.ui.notify(loadCuteStrings().notifys.full, "info");
				return;
			}

			// Default toggle
			hudEnabled = !hudEnabled;
			applyHudWidget(ctx);
			const notifys = loadCuteStrings().notifys;
			ctx.ui.notify(
				hudEnabled ? notifys.activatedWithMode.replace("{mode}", hudMode) : notifys.deactivated,
				"info",
			);
		},
	});

	pi.registerCommand("hud-status", {
		description: loadCuteStrings().hudDescriptions.hudStatus,
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			statusEnabled = !statusEnabled;
			updateStatus(ctx);
			const notifys = loadCuteStrings().notifys;
			ctx.ui.notify(
				statusEnabled ? notifys.statusActivated : notifys.statusDeactivated,
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => applyHudWidget(ctx));
	pi.on("session_end", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setWidget("gentleman-hud", undefined);
	});
	pi.on("model_select", async (_event, ctx) => applyHudWidget(ctx));
	pi.on("thinking_level_select", async (_event, ctx) => applyHudWidget(ctx));
	pi.on("turn_start", async (_event, ctx) => applyHudWidget(ctx));
	pi.on("turn_end", async (_event, ctx) => applyHudWidget(ctx));
	pi.on("tool_execution_start", async (_event, ctx) => applyHudWidget(ctx));
	pi.on("tool_execution_end", async (_event, ctx) => applyHudWidget(ctx));
}
