import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type CuteStrings, type CutePersonaMode, PERSONA_PRESETS, CUTE_STRINGS_FILENAME, DEFAULTS } from "./strings-types.ts";
import { detectSystemUser, resetDetectedUser } from "./strings-user.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(source: unknown, fallback: string): string {
	return typeof source === "string" && source.length > 0 ? source : fallback;
}

/** Merge a parsed JSON value over the defaults; unknown keys are ignored. */
function mergeStrings(raw: unknown, baseSource: CuteStrings = DEFAULTS): CuteStrings {
	const base: CuteStrings = {
		...baseSource,
		hudDescriptions: { ...baseSource.hudDescriptions },
		notifys: { ...baseSource.notifys },
		hudStatusLine: { ...baseSource.hudStatusLine },
		sidebarBanner: { ...baseSource.sidebarBanner },
		todos: { ...baseSource.todos },
		welcomePersona: { ...baseSource.welcomePersona, replacements: [...baseSource.welcomePersona.replacements] },
		welcomeTitles: { ...baseSource.welcomeTitles },
		welcomeHotkeys: { ...baseSource.welcomeHotkeys },
	};
	if (!isRecord(raw)) return base;

	// Persona preset handling ("gentleman" | "gentlewoman")
	const personaKey = typeof raw.persona === "string" ? raw.persona.toLowerCase() : (
		typeof raw.personaMode === "string" ? raw.personaMode.toLowerCase() : undefined
	);
	if (personaKey === "gentlewoman" || personaKey === "gentleman") {
		const preset = PERSONA_PRESETS[personaKey as CutePersonaMode];
		base.welcomePersona.name = preset.name;
		base.welcomePersona.userRole = preset.userRole;
		base.welcomePersona.userPronoun = preset.userPronoun;
		base.welcomePersona.contractTemplate = preset.contractTemplate;
		base.welcomePersona.replacements = [...preset.replacements];
		base.welcomeTitles.persona = preset.welcomeTitles.persona;
		base.welcomeTitles.dashboard = preset.welcomeTitles.dashboard;
		base.welcomeTitles.commandDescription = preset.welcomeTitles.commandDescription;
		for (const [k, v] of Object.entries(preset.welcomeNotifys)) {
			(base.notifys as Record<string, string>)[k] = v;
		}
	}

	const rootUser = pickString(raw.user, pickString(raw.userName, ""));
	if (rootUser) {
		base.welcomePersona.user = rootUser;
	}

	const rootUserRole = pickString(raw.userRole, pickString(raw.role, ""));
	if (rootUserRole) {
		base.welcomePersona.userRole = rootUserRole;
		// Auto-infer pronoun if not explicit:
		if (rootUserRole.endsWith("a") || rootUserRole.endsWith("ora") || rootUserRole.endsWith("era")) {
			base.welcomePersona.userPronoun = "Tratala";
		} else {
			base.welcomePersona.userPronoun = "Tratalo";
		}
	}

	const rootUserPronoun = pickString(raw.userPronoun, pickString(raw.pronoun, ""));
	if (rootUserPronoun) {
		base.welcomePersona.userPronoun = rootUserPronoun;
	}

	base.brandTitle = pickString(raw.brandTitle, base.brandTitle);
	base.brandShort = pickString(raw.brandShort, base.brandShort);
	base.brandFallback = pickString(raw.brandFallback, base.brandFallback);
	base.hudTitle = pickString(raw.hudTitle, base.hudTitle);
	base.footerBrand = pickString(raw.footerBrand, base.footerBrand);
	base.footerShort = pickString(raw.footerShort, base.footerShort);
	base.footerSymbol = pickString(raw.footerSymbol, base.footerSymbol);
	if (isRecord(raw.hudDescriptions)) {
		base.hudDescriptions.hud = pickString(raw.hudDescriptions.hud, base.hudDescriptions.hud);
		base.hudDescriptions.hudStatus = pickString(
			raw.hudDescriptions.hudStatus,
			base.hudDescriptions.hudStatus,
		);
	}
	if (isRecord(raw.notifys)) {
		const target = base.notifys;
		for (const key of Object.keys(DEFAULTS.notifys) as (keyof CuteStrings["notifys"])[]) {
			target[key] = pickString(raw.notifys[key], target[key]);
		}
	}
	if (isRecord(raw.hudStatusLine)) {
		const target = base.hudStatusLine;
		for (const key of Object.keys(DEFAULTS.hudStatusLine) as (keyof CuteStrings["hudStatusLine"])[]) {
			target[key] = pickString(raw.hudStatusLine[key], target[key]);
		}
	}
	if (isRecord(raw.sidebarBanner)) {
		const target = base.sidebarBanner;
		for (const key of Object.keys(DEFAULTS.sidebarBanner) as (keyof CuteStrings["sidebarBanner"])[]) {
			target[key] = pickString(raw.sidebarBanner[key], target[key]);
		}
	}
	if (isRecord(raw.todos)) {
		const target = base.todos;
		for (const key of Object.keys(DEFAULTS.todos) as (keyof CuteStrings["todos"])[]) {
			target[key] = pickString(raw.todos[key], target[key]);
		}
	}
	base.statusTitle = pickString(raw.statusTitle, base.statusTitle);
	base.contextTitle = pickString(raw.contextTitle, base.contextTitle);
	base.profileFormat = pickString(raw.profileFormat, base.profileFormat);
	if (isRecord(raw.welcomePersona)) {
		base.welcomePersona.name = pickString(raw.welcomePersona.name, base.welcomePersona.name);
		base.welcomePersona.user = pickString(raw.welcomePersona.user, base.welcomePersona.user);
		base.welcomePersona.userRole = pickString(raw.welcomePersona.userRole, base.welcomePersona.userRole);
		base.welcomePersona.userPronoun = pickString(raw.welcomePersona.userPronoun, base.welcomePersona.userPronoun);
		base.welcomePersona.lang = pickString(raw.welcomePersona.lang, base.welcomePersona.lang);
		base.welcomePersona.contractTemplate = pickString(
			raw.welcomePersona.contractTemplate,
			base.welcomePersona.contractTemplate,
		);
		const rawReplacements = (raw.welcomePersona as Record<string, unknown>).replacements;
		if (Array.isArray(rawReplacements) && rawReplacements.length > 0) {
			const next: Array<{ from: string; to: string }> = [];
			for (const entry of rawReplacements) {
				if (!isRecord(entry)) continue;
				const from = entry.from;
				const to = entry.to;
				if (typeof from !== "string" || from.length === 0) continue;
				if (typeof to !== "string" || to.length === 0) continue;
				next.push({ from, to });
			}
			if (next.length > 0) base.welcomePersona.replacements = next;
		}
	}
	base.editorHint = pickString(raw.editorHint, base.editorHint);
	if (isRecord(raw.welcomeTitles)) {
		const target = base.welcomeTitles;
		for (const key of Object.keys(DEFAULTS.welcomeTitles) as (keyof CuteStrings["welcomeTitles"])[]) {
			target[key] = pickString(raw.welcomeTitles[key], target[key]);
		}
	}
	if (isRecord(raw.welcomeHotkeys)) {
		const target = base.welcomeHotkeys;
		for (const key of Object.keys(DEFAULTS.welcomeHotkeys) as (keyof CuteStrings["welcomeHotkeys"])[]) {
			target[key] = pickString(raw.welcomeHotkeys[key], target[key]);
		}
	}
	base.commandName = pickString(raw.commandName, base.commandName);
	base.commandDescription = pickString(raw.commandDescription, base.commandDescription);
	base.commandNotify = pickString(raw.commandNotify, base.commandNotify);
	return base;
}

