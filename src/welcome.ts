import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface WelcomeStats {
	version: string;
	gitBranch: string;
	model: string;
	activeProfile?: string;
	thinkingLevel: string;
	contextFiles: string[];
	skills: string[];
	prompts: string[];
	extensions: string[];
	customToolsCount: number;
	pendingUpdates: string[];
}

function safeThemeFg(theme: Theme, colorKey: string, text: string, fallbackColor: string = "text"): string {
	try {
		return theme.fg(colorKey as any, text);
	} catch {
		try {
			return theme.fg(fallbackColor as any, text);
		} catch {
			return text;
		}
	}
}

function shortModelName(model: string): string {
	const parts = model.split("/");
	return parts.length > 1 ? parts[parts.length - 1] : model;
}

const VIOLET = "\x1b[38;2;142;68;173m";
const RESET = "\x1b[39m";

function borderTop(theme: Theme, title: string, width: number): string {
	const maxTitleLen = Math.max(0, width - 6);
	const styledTitle = visibleWidth(title) > maxTitleLen ? truncateToWidth(title, maxTitleLen) : title;
	const leftLen = 3 + visibleWidth(styledTitle) + 1; // "╔═ " + title + " "
	const dashCount = Math.max(0, width - leftLen - 1);
	return `${VIOLET}╔═ ${RESET}${styledTitle}${VIOLET} ${"═".repeat(dashCount)}╗${RESET}`;
}

function borderBottom(theme: Theme, bottomText: string, width: number): string {
	const maxTextLen = Math.max(0, width - 6);
	const styledText = visibleWidth(bottomText) > maxTextLen ? truncateToWidth(bottomText, maxTextLen) : bottomText;
	const leftLen = 3 + visibleWidth(styledText) + 1; // "╚═ " + bottomText + " "
	const dashCount = Math.max(0, width - leftLen - 1);
	return `${VIOLET}╚═ ${RESET}${styledText}${VIOLET} ${"═".repeat(dashCount)}╝${RESET}`;
}

function borderDivider(theme: Theme, title: string, width: number): string {
	const maxTitleLen = Math.max(0, width - 6);
	const styledTitle = visibleWidth(title) > maxTitleLen ? truncateToWidth(title, maxTitleLen) : title;
	const leftLen = 3 + visibleWidth(styledTitle) + 1; // "╠═ " + title + " "
	const dashCount = Math.max(0, width - leftLen - 1);
	return `${VIOLET}╠═ ${RESET}${styledTitle}${VIOLET} ${"═".repeat(dashCount)}╣${RESET}`;
}

function boxedLine(theme: Theme, content: string, width: number): string {
	const innerWidth = Math.max(0, width - 2);
	const truncated = truncateToWidth(content, innerWidth, "…");
	const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
	return `${VIOLET}║${RESET}${truncated}${pad}${VIOLET}║${RESET}`;
}

