import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resetActiveProfileCache as resetPathActiveProfileCache, readActiveProfile } from "../cute-paths.ts";

export const SDD_PROFILES_API_SYMBOL = Symbol.for("cinlodev.sdd-profiles.api");

const PROFILES_CACHE_TTL_MS = 3000;

interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

const listProfilesCache = new Map<string, CacheEntry<ProfileItem[]>>();
const profileDetailsCache = new Map<string, CacheEntry<FullProfileData | null>>();
let cachedBuiltinProfilesDir: string | null | undefined;

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

export interface SwitcherHitbox {
	type?: "profile" | "toggle-pagination" | "effort-host" | "effort-agent";
	profileName?: string;
	agentId?: string;
	lineIndex: number;
	startX: number;
	endX: number;
}

export interface SddProfilesRuntimeApi {
	listProfiles(): Array<{ name: string; description?: string; active?: boolean; source?: "project" | "global" | "builtin" }>;
	getActiveProfile(): string | null;
	activateProfile(name: string, scope?: "project" | "global"): Promise<{ success: boolean; message: string; profile?: any }>;
}

/**
 * Dynamically resolves the sdd-profiles builtin profiles directory without hardcoding
 * the GitHub organization or username.
 * Probes ~/.pi/agent/git/ for any directory matching *sdd-profiles* containing a profiles/ folder.
 */
export function findSddProfilesDir(): string | null {
	if (cachedBuiltinProfilesDir !== undefined) {
		return cachedBuiltinProfilesDir;
	}

	const home = os.homedir();
	const gitBase = path.join(home, ".pi", "agent", "git");
	if (!fs.existsSync(gitBase)) {
		cachedBuiltinProfilesDir = null;
		return null;
	}

	// 1. Direct probe for existing or common path
	const directCandidate = path.join(gitBase, "github.com", "CinloDev", "pi-sdd-profiles", "profiles");
	if (fs.existsSync(directCandidate)) {
		cachedBuiltinProfilesDir = directCandidate;
		return directCandidate;
	}

	// 2. Dynamic probe: search up to 3 levels under gitBase for *sdd-profiles*/profiles
	try {
		const queue: { dir: string; depth: number }[] = [{ dir: gitBase, depth: 0 }];
		while (queue.length > 0) {
			const { dir, depth } = queue.shift()!;
			if (depth > 3) continue;

			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const fullPath = path.join(dir, entry.name);
				if (entry.name.includes("sdd-profiles")) {
					const profilesSubdir = path.join(fullPath, "profiles");
					if (fs.existsSync(profilesSubdir)) {
						cachedBuiltinProfilesDir = profilesSubdir;
						return profilesSubdir;
					}
				}
				if (depth < 3) {
					queue.push({ dir: fullPath, depth: depth + 1 });
				}
			}
		}
	} catch {
		// Fallback safely
	}

	cachedBuiltinProfilesDir = null;
	return null;
}

export function resetProfilesCache(): void {
	listProfilesCache.clear();
	profileDetailsCache.clear();
	cachedBuiltinProfilesDir = undefined;
}

export function resetActiveProfileCache(): void {
	resetPathActiveProfileCache();
	resetProfilesCache();
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
 * Finds the absolute file path of a profile JSON on disk.
 */
export function resolveProfileFilePath(name: string, cwd?: string): string | null {
	const workingDir = cwd ?? process.cwd();
	const home = os.homedir();
	const projectDir = path.join(workingDir, ".pi", "profiles");
	const globalDir = path.join(home, ".pi", "agent", "profiles");

	const candidateDirs = [projectDir, globalDir];
	const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
	const candidateFiles = [`${name}.json`, `${name.toLowerCase()}.json`, `${slug}.json`];

	for (const dir of candidateDirs) {
		if (!fs.existsSync(dir)) continue;
		for (const cf of candidateFiles) {
			const candidatePath = path.join(dir, cf);
			if (fs.existsSync(candidatePath)) {
				return candidatePath;
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
						return filePath;
					}
				} catch {}
			}
		} catch {}
	}
	return null;
}

/**
 * Toggles effort level for an agent (or host) in a profile JSON:
 * low -> medium -> high -> low
 */
