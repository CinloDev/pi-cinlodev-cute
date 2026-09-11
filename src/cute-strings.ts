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
	/** Profile display format with "{icon}" and "{name}" placeholders, e.g. "{icon} {name}". */
	profileFormat: string;
	/** Welcome persona override (welcome.ts before_agent_start). */
	welcomePersona: {
		name: string;
		user: string;
		lang: string;
		/** "{name}", "{user}" and "{lang}" placeholders. */
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
		welcomeHidden: "Gentlewoman Welcome Dashboard ocultado",
		welcomeShown: "Gentlewoman Welcome Dashboard activado",
		welcomeExpanded: "Gentlewoman Welcome Dashboard: modo expandido",
		welcomeCompact: "Gentlewoman Welcome Dashboard: modo compacto",
		welcomeRefreshed: "Gentlewoman Welcome Dashboard actualizado",
		welcomeToggleFmt: "Gentlewoman Welcome Dashboard: {mode}",
		welcomeDisabled: "Gentlewoman Welcome Dashboard desactivado",
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
		full: "✿ Cinlodev CUTE · Gentle-Pi ✿",
		short: "✿ Cinlodev CUTE ✿",
		glyph: "✿",
		brand: "Cinlodev CUTE",
		partner: "Gentle-Pi",
	},
	todos: {
		glyph: "✿",
		textFmt: "Todos · {done} of {total}",
		moreFmt: "+{remaining} más",
	},
	statusTitle: "✿ Status",
	profileFormat: "{icon} {name}",
	welcomePersona: {
		name: "la Gentlewoman",
		user: "Cinlo",
		lang: "Español rioplatense natural con voseo (vos sos, vos tenés, fijate, contame, laburemos), directo, cálido, riguroso a nivel técnico y sin rodeos.",
		contractTemplate:
			"\n\n## Identity & Persona Override: {name}\n- Identidad: Sos **{name}**, una arquitecta de software senior, mentora técnica y compañera de desarrollo para {user}.\n- Voz y género gramatical: Hablá y referite a vos misma SIEMPRE en femenino (por ejemplo: \"{name}\", \"tu arquitecta senior\", \"lista para laburar\", \"enfocada\", \"preparada\", \"tranquila\", \"segura\"). NUNCA uses términos masculinos para referirte a vos misma (nada de \"el Gentleman\", \"listo\", \"enfocado\", \"arquitecto\", etc.).\n- Interlocutora: {user} es desarrolladora. Tratala como tal, con calidez, camaradería y respeto.\n- Tono y lenguaje: {lang}\n",
		replacements: [
			{ from: "el Gentleman", to: "la Gentlewoman" },
			{ from: "El Gentleman", to: "La Gentlewoman" },
		],
	},
	editorHint: "type, or / for commands",
	welcomeTitles: {
		persona: "la Gentlewoman",
		dashboard: "Gentlewoman Welcome Dashboard",
		themeFallback: "Cinlodev CUTE",
		commandDescription:
			"Configure or toggle the Gentlewoman Welcome Dashboard (/welcome, /welcome full, /welcome compact, /welcome off)",
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
	const rootUser = pickString(raw.user, pickString(raw.userName, ""));
	if (rootUser) {
		base.welcomePersona.user = rootUser;
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
	base.profileFormat = pickString(raw.profileFormat, base.profileFormat);
	if (isRecord(raw.welcomePersona)) {
		base.welcomePersona.name = pickString(raw.welcomePersona.name, base.welcomePersona.name);
		base.welcomePersona.user = pickString(raw.welcomePersona.user, base.welcomePersona.user);
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
		if (cwd !== packageDir) {
			add(path.join(cwd, ".pi", "cute.json"));
			add(path.join(cwd, ".pi", "cinlodev-cute.json"));
			add(path.join(cwd, "config", CUTE_STRINGS_FILENAME));
		}
	} catch {}

	return candidates;
}

let cached: CuteStrings | null = null;

/**
 * Load customizable strings, cached in memory. Falls back to the compiled
 * defaults when the JSON file is missing or unparsable, so widgets keep
 * rendering with the current visual instead of throwing.
 *
 * Layers package defaults, user-level overrides (~/.pi/agent), and project overrides.
 */
export function loadCuteStrings(): CuteStrings {
	if (cached) return cached;
	let current: CuteStrings = mergeStrings(undefined, DEFAULTS);
	for (const file of candidateStringsFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!isRecord(parsed)) continue;
			const data = "strings" in parsed ? parsed.strings : parsed;
			current = mergeStrings(data, current);
		} catch {}
	}
	cached = current;
	return cached;
}

/** Clear the in-memory cache (tests and follow-up slices). */
export function resetCuteStringsCache(): void {
	cached = null;
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
