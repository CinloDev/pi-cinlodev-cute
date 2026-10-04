import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Customizable Cinlodev CUTE texts. Colors live in themes/CinlodevCute.json
 * (consumed via theme.fg()); this module only holds human-readable strings.
 *
 * Defaults are byte-identical to the literals previously hardcoded in
 * src/hud.ts, src/footer.ts, src/sidebar.ts, src/todos.ts, src/welcome.ts,
 * src/editor.ts and index.ts, so the
 * default visual stays unchanged.
 */
export interface CuteStrings {
	/** Full brand with glyph, e.g. "◆ Cinlodev CUTE". */
	brandTitle: string;
	/** Full brand with glyph, e.g. "✿ Cinlodev CUTE". */
	brandShort: string;
	/** Compact brand with glyph, e.g. "✿ Cinlodev". */
	brandFallback: string;
	/** HUD border title (default identical to brandTitle). */
	hudTitle: string;
	/** Footer brand text without glyph, e.g. "Cinlodev CUTE". */
	footerBrand: string;
	/** Footer compact brand text without glyph, e.g. "Cinlodev". */
	footerShort: string;
	/** Footer brand glyph, e.g. "✿". */
	footerSymbol: string;
	hudDescriptions: {
		hud: string;
		hudStatus: string;
	};
	notifys: {
		notInTui: string;
		deactivated: string;
		activated: string;
		compact: string;
		full: string;
		/** "{mode}" placeholder receives the hud mode. */
		activatedWithMode: string;
		statusActivated: string;
		statusDeactivated: string;
		welcomeHidden: string;
		welcomeShown: string;
		welcomeExpanded: string;
		welcomeCompact: string;
		welcomeRefreshed: string;
		/** "{mode}" placeholder receives the welcome mode label. */
		welcomeToggleFmt: string;
		welcomeDisabled: string;
		welcomeModeExpanded: string;
		welcomeModeCompact: string;
	};
	/** HUD footer status line segments (hud.ts renderStatus). */
	hudStatusLine: {
		brand: string;
		/** "{model}" placeholder receives the model id. */
		modelFmt: string;
		/** "{context}" placeholder receives the context percent. */
		ctxFmt: string;
		/** "{tools}" placeholder receives the tool result count. */
		toolsFmt: string;
	};
	/** Sidebar rail banner (sidebar.ts renderCUTESidebarBanner). */
	sidebarBanner: {
		full: string;
		short: string;
		glyph: string;
		brand: string;
		partner: string;
	};
	/** Todo mirror card texts (todos.ts renderCard). */
	todos: {
		glyph: string;
		/** "{done}" and "{total}" placeholders receive counts. */
		textFmt: string;
		/** "{remaining}" placeholder receives the overflow count. */
		moreFmt: string;
	};
	/** Footer sidebar card title, e.g. "✿ Status". */
	statusTitle: string;
	/** Context sidebar card title, e.g. "✿ Context". */
	contextTitle: string;
	/** Profile display format with "{icon}" and "{name}" placeholders, e.g. "{icon} {name}". */
	profileFormat: string;
	/** Welcome persona override (welcome.ts before_agent_start). */
	welcomePersona: {
		name: string;
		user: string;
		userRole: string;
		userPronoun: string;
		lang: string;
		/** "{name}", "{user}", "{userRole}", "{userPronoun}" and "{lang}" placeholders. */
		contractTemplate: string;
		/** Legacy upstream forms replaced on the incoming prompt. */
		replacements: Array<{ from: string; to: string }>;
	};
	/** Input hint shown when the prompt is empty. */
	editorHint: string;
	/** Welcome dashboard titles and command description. */
	welcomeTitles: {
		persona: string;
		dashboard: string;
		themeFallback: string;
		commandDescription: string;
	};
	/** Welcome dashboard hotkey labels (key glyphs stay in welcome.ts). */
	welcomeHotkeys: {
		interrupt: string;
		commands: string;
		commandsShort: string;
		bash: string;
		expandDashboard: string;
		expand: string;
		collapse: string;
	};
	/** Extension command registered by index.ts. */
	commandName: string;
	commandDescription: string;
	commandNotify: string;
}

export type CutePersonaMode = "gentleman" | "gentlewoman";

export const PERSONA_PRESETS: Record<
	CutePersonaMode,
	{
		name: string;
		userRole: string;
		userPronoun: string;
		contractTemplate: string;
		replacements: Array<{ from: string; to: string }>;
		welcomeTitles: {
			persona: string;
			dashboard: string;
			commandDescription: string;
		};
		welcomeNotifys: {
			welcomeHidden: string;
			welcomeShown: string;
			welcomeExpanded: string;
			welcomeCompact: string;
			welcomeRefreshed: string;
			welcomeToggleFmt: string;
			welcomeDisabled: string;
		};
	}
