import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { resetActiveProfileCache, readActiveProfile } from "./cute-paths.ts";
import { cuteGlyphs, cutePalette, safeFg, bolden } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";
import { getCachedAccounts, getQuotaThreshold, triggerUsageRefresh, fetchUsageAccounts, formatRelativeReset, type QuotaPoolDisplay } from "./cute-usage.ts";

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

	handleRailWheel(_wheelDelta: number): boolean {
		// Disable profile switching via mouse wheel so wheel scroll naturally scrolls the sidebar content
		return false;
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
			violet: (s: string) => (theme ? safeFg(theme, "border", s) : s),
			celeste: (s: string) => (theme ? safeFg(theme, "write", s) : s),
			salmon: (s: string) => (theme ? safeFg(theme, "salmon", s) : s),
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

		const availableProfiles = listAvailableProfiles(this.cwd);
		const profilesToRender: ProfileItem[] =
			availableProfiles.length > 0
				? availableProfiles
				: [{ name: "default", active: true, source: "builtin" }];

		const activeDetails = getActiveProfileDetails(this.cwd) || {
			name: profilesToRender.find((p) => p.active)?.name || profilesToRender[0]?.name || "default",
			default_model: "default",
			default_effort: "high",
		};
		const activeName = (activeDetails.name || "").toLowerCase();

		const clusterButtons = profilesToRender.map((item, idx) => {
			const num = idx + 1;
			const isActive = item.active || item.name.toLowerCase() === activeName;
			const dot = isActive ? "●" : "○";
			const raw = `[${dot} ${num}: ${item.name}]`;
			const styled = isActive
				? c.pinkBright(c.bold(raw))
				: `${c.dim(`[○ ${num}: `)}${c.muted(item.name)}${c.dim("]")}`;
			return {
				name: item.name,
				styled,
				len: calcVisibleWidth(raw),
			};
		});

		const lines: string[] = [top];

		// Dynamic line wrapping for profile buttons
		let currentLineButtons: typeof clusterButtons = [];
		let currentLineWidth = 0;

		const flushButtonLine = () => {
			if (currentLineButtons.length === 0) return;
			const currentLineIndex = lines.length;
			let currentX = 2; // initial left border + 1 space padding

			for (let i = 0; i < currentLineButtons.length; i++) {
				const btn = currentLineButtons[i];
				this.switcherHitboxes.push({
					profileName: btn.name,
					lineIndex: currentLineIndex,
					startX: currentX,
					endX: currentX + btn.len,
				});
				currentX += btn.len + 1; // button width + space
			}

			const lineContent = currentLineButtons.map((b) => b.styled).join(" ");
			lines.push(boxLine(lineContent));
			currentLineButtons = [];
			currentLineWidth = 0;
		};

		for (const btn of clusterButtons) {
			const spaceNeeded = currentLineWidth > 0 ? 1 + btn.len : btn.len;
			if (currentLineWidth + spaceNeeded <= innerWidth) {
				currentLineButtons.push(btn);
				currentLineWidth += spaceNeeded;
			} else {
				flushButtonLine();
				currentLineButtons.push(btn);
				currentLineWidth = btn.len;
			}
		}
		flushButtonLine();

		// Divider between switchers and agents
		lines.push(divider);

		triggerUsageRefresh(this.ctx, this.tui, 15000);
		const cachedAccounts = getCachedAccounts();

		const getAccountModelPools = (
			account: string,
			model: string,
		): {
			hasAccount: boolean;
			pool5h?: { pct: number; threshold: any; resetStr: string };
			poolWeekly?: { pct: number; threshold: any; resetStr: string };
		} => {
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
				return { hasAccount: false };
			}

			const modelLower = model.toLowerCase();
			let candidatePools: QuotaPoolDisplay[] = matching.pools;

			if (modelLower.includes("gemini")) {
				const geminiPools = matching.pools.filter((p: QuotaPoolDisplay) => /gemini/i.test(p.label));
				if (geminiPools.length > 0) candidatePools = geminiPools;
			} else if (modelLower.includes("claude") || modelLower.includes("gpt")) {
				const claudeGptPools = matching.pools.filter((p: QuotaPoolDisplay) => /claude|gpt/i.test(p.label));
				if (claudeGptPools.length > 0) candidatePools = claudeGptPools;
			}

			const raw5h = candidatePools.find((p) => /5\s*h|five\s*hour/i.test(p.label));
			const rawWeekly = candidatePools.find((p) => /week|seman/i.test(p.label));

			let final5h = raw5h;
			let finalWeekly = rawWeekly;

			// Fallback si no coinciden exactamente los nombres de 5h o Weekly
			if (!final5h && !finalWeekly && candidatePools.length > 0) {
				if (candidatePools.length === 1) {
					final5h = candidatePools[0];
				} else {
					final5h = candidatePools[0];
					finalWeekly = candidatePools[1];
				}
			}

			const toPoolInfo = (p?: QuotaPoolDisplay) => {
				if (!p) return undefined;
				const pct = Math.round(p.availablePercent);
				const threshold = getQuotaThreshold(p.availablePercent, c);
				const resetStr = formatRelativeReset(p.resetAt);
				return { pct, threshold, resetStr };
			};

			return {
				hasAccount: true,
				pool5h: toPoolInfo(final5h),
				poolWeekly: toPoolInfo(finalWeekly),
			};
		};

		const cellWidth = Math.max(1, calcVisibleWidth(g.gaugeFilled) || 1);
		const barCells = Math.max(4, Math.floor(innerWidth / cellWidth));

		const renderFullGaugeBar = (quota?: { pct: number; threshold: any }): string => {
			if (!quota) {
				return c.dim(g.gaugeEmpty.repeat(barCells));
			}
			const filled = Math.min(barCells, Math.max(0, Math.round((quota.pct / 100) * barCells)));
			const empty = Math.max(0, barCells - filled);
			return `${quota.threshold.color(g.gaugeFilled.repeat(filled))}${c.dim(g.gaugeEmpty.repeat(empty))}`;
		};

		const renderModelQuotaBars = (
			account: string,
			quotaInfo: ReturnType<typeof getAccountModelPools>,
		): void => {
			if (!quotaInfo.hasAccount || (!quotaInfo.pool5h && !quotaInfo.poolWeekly)) {
				lines.push(boxLine(c.mint(`@${account}`), c.dim("sin cuota")));
				lines.push(boxLine(renderFullGaugeBar(undefined)));
				return;
			}

			// Barra 1: 5h Window
			if (quotaInfo.pool5h) {
				const p5 = quotaInfo.pool5h;
				const left5h = `${c.mint(`@${account}`)} ${c.dim("·")} ${c.muted("5h")}`;
				const pctText = c.bold(p5.threshold.color(`${p5.pct}%`));
				const right5h = p5.resetStr ? `${pctText} ${c.dim(`(${p5.resetStr})`)}` : pctText;
				lines.push(boxLine(left5h, right5h));
				lines.push(boxLine(renderFullGaugeBar(p5)));
			}

			// Barra 2: Weekly Limit
			if (quotaInfo.poolWeekly) {
				const pw = quotaInfo.poolWeekly;
				const leftWeekly = `${c.muted("Semanal")}`;
				const pctText = c.bold(pw.threshold.color(`${pw.pct}%`));
				const rightWeekly = pw.resetStr ? `${pctText} ${c.dim(`(${pw.resetStr})`)}` : pctText;
				lines.push(boxLine(leftWeekly, rightWeekly));
				lines.push(boxLine(renderFullGaugeBar(pw)));
			}
		};

		// 2. Host row
		const hostModel = activeDetails.default_model || "default";
		const hostEffort = activeDetails.default_effort || "high";
		const hostAccount = (activeDetails as any).default_account || extractAccountFromModel(hostModel) || "host";
		const shortHost = shortModelName(hostModel).replace(/-high$/, "");

		// Line 1: Host title + model
		const hostLeft = `${c.violet("🎯")} ${c.bold(c.violet("host / orquestador"))}`;
		const hostMeta = `${c.gold(shortHost)} ${c.dim(`(${hostEffort})`)}`;
		if (calcVisibleWidth("🎯 host / orquestador") + calcVisibleWidth(`${shortHost} (${hostEffort})`) + 2 <= innerWidth) {
			lines.push(boxLine(hostLeft, hostMeta));
		} else {
			lines.push(boxLine(hostLeft));
			lines.push(boxLine(`  ${hostMeta}`));
		}

		// Quota bars (5h y Semanal)
		const hostQuota = getAccountModelPools(hostAccount, hostModel);
		renderModelQuotaBars(hostAccount, hostQuota);

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

		const getAgentStyle = (agentId: string) => {
			if (agentId.startsWith("gentle-ai-")) {
				// ODD Core: Celeste
				return { bullet: c.celeste("•"), name: (s: string) => c.celeste(s) };
			}
			if (agentId.startsWith("jd-")) {
				// Judgment Day: Dorado
				return { bullet: c.gold("•"), name: (s: string) => c.gold(s) };
			}
			if (agentId.startsWith("review-")) {
				// Review Lenses: Menta
				return { bullet: c.mint("•"), name: (s: string) => c.mint(s) };
			}
			if (agentId.startsWith("research-")) {
				// Deep Research: Salmón
				return { bullet: c.salmon("•"), name: (s: string) => c.salmon(s) };
			}
			// Fallback / Extra agents: Pink accent
			return { bullet: c.pink("•"), name: (s: string) => c.text(s) };
		};

		for (const agentId of allAgentIds) {
			lines.push(boxLine(""));

			const agentCfg = activeDetails.model_profiles?.[agentId];
			const model = agentCfg?.model || hostModel;
			const effort = agentCfg?.effort || hostEffort;
			const account = (agentCfg as any)?.account || extractAccountFromModel(agentCfg?.model) || hostAccount;
			const shortAgent = shortModelName(model).replace(/-high$/, "");

			const agentQuota = getAccountModelPools(account, model);
			const style = getAgentStyle(agentId);

			// Line 1: If name + model fits in one line, keep it together; otherwise put model on its own subline
			const leftText = `${style.bullet} ${style.name(agentId)}`;
			const rightText = `${c.gold(shortAgent)} ${c.dim(`(${effort})`)}`;
			if (calcVisibleWidth(`• ${agentId}`) + calcVisibleWidth(`${shortAgent} (${effort})`) + 2 <= innerWidth) {
				lines.push(boxLine(leftText, rightText));
			} else {
				lines.push(boxLine(leftText));
				lines.push(boxLine(`  ${rightText}`));
			}

			// Quota bars (5h y Semanal)
			renderModelQuotaBars(account, agentQuota);
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
