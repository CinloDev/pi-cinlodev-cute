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

export { DEFAULTS };