> = {
	gentleman: {
		name: "el Gentleman",
		userRole: "desarrollador",
		userPronoun: "Tratalo",
		contractTemplate:
			"\n\n## Identity & Persona Override: {name}\n- Identidad: Sos **{name}**, un arquitecto de software senior, mentor técnico y compañero de desarrollo para {user}.\n- Voz y género gramatical: Hablá y referite a vos mismo SIEMPRE en masculino (por ejemplo: \"{name}\", \"tu arquitecto senior\", \"listo para laburar\", \"enfocado\", \"preparado\", \"tranquilo\", \"seguro\"). NUNCA uses términos femeninos para referirte a vos mismo.\n- Interlocutor: {user} es {userRole}. {userPronoun} como tal, con calidez, camaradería y respeto.\n- Tono y lenguaje: {lang}\n",
		replacements: [
			{ from: "la Gentlewoman", to: "el Gentleman" },
			{ from: "La Gentlewoman", to: "El Gentleman" },
		],
		welcomeTitles: {
			persona: "el Gentleman",
			dashboard: "Gentleman Welcome Dashboard",
			commandDescription:
				"Configure or toggle the Gentleman Welcome Dashboard (/welcome, /welcome full, /welcome compact, /welcome off)",
		},
		welcomeNotifys: {
			welcomeHidden: "Gentleman Welcome Dashboard ocultado",
			welcomeShown: "Gentleman Welcome Dashboard activado",
			welcomeExpanded: "Gentleman Welcome Dashboard: modo expandido",
			welcomeCompact: "Gentleman Welcome Dashboard: modo compacto",
			welcomeRefreshed: "Gentleman Welcome Dashboard actualizado",
			welcomeToggleFmt: "Gentleman Welcome Dashboard: {mode}",
			welcomeDisabled: "Gentleman Welcome Dashboard desactivado",
		},
	},
	gentlewoman: {
		name: "la Gentlewoman",
		userRole: "desarrolladora",
		userPronoun: "Tratala",
		contractTemplate:
			"\n\n## Identity & Persona Override: {name}\n- Identidad: Sos **{name}**, una arquitecta de software senior, mentora técnica y compañera de desarrollo para {user}.\n- Voz y género gramatical: Hablá y referite a vos misma SIEMPRE en femenino (por ejemplo: \"{name}\", \"tu arquitecta senior\", \"lista para laburar\", \"enfocada\", \"preparada\", \"tranquila\", \"segura\"). NUNCA uses términos masculinos para referirte a vos misma (nada de \"el Gentleman\", \"listo\", \"enfocado\", \"arquitecto\", etc.).\n- Interlocutora: {user} es {userRole}. {userPronoun} como tal, con calidez, camaradería y respeto.\n- Tono y lenguaje: {lang}\n",
		replacements: [
			{ from: "el Gentleman", to: "la Gentlewoman" },
			{ from: "El Gentleman", to: "La Gentlewoman" },
		],
		welcomeTitles: {
			persona: "la Gentlewoman",
			dashboard: "Gentlewoman Welcome Dashboard",
			commandDescription:
				"Configure or toggle the Gentlewoman Welcome Dashboard (/welcome, /welcome full, /welcome compact, /welcome off)",
		},
		welcomeNotifys: {
			welcomeHidden: "Gentlewoman Welcome Dashboard ocultado",
			welcomeShown: "Gentlewoman Welcome Dashboard activado",
			welcomeExpanded: "Gentlewoman Welcome Dashboard: modo expandido",
			welcomeCompact: "Gentlewoman Welcome Dashboard: modo compacto",
			welcomeRefreshed: "Gentlewoman Welcome Dashboard actualizado",
			welcomeToggleFmt: "Gentlewoman Welcome Dashboard: {mode}",
			welcomeDisabled: "Gentlewoman Welcome Dashboard desactivado",
		},
	},
};

export const CUTE_STRINGS_FILENAME = "CinlodevCute.strings.json";

