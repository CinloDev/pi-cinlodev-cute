import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resetActiveProfileCache } from "./cute-paths.ts";

export const SDD_PROFILES_API_SYMBOL = Symbol.for("cinlodev.sdd-profiles.api");

export interface ProfileItem {
	name: string;
	description?: string;
	active: boolean;
	source: "project" | "global" | "builtin";
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
	const builtinDir = path.join(home, ".pi", "agent", "git", "github.com", "CinloDev", "pi-sdd-profiles", "profiles");

	const findProfileFile = (name: string): { path: string; data: any } | null => {
		const targetFile = `${name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}.json`;
		const candidateDirs = [projectDir, globalDir, builtinDir];
		for (const dir of candidateDirs) {
			const candidatePath = path.join(dir, targetFile);
			if (fs.existsSync(candidatePath)) {
				try {
					const raw = fs.readFileSync(candidatePath, "utf-8");
					return { path: candidatePath, data: JSON.parse(raw) };
				} catch {}
			}
		}
		return null;
	};

	const found = findProfileFile(profileName);
	if (!found) {
		return { success: false, message: `Perfil "${profileName}" no encontrado.` };
	}

	const profile = found.data;
	const resolvedName = profile.name || profileName;

	// Update .active in project if projectDir exists, else global
	try {
		const targetActive = fs.existsSync(projectDir)
			? path.join(projectDir, ".active")
			: path.join(globalDir, ".active");
		fs.mkdirSync(path.dirname(targetActive), { recursive: true });
		fs.writeFileSync(targetActive, resolvedName, "utf-8");
	} catch {}

	// Update status badge
	if (ctx?.hasUI && typeof ctx?.ui?.setStatus === "function") {
		ctx.ui.setStatus("sdd-profile", `🤖 ${resolvedName}`);
	}

	// Update session model if default_model is defined
	if (profile.default_model && pi && typeof pi.setModel === "function") {
		const sep = profile.default_model.indexOf("/");
		if (sep !== -1) {
			const provider = profile.default_model.slice(0, sep).trim();
			const modelId = profile.default_model.slice(sep + 1).trim();

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

	// Update thinking level
	if (profile.default_effort && pi && typeof pi.setThinkingLevel === "function") {
		try {
			pi.setThinkingLevel(profile.default_effort);
		} catch {}
	}

	resetActiveProfileCache();
	return { success: true, message: `Perfil "${resolvedName}" activado.` };
}
