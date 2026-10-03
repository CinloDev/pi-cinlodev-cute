import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { resetActiveProfileCache, readActiveProfile } from "./cute-paths.ts";
import { cuteGlyphs, cutePalette, safeFg, bolden } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";
import { getCachedAccounts, getQuotaThreshold, triggerUsageRefresh, fetchUsageAccounts } from "./cute-usage.ts";

export const SDD_PROFILES_API_SYMBOL = Symbol.for("cinlodev.sdd-profiles.api");
export { fetchUsageAccounts as fetchQuotaAccounts } from "./cute-usage.ts";

export interface ProfileItem {
	name: string;
	description?: string;
	active: boolean;
	source: "project" | "global" | "builtin";
}

export interface AgentProfileConfig {
	model?: string;
	effort?: string;
	account?: string;
}

export interface FullProfileData {
	name: string;
	description?: string;
	default_model?: string;
	default_effort?: string;
	default_account?: string;
	model_profiles?: Record<string, AgentProfileConfig | { model?: string; effort?: string; account?: string }>;
	created_at?: string;
	updated_at?: string;
	[key: string]: any;
}

export interface TaskManagerSummary {
	total: number;
	completed: number;
	inProgress: number;
	pending: number;
	currentTaskTitle?: string;
}

export interface SwitcherHitbox {
	profileName: string;
	lineIndex: number;
	startX: number;
	endX: number;
}

export interface SddProfilesRuntimeApi {
	listProfiles(): Array<{ name: string; description?: string; active?: boolean; source?: "project" | "global" | "builtin" }>;
	getActiveProfile(): string | null;
	activateProfile(name: string, scope?: "project" | "global"): Promise<{ success: boolean; message: string; profile?: any }>;
}

export function getSddProfilesApi(): SddProfilesRuntimeApi | null {
	const globalApi = (globalThis as any)[SDD_PROFILES_API_SYMBOL];
	if (globalApi && typeof globalApi.listProfiles === "function") {
		return globalApi as SddProfilesRuntimeApi;
	}
	return null;
}

/**
 * Extracts account name from model string format such as:
 * - cpamc/<account>/<model>
 * - cpam/<account>/<model>
 * - proxy/<account>/<model>
 */
export function extractAccountFromModel(model?: string): string | null {
	if (!model || typeof model !== "string") return null;
	const trimmed = model.trim();
	if (!trimmed) return null;

	const parts = trimmed.split("/");
	if (parts.length >= 3) {
		const prefix = parts[0].toLowerCase();
		if (prefix === "cpamc" || prefix === "cpam" || prefix === "proxy") {
			const account = parts[1].trim();
			return account.length > 0 ? account : null;
		}
	}
	return null;
}

/**
 * Extracts unique accounts used across host and all subagents in the profile.
 */
export function extractUniqueAccounts(profile: FullProfileData): string[] {
	if (!profile) return [];
	const accounts: string[] = [];

	const add = (acc?: string | null) => {
		if (!acc) return;
		const trimmed = acc.trim();
		if (trimmed && !accounts.includes(trimmed)) {
			accounts.push(trimmed);
		}
	};

	// 1. Host account
	add((profile as any).default_account || extractAccountFromModel(profile.default_model));

	// 2. Specific key agents in prioritized order
	const priorityKeys = [
		"gentle-ai-worker",
		"gentle-ai-explore",
		"gentle-ai-verify",
		"jd-judge-a",
		"jd-judge-b",
		"jd-fix-agent",
		"review-risk",
		"review-readability",
		"review-reliability",
		"review-resilience",
		"research-scout",
		"research-writer",
	];

	if (profile.model_profiles && typeof profile.model_profiles === "object") {
		for (const key of priorityKeys) {
			const cfg = profile.model_profiles[key];
			if (cfg && typeof cfg === "object") {
				add((cfg as any).account || extractAccountFromModel((cfg as any).model));
			}
		}

		for (const [key, cfg] of Object.entries(profile.model_profiles)) {
			if (!priorityKeys.includes(key) && cfg && typeof cfg === "object") {
				add((cfg as any).account || extractAccountFromModel((cfg as any).model));
			}
		}
	}

	return accounts;
}