export function toggleProfileEffort(profileName: string, agentId?: string, cwd?: string): string | null {
	const filePath = resolveProfileFilePath(profileName, cwd);
	if (!filePath || !fs.existsSync(filePath)) return null;

	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);
		const cycle: Record<string, string> = {
			low: "medium",
			medium: "high",
			high: "low",
		};

		if (!agentId || agentId === "host") {
			const current = (data.default_effort || "high").toLowerCase();
			const next = cycle[current] || "high";
			data.default_effort = next;
			fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
			resetProfilesCache();
			return next;
		}

		if (!data.model_profiles) data.model_profiles = {};
		const existingCfg = data.model_profiles[agentId] || {};
		const current = (existingCfg.effort || data.default_effort || "high").toLowerCase();
		const next = cycle[current] || "high";
		existingCfg.effort = next;
		data.model_profiles[agentId] = existingCfg;
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
		resetProfilesCache();
		return next;
	} catch {
		return null;
	}
}

/**
 * Loads the full profile JSON configuration from project, global or builtin profiles.
 */
export function loadProfileDetails(name: string, cwd?: string): FullProfileData | null {
	if (!name || typeof name !== "string") return null;

	const normCwd = path.resolve(cwd ?? process.cwd());
	const cacheKey = `${name.toLowerCase()}::${normCwd}`;
	const now = Date.now();
	const cached = profileDetailsCache.get(cacheKey);
	if (cached && now - cached.timestamp < PROFILES_CACHE_TTL_MS) {
		return cached.data;
	}

	const workingDir = cwd ?? process.cwd();
	const home = os.homedir();
	const projectDir = path.join(workingDir, ".pi", "profiles");
	const globalDir = path.join(home, ".pi", "agent", "profiles");
	const builtinDir = findSddProfilesDir();

	const candidateDirs = [projectDir, globalDir, ...(builtinDir ? [builtinDir] : [])];
	const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
	const candidateFiles = [`${name}.json`, `${name.toLowerCase()}.json`, `${slug}.json`];

	let result: FullProfileData | null = null;

	for (const dir of candidateDirs) {
		if (!fs.existsSync(dir)) continue;
		for (const cf of candidateFiles) {
			const candidatePath = path.join(dir, cf);
			if (fs.existsSync(candidatePath)) {
				try {
					const raw = fs.readFileSync(candidatePath, "utf-8");
					result = JSON.parse(raw);
					break;
				} catch {}
			}
		}
		if (result) break;
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
						result = parsed;
						break;
					}
				} catch {}
			}
			if (result) break;
		} catch {}
	}

	profileDetailsCache.set(cacheKey, { data: result, timestamp: now });
	return result;
}

/**
 * Reads details of the currently active profile.
 */
export function getActiveProfileDetails(cwd?: string): FullProfileData | null {
	const activeName = readActiveProfile(cwd);

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

export function shortModelName(modelId: string): string {
	const parts = modelId.split("/");
	return parts.length > 1 ? parts[parts.length - 1] : modelId;
}

/**
 * List all available SDD profiles from runtime API or disk.
 */
export function listAvailableProfiles(cwd?: string): ProfileItem[] {
	const normCwd = path.resolve(cwd ?? process.cwd());
	const api = getSddProfilesApi();
	const cacheKey = `${normCwd}::${api ? "api" : "disk"}`;
	const now = Date.now();
	const cached = listProfilesCache.get(cacheKey);
	if (cached && now - cached.timestamp < PROFILES_CACHE_TTL_MS) {
		return cached.data;
	}

	if (api) {
		try {
			const list = api.listProfiles();
			const activeName = api.getActiveProfile();
			const result = list.map((p) => ({
				name: p.name,
				description: p.description,
				active: p.active ?? (activeName ? p.name.toLowerCase() === activeName.toLowerCase() : false),
				source: p.source ?? "global",
			}));
			listProfilesCache.set(cacheKey, { data: result, timestamp: now });
			return result;
		} catch {
			// Fallback to disk
		}
	}

	const workingDir = cwd ?? process.cwd();
	const home = os.homedir();
	const projectDir = path.join(workingDir, ".pi", "profiles");
	const globalDir = path.join(home, ".pi", "agent", "profiles");
	const builtinDir = findSddProfilesDir();

	const activeName = readActiveProfile(cwd) ?? null;

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
	if (builtinDir) {
		scanDir(builtinDir, "builtin");
	}

	const list = Array.from(profilesMap.values());
	list.sort((a, b) => a.name.localeCompare(b.name));
	listProfilesCache.set(cacheKey, { data: list, timestamp: now });
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
			resetProfilesCache();
			resetActiveProfileCache();
			return { success: res.success, message: res.message };
		} catch {
			// Fallback to disk
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

	resetProfilesCache();
	resetActiveProfileCache();
	return { success: true, message: `Perfil "${resolvedName}" activado.` };
}