function loadStats(ctx: ExtensionContext | ExtensionCommandContext, pi: ExtensionAPI): WelcomeStats {
	const cwd = ctx.cwd ?? process.cwd();
	const agentDir = path.join(os.homedir(), ".pi", "agent");

	// 1. Git branch
	let gitBranch = "no git";
	try {
		const gitHeadPath = path.join(cwd, ".git", "HEAD");
		if (fs.existsSync(gitHeadPath)) {
			const headContent = fs.readFileSync(gitHeadPath, "utf8").trim();
			if (headContent.startsWith("ref: refs/heads/")) {
				gitBranch = headContent.replace("ref: refs/heads/", "");
			} else {
				gitBranch = headContent.slice(0, 7);
			}
		}
	} catch {
		gitBranch = "no git";
	}

	// 2. Model
	const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
	const thinkingLevel = ctx.thinkingLevel ?? "default";

	let activeProfile: string | undefined;
	try {
		const activePath = path.join(agentDir, "profiles", ".active");
		if (fs.existsSync(activePath)) {
			activeProfile = fs.readFileSync(activePath, "utf-8").trim() || undefined;
		}
	} catch {}

	// 3. Context files
	const contextFiles: string[] = [];
	const possibleContextFiles = ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "SPEC.md"];
	for (const cf of possibleContextFiles) {
		if (fs.existsSync(path.join(cwd, cf))) {
			contextFiles.push(cf);
		}
	}

	// 4. Skills
	const skillsSet = new Set<string>();
	const globalSkillsDir = path.join(agentDir, "skills");
	if (fs.existsSync(globalSkillsDir)) {
		try {
			for (const entry of fs.readdirSync(globalSkillsDir, { withFileTypes: true })) {
				if (entry.isDirectory() && !entry.name.startsWith("_")) {
					skillsSet.add(entry.name);
				}
			}
		} catch {}
	}

	let settingsPackages: string[] = [];
	try {
		const rawSettings = fs.readFileSync(path.join(agentDir, "settings.json"), "utf8");
		const parsed = JSON.parse(rawSettings);
		if (Array.isArray(parsed.packages)) {
			settingsPackages = parsed.packages
				.map((pkg: unknown) => {
					if (typeof pkg === "string") return pkg;
					if (typeof pkg === "object" && pkg !== null && "source" in pkg && typeof (pkg as any).source === "string") {
						return (pkg as any).source as string;
					}
					return undefined;
				})
				.filter((pkg): pkg is string => typeof pkg === "string");
		}
	} catch {}

	for (const pkg of settingsPackages) {
		const cleanName = pkg.replace(/^npm:/, "").split("@")[0];
		const pkgJsonPath = path.join(agentDir, "npm", "node_modules", cleanName, "package.json");
		if (fs.existsSync(pkgJsonPath)) {
			try {
				const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
				const skillsRel = pkgJson?.pi?.skills?.[0];
				if (skillsRel) {
					const fullSkillsDir = path.join(agentDir, "npm", "node_modules", cleanName, skillsRel);
					if (fs.existsSync(fullSkillsDir)) {
						for (const entry of fs.readdirSync(fullSkillsDir, { withFileTypes: true })) {
							if (entry.isDirectory() && !entry.name.startsWith("_")) {
								skillsSet.add(entry.name);
							}
						}
					}
				}
			} catch {}
		}
	}

	// Also query pi commands
	try {
		const allCmds = pi.getCommands();
		for (const cmd of allCmds) {
			if (cmd.source === "skill") {
				skillsSet.add(cmd.name);
			}
		}
	} catch {}

	// 5. Prompts
	const promptsSet = new Set<string>();
	const globalPromptsDir = path.join(agentDir, "prompts");
	if (fs.existsSync(globalPromptsDir)) {
		try {
			for (const f of fs.readdirSync(globalPromptsDir)) {
				if (f.endsWith(".md")) promptsSet.add("/" + f.replace(/\.md$/, ""));
			}
		} catch {}
	}
	for (const pkg of settingsPackages) {
		const cleanName = pkg.replace(/^npm:/, "").split("@")[0];
		const pkgJsonPath = path.join(agentDir, "npm", "node_modules", cleanName, "package.json");
		if (fs.existsSync(pkgJsonPath)) {
			try {
				const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
				const promptsRel = pkgJson?.pi?.prompts?.[0];
				if (promptsRel) {
					const fullPromptsDir = path.join(agentDir, "npm", "node_modules", cleanName, promptsRel);
					if (fs.existsSync(fullPromptsDir)) {
						for (const f of fs.readdirSync(fullPromptsDir)) {
							if (f.endsWith(".md")) promptsSet.add("/" + f.replace(/\.md$/, ""));
						}
					}
				}
			} catch {}
		}
	}

	// 6. Extensions
	const extensionsList: string[] = [];
	for (const pkg of settingsPackages) {
		const cleanName = pkg.replace(/^npm:/, "");
		extensionsList.push(cleanName);
	}
	const globalExtDir = path.join(agentDir, "extensions");
	if (fs.existsSync(globalExtDir)) {
		try {
			for (const f of fs.readdirSync(globalExtDir)) {
				if (f.endsWith(".ts") || f.endsWith(".js")) {
					extensionsList.push(f);
				}
			}
		} catch {}
	}

	// 7. Custom tools count
	let customToolsCount = 0;
	try {
		const allTools = pi.getAllTools();
		customToolsCount = allTools.filter(
			(t) => !["builtin", "sdk"].includes(t.sourceInfo?.source ?? ""),
		).length;
	} catch {}

	return {
		version: VERSION,
		gitBranch,
		model,
		activeProfile,
		thinkingLevel,
		contextFiles,
		skills: Array.from(skillsSet).sort(),
		prompts: Array.from(promptsSet).sort(),
		extensions: Array.from(new Set(extensionsList)).sort(),
		customToolsCount,
		pendingUpdates: [],
	};
}