const DEFAULTS: CuteStrings = {
	brandTitle: "◆ Cinlodev CUTE",
	brandShort: "✿ Cinlodev CUTE",
	brandFallback: "✿ Cinlodev",
	hudTitle: "◆ Cinlodev CUTE",
	footerBrand: "Cinlodev CUTE",
	footerShort: "Cinlodev",
	footerSymbol: "✿",
	hudDescriptions: {
		hud: "Toggle or configure persistent Cinlodev CUTE HUD widget above input (/hud, /hud compact, /hud full, /hud off)",
		hudStatus: "Toggle the Cinlodev CUTE HUD footer status line",
	},
	notifys: {
		notInTui: "Cinlodev CUTE HUD widget is available in TUI mode.",
		deactivated: "Cinlodev CUTE HUD desactivado",
		activated: "Cinlodev CUTE HUD activado encima del input",
		compact: "Cinlodev CUTE HUD modo compacto activado",
		full: "Cinlodev CUTE HUD modo completo activado",
		activatedWithMode: "Cinlodev CUTE HUD activado encima del input ({mode})",
		statusActivated: "Cinlodev CUTE HUD footer status activado",
		statusDeactivated: "Cinlodev CUTE HUD footer status desactivado",
		...PERSONA_PRESETS.gentleman.welcomeNotifys,
		welcomeModeExpanded: "modo expandido",
		welcomeModeCompact: "modo compacto",
	},
	hudStatusLine: {
		brand: "◆ {user}",
		modelFmt: "model {model}",
		ctxFmt: "ctx {context}",
		toolsFmt: "tools {tools}",
	},
	sidebarBanner: {
		full: "✿ Cinlodev CUTE · Gentle-Shell ✿",
		short: "✿ Cinlodev CUTE ✿",
		glyph: "✿",
		brand: "Cinlodev CUTE",
		partner: "Gentle-Shell",
	},
	todos: {
		glyph: "✿",
		textFmt: "Todos · {done} of {total}",
		moreFmt: "+{remaining} más",
	},
	statusTitle: "✿ Status",
	contextTitle: "✿ Context",
	profileFormat: "{icon} {name}",
	welcomePersona: {
		name: PERSONA_PRESETS.gentleman.name,
		user: "{auto}",
		userRole: PERSONA_PRESETS.gentleman.userRole,
		userPronoun: PERSONA_PRESETS.gentleman.userPronoun,
		lang: "Español rioplatense natural con voseo (vos sos, vos tenés, fijate, contame, laburemos), directo, cálido, riguroso a nivel técnico y sin rodeos.",
		contractTemplate: PERSONA_PRESETS.gentleman.contractTemplate,
		replacements: [...PERSONA_PRESETS.gentleman.replacements],
	},
	editorHint: "type, or / for commands",
	welcomeTitles: {
		...PERSONA_PRESETS.gentleman.welcomeTitles,
		themeFallback: "Cinlodev CUTE",
	},
	welcomeHotkeys: {
		interrupt: "interrupt",
		commands: "commands",
		commandsShort: "cmd",
		bash: "bash",
		expandDashboard: "expand dashboard",
		expand: "expand",
		collapse: "collapse",
	},
	commandName: "cinlodev",
	commandDescription: "Check or reapply Cinlodev CUTE aesthetics and widgets (/cinlodev)",
	commandNotify: "🌸 Cinlodev CUTE: Header, HUD, Editor y Footer CUTE aplicados.",
};

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
		const packageDir = path.resolve(here, "..");
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
		const packageDir = path.resolve(here, "..");
		const cwd = path.resolve(process.cwd());
		if (cwd !== packageDir && !isPackageClone(cwd)) {
			add(path.join(cwd, ".pi", "cute.json"));
			add(path.join(cwd, ".pi", "cinlodev-cute.json"));
		}
	} catch {}

	return candidates;
}

let detectedUser: string | null = null;

/**
 * Auto-detect user name from git config (user.name) or operating system / env,
 * falling back to "Cinlo" if unavailable.
 */
export function detectSystemUser(): string {
	if (detectedUser !== null) return detectedUser;
	try {
		const gitName = execSync("git config user.name", {
			encoding: "utf8",
			timeout: 500,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (gitName.length > 0) {
			detectedUser = gitName;
			return detectedUser;
		}
	} catch {}
	try {
		const osUser = os.userInfo()?.username || process.env.USER || process.env.USERNAME;
		if (osUser && osUser.trim().length > 0) {
			detectedUser = osUser.trim();
			return detectedUser;
		}
	} catch {}
	detectedUser = "Developer";
	return detectedUser;
}

let cached: CuteStrings | null = null;

/**
 * Load customizable strings, cached in memory. Falls back to the compiled
 * defaults when the JSON file is missing or unparsable, so widgets keep
 * rendering with the current visual instead of throwing.
 *
 * Layers package defaults, user-level overrides (~/.pi/agent), and project overrides.
 * If user is not explicitly configured or set to "{auto}", auto-detects from git/OS.
 */
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
	detectedUser = null;
}

/**
 * Render the active profile as icon plus name without brackets, e.g. "👤 cinlodev".
 * "{icon}" and "{name}" placeholders come from config/CinlodevCute.strings.json
 * profileFormat; empty inputs fall back to the compiled defaults.
 */
export function formatProfileDisplay(icon: string, format: string, name: string): string {
	const safeIcon = icon.length > 0 ? icon : "👤";
	const safeFormat = format.length > 0 ? format : DEFAULTS.profileFormat;
	return safeFormat.split("{icon}").join(safeIcon).split("{name}").join(name);
}

/** Match a host "[name]" status; other statuses pass through untouched. */
export function matchBracketProfile(text: string): string | null {
	const match = /^\[(.+?)\]$/.exec(text.trim());
	return match ? match[1] : null;
}