/**
 * Loads the full profile JSON configuration from project, global or builtin profiles.
 */
export function loadProfileDetails(name: string, cwd?: string): FullProfileData | null {
	const workingDir = cwd ?? process.cwd();
	const home = os.homedir();
	const projectDir = path.join(workingDir, ".pi", "profiles");
	const globalDir = path.join(home, ".pi", "agent", "profiles");
	const builtinDir = path.join(home, ".pi", "agent", "git", "github.com", "CinloDev", "pi-sdd-profiles", "profiles");

	const candidateDirs = [projectDir, globalDir, builtinDir];
	const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
	const candidateFiles = [`${name}.json`, `${name.toLowerCase()}.json`, `${slug}.json`];

	for (const dir of candidateDirs) {
		if (!fs.existsSync(dir)) continue;
		for (const cf of candidateFiles) {
			const candidatePath = path.join(dir, cf);
			if (fs.existsSync(candidatePath)) {
				try {
					const raw = fs.readFileSync(candidatePath, "utf-8");
					return JSON.parse(raw);
				} catch {}
			}
		}
		try {
			const entries = fs.readdirSync(dir);
			for (const file of entries) {
				if (!file.endsWith(".json")) continue;
				const filePath = path.join(dir, file);
				try {
					const raw = fs.readFileSync(filePath, "utf-8");
					const parsed = JSON.parse(raw);
					if (
						(parsed.name && parsed.name.toLowerCase() === name.toLowerCase()) ||
						path.basename(file, ".json").toLowerCase() === name.toLowerCase()
					) {
						return parsed;
					}
				} catch {}
			}
		} catch {}
	}
	return null;
}

/**
 * Reads details of the currently active profile.
 */
export function getActiveProfileDetails(cwd?: string): FullProfileData | null {
	const api = getSddProfilesApi();
	let activeName: string | null = null;
	if (api) {
		try {
			activeName = api.getActiveProfile();
		} catch {}
	}

	if (!activeName) {
		const workingDir = cwd ?? process.cwd();
		const home = os.homedir();
		const projectDir = path.join(workingDir, ".pi", "profiles");
		const globalDir = path.join(home, ".pi", "agent", "profiles");
		const projectActivePath = path.join(projectDir, ".active");
		const globalActivePath = path.join(globalDir, ".active");

		if (fs.existsSync(projectActivePath)) {
			try {
				activeName = fs.readFileSync(projectActivePath, "utf-8").trim();
			} catch {}
		}
		if (!activeName && fs.existsSync(globalActivePath)) {
			try {
				activeName = fs.readFileSync(globalActivePath, "utf-8").trim();
			} catch {}
		}
	}

	if (activeName) {
		const details = loadProfileDetails(activeName, cwd);
		if (details) return details;
	}

	const available = listAvailableProfiles(cwd);
	const activeItem = available.find((p) => p.active) || available[0];
	if (activeItem) {
		const details = loadProfileDetails(activeItem.name, cwd);
		if (details) return details;
	}

	return null;
}

/**
 * Reads lightweight Task Manager status summary from project if available.
 */
export function getTaskManagerSummary(cwd?: string): TaskManagerSummary | null {
	const workingDir = cwd ?? process.cwd();
	const candidatePaths = [
		path.join(workingDir, ".pi", "task-manager.json"),
		path.join(workingDir, "task-manager.json"),
	];
	for (const p of candidatePaths) {
		if (fs.existsSync(p)) {
			try {
				const raw = fs.readFileSync(p, "utf-8");
				const data = JSON.parse(raw);
				const todos = Array.isArray(data.todos) ? data.todos : [];
				if (todos.length === 0) continue;
				const total = todos.length;
				const completed = todos.filter((t: any) => t.status === "completed" || t.done || t.completed).length;
				const inProgress = todos.filter((t: any) => t.status === "in_progress" || t.status === "running").length;
				const pending = total - completed - inProgress;
				const activeItem = todos.find((t: any) => t.status === "in_progress" || t.status === "running");
				return {
					total,
					completed,
					inProgress,
					pending,
					currentTaskTitle: activeItem?.title || activeItem?.text,
				};
			} catch {}
		}
	}
	return null;
}