class GentlemanWelcomeWidget implements Component {
	private expanded: boolean = false;
	private cachedStats: WelcomeStats | null = null;
	private lastStatsFetch: number = 0;

	constructor(
		private readonly getContext: () => ExtensionContext | ExtensionCommandContext,
		private readonly theme: Theme,
		private readonly pi: ExtensionAPI,
		defaultExpanded: boolean = false,
	) {
		this.expanded = defaultExpanded;
	}

	public setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	public isExpanded(): boolean {
		return this.expanded;
	}

	public toggle(): void {
		this.expanded = !this.expanded;
	}

	public refreshStats(): void {
		this.cachedStats = null;
		this.lastStatsFetch = 0;
	}

	private getStats(): WelcomeStats {
		const now = Date.now();
		if (!this.cachedStats || now - this.lastStatsFetch > 10_000) {
			this.cachedStats = loadStats(this.getContext(), this.pi);
			this.lastStatsFetch = now;
			// Refresh git branch asynchronously if detached or empty
			const ctx = this.getContext();
			if (ctx.cwd) {
				execAsync(`git -C "${ctx.cwd}" branch --show-current`)
					.then(({ stdout }) => {
						const b = stdout.trim();
						if (b && this.cachedStats) this.cachedStats.gitBranch = b;
					})
					.catch(() => {});
			}
		}
		return this.cachedStats;
	}