// Tunables live in config/, NOT in themes/: Pi treats every *.json under
// themes/ as a theme file and rejects ours. Legacy themes/ fallback kept.
// User overrides in ~/.pi/agent/cute.json or ~/.pi/agent/cute/CinlodevCute.strings.json
// layer on top of package defaults and persist across package updates.
function isPackageClone(dir: string): boolean {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		return pkg?.name === "pi-cinlodev-cute";
	} catch {
		return false;
	}
}

function candidateStringsFiles(): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();

	const add = (filePath: string) => {
		const resolved = path.resolve(filePath);
		if (!seen.has(resolved)) {
			seen.add(resolved);
			candidates.push(resolved);
		}
	};

	// 1. Package defaults (repo clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "../..");
		add(path.join(packageDir, "config", CUTE_STRINGS_FILENAME));
		add(path.join(packageDir, "themes", CUTE_STRINGS_FILENAME));
	} catch {}

	// 2. User-level global overrides (~/.pi/agent, outside git, persistent across package updates)
	try {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		add(path.join(agentDir, "cute.json"));
		add(path.join(agentDir, "cinlodev-cute.json"));
		add(path.join(agentDir, "cute", CUTE_STRINGS_FILENAME));
		add(path.join(agentDir, "cute", "strings.json"));
		add(path.join(agentDir, "cinlodev-cute", CUTE_STRINGS_FILENAME));
		add(path.join(agentDir, "cinlodev-cute", "strings.json"));
	} catch {}

	// 3. Workspace / Project-level overrides (cwd, only when outside package clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "../..");
		const cwd = path.resolve(process.cwd());
		if (cwd !== packageDir && !isPackageClone(cwd)) {
			add(path.join(cwd, ".pi", "cute.json"));
			add(path.join(cwd, ".pi", "cinlodev-cute.json"));
		}
	} catch {}

	return candidates;
}

let cached: CuteStrings | null = null;

export function loadCuteStrings(): CuteStrings {
	if (cached) return cached;
	let current: CuteStrings = mergeStrings(undefined, DEFAULTS);
	for (const file of candidateStringsFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!isRecord(parsed)) continue;
			// 1. Merge root-level properties (user, persona, userRole, userPronoun, etc.)
			current = mergeStrings(parsed, current);
			// 2. If there is a nested "strings" block, merge it on top
			if (isRecord(parsed.strings)) {
				current = mergeStrings(parsed.strings, current);
			}
		} catch {}
	}
	if (current.welcomePersona.user === "{auto}" || !current.welcomePersona.user) {
		current.welcomePersona.user = detectSystemUser();
	}
	cached = current;
	return cached;
}

/** Clear the in-memory cache (tests and follow-up slices). */
export function resetCuteStringsCache(): void {
	cached = null;
	resetDetectedUser();
}