function shortModelName(modelId: string): string {
	const parts = modelId.split("/");
	return parts.length > 1 ? parts[parts.length - 1] : modelId;
}

/**
 * List all available SDD profiles from runtime API or disk.
 */
export function listAvailableProfiles(cwd?: string): ProfileItem[] {
	const api = getSddProfilesApi();
	if (api) {
		try {
			const list = api.listProfiles();
			const activeName = api.getActiveProfile();
			return list.map((p) => ({
				name: p.name,
				description: p.description,
				active: p.active ?? (activeName ? p.name.toLowerCase() === activeName.toLowerCase() : false),
				source: p.source ?? "global",
			}));
		} catch {
			// Fallback to disk
		}
	}

	const workingDir = cwd ?? process.cwd();
	const home = os.homedir();
	const projectDir = path.join(workingDir, ".pi", "profiles");
	const globalDir = path.join(home, ".pi", "agent", "profiles");
	const builtinDir = path.join(home, ".pi", "agent", "git", "github.com", "CinloDev", "pi-sdd-profiles", "profiles");

	let activeName: string | null = null;
	const projectActivePath = path.join(projectDir, ".active");
	const globalActivePath = path.join(globalDir, ".active");

	if (fs.existsSync(projectActivePath)) {
		try {
			activeName = fs.readFileSync(projectActivePath, "utf-8").trim();
		} catch {}
	}
	if (!activeName && fs.existsSync(globalActivePath)) {
		try {
			activeName = fs.readFileSync(globalActivePath, "utf-8").trim();
		} catch {}
	}

	const profilesMap = new Map<string, ProfileItem>();

	const scanDir = (dir: string, source: "project" | "global" | "builtin") => {
		if (!fs.existsSync(dir)) return;
		try {
			const entries = fs.readdirSync(dir);
			for (const file of entries) {
				if (!file.endsWith(".json")) continue;
				const filePath = path.join(dir, file);
				try {
					const raw = fs.readFileSync(filePath, "utf-8");
					const parsed = JSON.parse(raw);
					const name = parsed.name || path.basename(file, ".json");
					const key = name.toLowerCase();
					if (!profilesMap.has(key)) {
						profilesMap.set(key, {
							name,
							description: parsed.description,
							active: activeName ? key === activeName.toLowerCase() : false,
							source,
						});
					}
				} catch {}
			}
		} catch {}
	};

	// Project overrides global, which overrides builtin
	scanDir(projectDir, "project");
	scanDir(globalDir, "global");
	scanDir(builtinDir, "builtin");

	const list = Array.from(profilesMap.values());
	list.sort((a, b) => a.name.localeCompare(b.name));
	return list;
}

/**
 * Activate an SDD profile and sync runtime model and thinking if applicable.
 */