	render(width: number): string[] {
		const theme = this.theme;
		const stats = this.getStats();
		const safeWidth = Math.max(48, width);

		// Colors
		const cAccent = (s: string) => safeThemeFg(theme, "accent", s, "text");
		const cHeading = (s: string) => safeThemeFg(theme, "mdHeading", s, "accent");
		const cSuccess = (s: string) => safeThemeFg(theme, "success", s, "accent");
		const cWarning = (s: string) => safeThemeFg(theme, "warning", s, "accent");
		const cText = (s: string) => safeThemeFg(theme, "text", s, "text");
		const cMuted = (s: string) => safeThemeFg(theme, "muted", s, "dim");
		const cDim = (s: string) => safeThemeFg(theme, "dim", s, "dim");

		const themeName = theme.name || "Cinlodev CUTE";
		const lines: string[] = [];

		// Header row
		const topTitle = `${cAccent("◆ " + themeName)} ${cDim("·")} ${cHeading("la Gentlewoman")}`;
		lines.push(borderTop(theme, topTitle, safeWidth));

		// Meta line
		const branchLabel = stats.gitBranch !== "no git" ? cSuccess(` ${stats.gitBranch}`) : cDim("no git");
		const displayModel = safeWidth < 90 ? shortModelName(stats.model) : stats.model;
		const modelLabel = `${cMuted("Model: ")}${cHeading(displayModel)}`;
		const profileBadge = stats.activeProfile ? ` ${cDim("│")} ${cMuted("Profile: ")}${cAccent(stats.activeProfile)}` : "";
		const contextLabel = stats.contextFiles.length > 0
			? `${cMuted("Context: ")}${cText(stats.contextFiles.join(", "))}`
			: `${cDim("Context: none")}`;

		let metaRow = `  ${cAccent(`Pi v${stats.version}`)} ${cDim("│")} ${branchLabel} ${cDim("│")} ${modelLabel}${profileBadge} ${cDim("│")} ${contextLabel}`;
		if (visibleWidth(metaRow) > safeWidth - 2 && safeWidth < 70) {
			metaRow = `  ${cAccent(`Pi v${stats.version}`)} ${cDim("│")} ${branchLabel} ${cDim("│")} ${modelLabel}${profileBadge}`;
		}
		lines.push(boxedLine(theme, metaRow, safeWidth));

		if (!this.expanded) {
			// Compact view (3 lines inside card)
			const skillsCount = `${cHeading("󰘳 " + stats.skills.length + " skills")}`;
			const extCount = `${cText(stats.extensions.length + " extensions")}`;
			const promptCount = stats.prompts.length > 0 ? `${cHeading(stats.prompts[0])}` : `${cDim("0 prompts")}`;
			const toolsBadge = stats.customToolsCount > 0 ? `${cSuccess(stats.customToolsCount + " tools")}` : "";

			const summaryBadges = [skillsCount, extCount, promptCount, toolsBadge].filter(Boolean).join(cDim(" · "));
			lines.push(boxedLine(theme, `  ${summaryBadges}`, safeWidth));

			let hotkeys = `${cDim("[Esc]")} ${cMuted("interrupt")} ${cDim("·")} ${cDim("[/]")} ${cMuted("commands")} ${cDim("·")} ${cDim("[!]")} ${cMuted("bash")} ${cDim("·")} ${cAccent("[^O]")} ${cAccent("expand dashboard")}`;
			if (safeWidth < 80) {
				hotkeys = `${cDim("[Esc]")} ${cMuted("interrupt")} ${cDim("·")} ${cDim("[/]")} ${cMuted("cmd")} ${cDim("·")} ${cAccent("[^O]")} ${cAccent("expand")}`;
			}
			if (safeWidth < 60) {
				hotkeys = `${cDim("[Esc]")} ${cMuted("interrupt")} ${cDim("·")} ${cAccent("[^O]")} ${cAccent("expand")}`;
			}
			lines.push(borderBottom(theme, hotkeys, safeWidth));
			return lines;
		}

		// Expanded view: Full cards
		// 1. Skills card
		lines.push(borderDivider(theme, `${cHeading("󰘳 Skills")} ${cDim(`(${stats.skills.length})`)}`, safeWidth));

		if (stats.skills.length === 0) {
			lines.push(boxedLine(theme, `  ${cDim("No skills detected")}`, safeWidth));
		} else {
			let currentLine = "  ";
			for (const skill of stats.skills) {
				const pill = `${cAccent("◆")} ${cText(skill)}`;
				const candidate = currentLine === "  " ? currentLine + pill : currentLine + cDim("  ·  ") + pill;
				if (visibleWidth(candidate) > safeWidth - 6) {
					lines.push(boxedLine(theme, currentLine, safeWidth));
					currentLine = "  " + pill;
				} else {
					currentLine = candidate;
				}
			}
			if (currentLine !== "  ") {
				lines.push(boxedLine(theme, currentLine, safeWidth));
			}
		}

		// 2. Extensions & Prompts card
		lines.push(borderDivider(theme, `${cHeading("󰏔 Extensions & Prompts")}`, safeWidth));

		// Extensions line
		const shortExt = stats.extensions.map((e) => e.replace(/\.ts$/, "").replace(/\.js$/, ""));
		let extLine = `  ${cMuted("Extensions: ")}`;
		for (const ext of shortExt) {
			const pill = cText(ext);
			const candidate = extLine === `  ${cMuted("Extensions: ")}` ? extLine + pill : extLine + cDim(" · ") + pill;
			if (visibleWidth(candidate) > safeWidth - 6) {
				lines.push(boxedLine(theme, extLine, safeWidth));
				extLine = `    ${pill}`;
			} else {
				extLine = candidate;
			}
		}
		if (extLine.trim().length > 0) {
			lines.push(boxedLine(theme, extLine, safeWidth));
		}

		// Prompts & Tools line
		const promptsText = stats.prompts.length > 0 ? stats.prompts.join(", ") : "none";
		const toolsText = stats.customToolsCount > 0 ? `${stats.customToolsCount} active` : "builtin only";
		lines.push(
			boxedLine(
				theme,
				`  ${cMuted("Prompts: ")}${cHeading(promptsText)} ${cDim("│")} ${cMuted("Tools: ")}${cSuccess(toolsText)}`,
				safeWidth,
			),
		);

		// Bottom border
		const hotkeys = `${cDim("[Esc]")} ${cMuted("interrupt")} ${cDim("·")} ${cDim("[/]")} ${cMuted("commands")} ${cDim("·")} ${cDim("[!]")} ${cMuted("bash")} ${cDim("·")} ${cAccent("[^O]")} ${cAccent("collapse")}`;
		lines.push(borderBottom(theme, hotkeys, safeWidth));

		return lines;
	}

	invalidate(): void {
		// Do not wipe cached stats on regular TUI invalidation (e.g. keypresses)
	}
}

export default function (pi: ExtensionAPI) {
	let currentWidget: GentlemanWelcomeWidget | null = null;
	let activeTui: any = null;
	let welcomeVisible = true;
	let defaultMode: "compact" | "full" = "compact";

	const applyWelcomeHeader = (ctx: ExtensionContext | ExtensionCommandContext) => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;

		if (!welcomeVisible) {
			ctx.ui.setHeader(undefined);
			return;
		}

		ctx.ui.setHeader((tui, theme) => {
			activeTui = tui;
			currentWidget = new GentlemanWelcomeWidget(
				() => ctx,
				theme,
				pi,
				defaultMode === "full",
			);
			return currentWidget;
		});
	};

	// Register commands
	pi.registerCommand("welcome", {
		description: "Configure or toggle the Gentlewoman Welcome Dashboard (/welcome, /welcome full, /welcome compact, /welcome off)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const arg = args.trim().toLowerCase();

			if (arg === "off" || arg === "hide") {
				welcomeVisible = false;
				applyWelcomeHeader(ctx);
				ctx.ui.notify("Gentlewoman Welcome Dashboard ocultado", "info");
				return;
			}

			if (arg === "on" || arg === "show") {
				welcomeVisible = true;
				applyWelcomeHeader(ctx);
				ctx.ui.notify("Gentlewoman Welcome Dashboard activado", "info");
				return;
			}

			if (arg === "full" || arg === "expand") {
				welcomeVisible = true;
				defaultMode = "full";
				if (currentWidget) {
					currentWidget.setExpanded(true);
					activeTui?.requestRender?.();
				} else {
					applyWelcomeHeader(ctx);
				}
				ctx.ui.notify("Gentlewoman Welcome Dashboard: modo expandido", "info");
				return;
			}

			if (arg === "compact" || arg === "mini") {
				welcomeVisible = true;
				defaultMode = "compact";
				if (currentWidget) {
					currentWidget.setExpanded(false);
					activeTui?.requestRender?.();
				} else {
					applyWelcomeHeader(ctx);
				}
				ctx.ui.notify("Gentlewoman Welcome Dashboard: modo compacto", "info");
				return;
			}

			if (arg === "reload" || arg === "refresh") {
				if (currentWidget) {
					currentWidget.refreshStats();
					activeTui?.requestRender?.();
				}
				ctx.ui.notify("Gentlewoman Welcome Dashboard actualizado", "info");
				return;
			}

			// Default toggle
			if (currentWidget) {
				currentWidget.toggle();
				activeTui?.requestRender?.();
				ctx.ui.notify(
					`Gentlewoman Welcome Dashboard: ${currentWidget.isExpanded() ? "modo expandido" : "modo compacto"}`,
					"info",
				);
			} else {
				welcomeVisible = !welcomeVisible;
				applyWelcomeHeader(ctx);
				ctx.ui.notify(
					welcomeVisible ? "Gentlewoman Welcome Dashboard activado" : "Gentlewoman Welcome Dashboard desactivado",
					"info",
				);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		applyWelcomeHeader(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		if (currentWidget) {
			currentWidget.refreshStats();
			activeTui?.requestRender?.();
		}
	});

	pi.on("before_agent_start", async (event) => {
		let prompt = event.systemPrompt || "";

		// Reemplazar referencias de Gentleman por Gentlewoman
		prompt = prompt
			.replaceAll("el Gentleman", "la Gentlewoman")
			.replaceAll("El Gentleman", "La Gentlewoman");

		const gentlewomanContract = `

## Identity & Persona Override: la Gentlewoman
- Identidad: Sos **la Gentlewoman**, una arquitecta de software senior, mentora técnica y compañera de desarrollo para Cinlo (cinlodev).
- Voz y género gramatical: Hablá y referite a vos misma SIEMPRE en femenino (por ejemplo: "la Gentlewoman", "tu arquitecta senior", "lista para laburar", "enfocada", "preparada", "tranquila", "segura"). NUNCA uses términos masculinos para referirte a vos misma (nada de "el Gentleman", "listo", "enfocado", "arquitecto", etc.).
- Interlocutora: Cinlo es mujer y desarrolladora (cinlodev). Tratala como tal, con calidez, camaradería y respeto.
- Tono y lenguaje: Español rioplatense natural con voseo (vos sos, vos tenés, fijate, contame, laburemos), directo, cálido, riguroso a nivel técnico y sin rodeos.
`;

		return {
			systemPrompt: prompt + gentlewomanContract,
		};
	});
}