export async function switchProfile(
	profileName: string,
	ctx?: ExtensionContext,
	pi?: ExtensionAPI,
	cwd?: string,
): Promise<{ success: boolean; message: string }> {
	const api = getSddProfilesApi();
	if (api) {
		try {
			const res = await api.activateProfile(profileName);
			resetActiveProfileCache();
			return { success: res.success, message: res.message };
		} catch (err: any) {
			console.warn("[cute-profiles] Error activating via API, falling back to disk:", err);
		}
	}

	const workingDir = cwd ?? ctx?.cwd ?? process.cwd();
	const home = os.homedir();
	const projectDir = path.join(workingDir, ".pi", "profiles");
	const globalDir = path.join(home, ".pi", "agent", "profiles");

	const foundProfile = loadProfileDetails(profileName, workingDir);
	if (!foundProfile) {
		return { success: false, message: `Perfil "${profileName}" no encontrado.` };
	}

	const resolvedName = foundProfile.name || profileName;

	try {
		const targetActive = fs.existsSync(projectDir)
			? path.join(projectDir, ".active")
			: path.join(globalDir, ".active");
		fs.mkdirSync(path.dirname(targetActive), { recursive: true });
		fs.writeFileSync(targetActive, resolvedName, "utf-8");
	} catch {}

	if (ctx?.hasUI && typeof ctx?.ui?.setStatus === "function") {
		ctx.ui.setStatus("sdd-profile", `🤖 ${resolvedName}`);
	}

	if (foundProfile.default_model && pi && typeof pi.setModel === "function") {
		const sep = foundProfile.default_model.indexOf("/");
		if (sep !== -1) {
			const provider = foundProfile.default_model.slice(0, sep).trim();
			const modelId = foundProfile.default_model.slice(sep + 1).trim();

			let targetModel = ctx?.modelRegistry?.find?.(provider, modelId);
			if (!targetModel && typeof ctx?.modelRegistry?.getAvailable === "function") {
				try {
					const available = await ctx.modelRegistry.getAvailable();
					targetModel = available?.find?.(
						(m: any) =>
							(m.provider === provider || m.providerId === provider) &&
							(m.id === modelId || m.model === modelId || m.name === modelId),
					);
				} catch {}
			}

			if (targetModel) {
				try {
					await pi.setModel(targetModel);
				} catch {}
			}
		}
	}

	if (foundProfile.default_effort && pi && typeof pi.setThinkingLevel === "function") {
		try {
			pi.setThinkingLevel(foundProfile.default_effort);
		} catch {}
	}

	resetActiveProfileCache();
	return { success: true, message: `Perfil "${resolvedName}" activado.` };
}

/**
 * Extended SDD Profiles & Quotas Card for Sidebar.
 */
export class CinlodevProfilesExtendedCard implements Component {
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private readonly cwd?: string;
	private readonly ctx?: ExtensionContext;
	private readonly pi?: ExtensionAPI;
	private switcherHitboxes: SwitcherHitbox[] = [];

	constructor(tui?: TUI, theme?: Theme, cwd?: string, ctx?: ExtensionContext, pi?: ExtensionAPI) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.ctx = ctx;
		this.pi = pi;
	}

	getSwitcherHitboxes(): SwitcherHitbox[] {
		return [...this.switcherHitboxes];
	}

	handleRailClick(localLineIndex: number, _button?: string, localX?: number): boolean {
		if (localX !== undefined) {
			const hit = this.switcherHitboxes.find(
				(h) => h.lineIndex === localLineIndex && localX >= h.startX && localX <= h.endX,
			);
			if (hit) {
				switchProfile(hit.profileName, this.ctx, this.pi, this.cwd).then(() => {
					this.tui?.requestRender();
				});
				return true;
			}
		}

		return false;
	}

	handleRailWheel(wheelDelta: number): boolean {
		if (wheelDelta === 0) return false;
		const profiles = listAvailableProfiles(this.cwd);
		if (profiles.length <= 1) return false;
		const activeIdx = Math.max(0, profiles.findIndex((p) => p.active));
		const dir = wheelDelta > 0 ? 1 : -1;
		const nextIdx = (activeIdx + dir + profiles.length) % profiles.length;
		switchProfile(profiles[nextIdx].name, this.ctx, this.pi, this.cwd).then(() => {
			this.tui?.requestRender();
		});
		return true;
	}

	render(width: number): string[] {
		const theme = this.theme;
		const g = cuteGlyphs(theme);
		const colors = loadCuteColors();
		const palette = cutePalette(theme);
		const c = {
			...palette,
			accent: (s: string) => palette.pinkAccent(s),
			pink: (s: string) => palette.pinkAccent(s),
			pinkBright: (s: string) => (theme ? safeFg(theme, "pinkBright", s) : s),
			bold: (s: string) => bolden(theme, s),
		};

		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║
		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);

		const titleStr = `${c.pink(g.brand || "✿")} ${c.pinkBright("Profiles & Clusters")}`;
		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(titleStr) > maxTitleLen ? truncateAnsiAware(titleStr, maxTitleLen) : titleStr;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);
		const divider = frame(`${g.dividerL || "╠"}${g.h.repeat(safeWidth - 2)}${g.dividerR || "╣"}`);

		const boxLine = (left: string, right = ""): string => {
			let safeRight = right;
			if (calcVisibleWidth(safeRight) > innerWidth) {
				safeRight = truncateAnsiAware(safeRight, innerWidth);
			}
			const rightWidth = calcVisibleWidth(safeRight);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${safeRight} ${frame(g.v)}`;
		};

		this.switcherHitboxes = [];

		const allProfiles = listAvailableProfiles(this.cwd);
		const primaryProfiles = allProfiles.filter((p) => /^cinlo[1-4]$/i.test(p.name));
		primaryProfiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
		const otherProfiles = allProfiles.filter((p) => !/^cinlo[1-4]$/i.test(p.name));
		const profiles = primaryProfiles.length > 0 ? [...primaryProfiles, ...otherProfiles] : allProfiles;

		// 1. Profile switcher buttons at top
		interface SwitcherBtn {
			name: string;
			styled: string;
			len: number;
		}

		const buttons: SwitcherBtn[] = profiles.map((p, idx) => {
			const num = idx + 1;
			const dot = p.active ? "●" : "○";
			const raw = `[${dot} ${num}: ${p.name}]`;
			const styled = p.active
				? c.pinkBright(c.bold(raw))
				: `${c.dim(`[○ ${num}: `)}${c.muted(p.name)}${c.dim("]")}`;
			return {
				name: p.name,
				styled,
				len: calcVisibleWidth(raw),
			};
		});

		const btnLines: SwitcherBtn[][] = [];
		let currentLine: SwitcherBtn[] = [];
		let currentLineLen = 0;

		for (const btn of buttons) {
			const needed = currentLine.length === 0 ? btn.len : currentLineLen + 1 + btn.len;
			if (currentLine.length > 0 && needed > innerWidth) {
				btnLines.push(currentLine);
				currentLine = [btn];
				currentLineLen = btn.len;
			} else {
				currentLine.push(btn);
				currentLineLen = needed;
			}
		}
		if (currentLine.length > 0) {
			btnLines.push(currentLine);
		}

		const lines: string[] = [top];

		for (const lineBtns of btnLines) {
			const lineIndex = lines.length;
			let col = 0;
			const parts: string[] = [];

			for (let i = 0; i < lineBtns.length; i++) {
				const btn = lineBtns[i];
				if (i > 0) {
					parts.push(" ");
					col += 1;
				}
				const startX = 2 + col;
				const endX = startX + btn.len;
				this.switcherHitboxes.push({
					profileName: btn.name,
					lineIndex,
					startX,
					endX,
				});
				parts.push(btn.styled);
				col += btn.len;
			}

			lines.push(boxLine(parts.join("")));
		}

		// Divider between switchers and agents
		lines.push(divider);

		const activeDetails = getActiveProfileDetails(this.cwd) || {
			name: profiles.find((p) => p.active)?.name || "default",
			default_model: "default",
			default_effort: "high",
		};

		triggerUsageRefresh(this.ctx, this.tui, 15000);
		const cachedAccounts = getCachedAccounts();

		const renderQuotaGauge = (
			account: string,
			model: string,
			barCells = 10,
		): { hasQuota: boolean; quotaStr: string } => {
			let matching: any;
			if (cachedAccounts && cachedAccounts.length > 0) {
				const accLower = account.toLowerCase();
				matching = cachedAccounts.find(
					(a) =>
						a.prefix.toLowerCase() === accLower ||
						a.prefix.toLowerCase().includes(accLower) ||
						accLower.includes(a.prefix.toLowerCase()),
				);
			}

			if (!matching || !matching.pools || matching.pools.length === 0) {
				return {
					hasQuota: false,
					quotaStr: `${c.dim("[───]")} ${c.dim("sin cuota")}`,
				};
			}

			let pool = matching.pools[0];
			const modelLower = model.toLowerCase();
			if (modelLower.includes("gemini")) {
				const found = matching.pools.find((p: any) => /gemini/i.test(p.label));
				if (found) pool = found;
			} else if (modelLower.includes("claude") || modelLower.includes("gpt")) {
				const found = matching.pools.find((p: any) => /claude|gpt/i.test(p.label));
				if (found) pool = found;
			}

			const pct = Math.round(pool.availablePercent);
			const threshold = getQuotaThreshold(pool.availablePercent, c);
			const cells = Math.max(3, barCells);
			const filledCount = Math.round((pct / 100) * cells);
			const emptyCount = Math.max(0, cells - filledCount);
			const barStr = `${threshold.color(g.gaugeFilled.repeat(filledCount))}${c.dim(g.gaugeEmpty.repeat(emptyCount))}`;
			const pctStr = `\x1b[1m${threshold.color(`${pct}%`)}\x1b[22m`;

			return {
				hasQuota: true,
				quotaStr: `${barStr} ${pctStr}`,
			};
		};

		// 2. Host row
		const hostModel = activeDetails.default_model || "default";
		const hostEffort = activeDetails.default_effort || "high";
		const hostAccount = (activeDetails as any).default_account || extractAccountFromModel(hostModel) || "host";
		const shortHost = shortModelName(hostModel).replace(/-high$/, "");

		// Line 1: 🎯 host / orquestador · <shortModel> (<effort>)
		lines.push(boxLine(`${c.pink("🎯")} ${c.bold("host / orquestador")} ${c.dim("·")} ${c.gold(shortHost)} ${c.dim(`(${hostEffort})`)}`));

		// Line 2: @<account>  <gaugeBar> <pct>%
		const hostQuota = renderQuotaGauge(hostAccount, hostModel, 10);
		lines.push(boxLine(c.mint(`@${hostAccount}`), hostQuota.quotaStr));

		// 3. Flat agent rows
		const FLAT_AGENTS = [
			"gentle-ai-explore",
			"gentle-ai-worker",
			"gentle-ai-verify",
			"jd-judge-a",
			"jd-judge-b",
			"jd-fix-agent",
			"review-risk",
			"review-readability",
			"review-reliability",
			"review-resilience",
			"research-scout",
			"research-writer",
		];

		const extraAgents = Object.keys(activeDetails.model_profiles || {}).filter(
			(id) => !FLAT_AGENTS.includes(id),
		);
		const allAgentIds = [...FLAT_AGENTS, ...extraAgents];

		for (const agentId of allAgentIds) {
			const agentCfg = activeDetails.model_profiles?.[agentId];
			const model = agentCfg?.model || hostModel;
			const effort = agentCfg?.effort || hostEffort;
			const account = (agentCfg as any)?.account || extractAccountFromModel(agentCfg?.model) || hostAccount;
			const shortAgent = shortModelName(model).replace(/-high$/, "");

			const agentQuota = renderQuotaGauge(account, model, 10);

			let agentLine1 = `• ${c.text(agentId)}`;
			if (agentCfg?.model && shortAgent !== shortHost) {
				const withModel = `${agentLine1} ${c.dim("·")} ${c.gold(shortAgent)} ${c.dim(`(${effort})`)}`;
				agentLine1 = calcVisibleWidth(withModel) <= innerWidth ? withModel : `${agentLine1} ${c.dim(`(${effort})`)}`;
			} else {
				agentLine1 = `${agentLine1} ${c.dim(`(${effort})`)}`;
			}

			const inlineRight = `${c.mint(`@${account}`)}  ${agentQuota.quotaStr}`;
			if (innerWidth >= 54 && calcVisibleWidth(agentLine1) + calcVisibleWidth(inlineRight) + 2 <= innerWidth) {
				lines.push(boxLine(agentLine1, inlineRight));
			} else {
				lines.push(boxLine(agentLine1));
				lines.push(boxLine(`   ${c.mint(`@${account}`)}`, agentQuota.quotaStr));
			}
		}

		// 4. Task Manager status summary if available
		const tm = getTaskManagerSummary(this.cwd);
		if (tm && tm.total > 0) {
			lines.push(divider);
			const ratioStr = `${tm.completed}/${tm.total}`;
			const inProgStr = tm.inProgress > 0 ? ` · ${c.gold(`${tm.inProgress} en curso`)}` : "";
			lines.push(boxLine(`${c.accent("📋 Task Manager")}`, `${c.mint(ratioStr)}${inProgStr}`));
			if (tm.currentTaskTitle) {
				lines.push(boxLine(`   ▶ ${c.text(tm.currentTaskTitle)}`));
			}
		}

		lines.push(bottom);
		return lines;
	}
}
