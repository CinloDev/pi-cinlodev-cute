import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

export const PROMPT_STATE = {
	IDLE: "idle",
	WORKING: "working",
	QUEUED: "queued",
} as const;

export type PromptState = (typeof PROMPT_STATE)[keyof typeof PROMPT_STATE];

const PETAL_FRAMES = ["✿", "❀", "❁", "✾"] as const;
const PROMPT_HINT = "type, or / for commands";
const FAKE_CURSOR = "\x1b[7m \x1b[0m";
const SCROLL_INDICATOR = /[↑↓] \d+ more/;

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x1b]*(?:\x1b\\|\x07)/g, "");
}

function rule(length: number): string {
	return "═".repeat(Math.max(0, length));
}

function safeFg(theme: Theme | undefined, color: string, text: string, fallback: string = text): string {
	try {
		return theme?.fg ? theme.fg(color as any, text) : fallback;
	} catch {
		return fallback;
	}
}

// Marco del input según esfuerzo (thinking level): bajo = verde menta,
// intermedio = dorado, high para arriba = violeta actual.
const FRAME_VIOLET = "142;68;173";
const FRAME_MINT = "180;231;199";
const FRAME_GOLD = "224;194;122";

function frameRgbForThinking(level: string | undefined): string {
	const normalized = (level ?? "default").toLowerCase();
	if (normalized === "minimal" || normalized === "low" || normalized === "off") return FRAME_MINT;
	if (normalized === "medium") return FRAME_GOLD;
	return FRAME_VIOLET;
}

export class CinlodevPromptEditor extends CustomEditor {
	private promptState: PromptState = PROMPT_STATE.IDLE;
	private tick = 0;
	private pulse: NodeJS.Timeout | undefined;
	private thinkingLevel: string = "default";
	private readonly tui: TUI;
	private readonly uiTheme: Theme;
	private readonly hasPending: () => boolean;

	constructor(
		tui: TUI,
		editorTheme: any,
		keybindings: KeybindingsManager,
		uiTheme: Theme,
		hasPending: () => boolean = () => false,
	) {
		super(tui, editorTheme, keybindings);
		this.tui = tui;
		this.uiTheme = uiTheme;
		this.hasPending = hasPending;
	}

	setThinkingLevel(level: string): void {
		this.thinkingLevel = level;
		this.tui.requestRender();
	}

	setWorking(working: boolean): void {
		this.promptState = working ? PROMPT_STATE.WORKING : PROMPT_STATE.IDLE;
		this.stopPulse();
		if (working) {
			this.pulse = setInterval(() => {
				this.tick += 1;
				this.tui.requestRender();
			}, 160);
			this.pulse.unref();
		}
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(10, width);
		const lines = super.render(Math.max(1, safeWidth - 2));
		if (this.getText() === "" && lines.length === 3) {
			lines[1] = this.withPromptHint(lines[1], PROMPT_HINT);
		}
		const state =
			this.promptState === PROMPT_STATE.WORKING && this.hasPending()
				? PROMPT_STATE.QUEUED
				: this.promptState;

		return this.framePromptLines(lines, safeWidth, state, this.tick);
	}

	dispose(): void {
		this.stopPulse();
	}

	private stopPulse(): void {
		if (this.pulse) clearInterval(this.pulse);
		this.pulse = undefined;
		this.tick = 0;
	}

	private withPromptHint(line: string, hint: string): string {
		const cursorAt = line.indexOf(FAKE_CURSOR);
		if (cursorAt === -1) return line;
		const afterCursor = cursorAt + FAKE_CURSOR.length;
		const trailing = line.slice(afterCursor);
		if (trailing.trim() !== "" || trailing.length < hint.length + 1) return line;
		const styledHint = safeFg(this.uiTheme, "dim", hint);
		return `${line.slice(0, afterCursor)} ${styledHint}${" ".repeat(trailing.length - hint.length - 1)}`;
	}

	private framePromptLines(
		lines: string[],
		width: number,
		state: PromptState,
		tick: number,
	): string[] {
		if (lines.length < 2) return lines;
		const innerWidth = width - 2;
		const top = lines[0];
		const bottom = lines[lines.length - 1];

		const topIndicator = stripAnsi(top).match(SCROLL_INDICATOR)?.[0];
		const bottomIndicator = stripAnsi(bottom).match(SCROLL_INDICATOR)?.[0];

		const topFormatted = this.topRule(width, state, tick, topIndicator);
		const content = lines.slice(1, -1).map((line) => this.sideRules(line, innerWidth));
		const bottomFormatted = this.bottomRule(width, bottomIndicator);

		return [topFormatted, ...content, bottomFormatted];
	}

	private topRule(
		width: number,
		state: PromptState,
		tick: number,
		indicator?: string,
	): string {
		const glyph = state === PROMPT_STATE.IDLE ? "✿" : PETAL_FRAMES[tick % PETAL_FRAMES.length];
		let petalColor = "pinkBright";
		if (state === PROMPT_STATE.QUEUED) petalColor = "warning";
		else if (state === PROMPT_STATE.WORKING) petalColor = "accent";

		const petal = safeFg(this.uiTheme, petalColor, glyph);
		const label = indicator ?? (state === PROMPT_STATE.WORKING ? "working" : state === PROMPT_STATE.QUEUED ? "queued" : "");
		const labelText = label ? ` ${safeFg(this.uiTheme, "muted", label)}` : "";
		const labelWidth = label ? label.length + 1 : 0;
		const fill = Math.max(0, width - 3 - visibleWidth(glyph) - labelWidth - 1 - 1);

		const frame = this.frameColor();
		return frame("╔═ ") + petal + labelText + frame(` ${rule(fill)}╗`);
	}

	private frameColor(): (text: string) => string {
		const rgb = frameRgbForThinking(this.thinkingLevel);
		return (text: string) => `\x1b[38;2;${rgb}m${text}\x1b[39m`;
	}

	private bottomRule(width: number, indicator?: string): string {
		const frame = this.frameColor();
		if (!indicator) return frame(`╚${rule(width - 2)}╝`);
		const fill = Math.max(0, width - 3 - indicator.length - 1 - 1);
		return frame("╚═ ") + safeFg(this.uiTheme, "muted", indicator) + frame(` ${rule(fill)}╝`);
	}

	private sideRules(line: string, innerWidth: number): string {
		// Reemplazar cursor inverso blanco por rosa pastel (#FFB1DD)
		const styledLine = line.replace(
			/\x1b\[7m(.*?)\x1b\[0m/g,
			"\x1b[48;2;255;177;221m\x1b[38;2;26;18;24m$1\x1b[0m",
		);
		const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(styledLine)));
		const frame = this.frameColor();
		return frame("║") + styledLine + padding + frame("║");
	}
}

let activeCinlodevPrompt: CinlodevPromptEditor | null = null;

export function setCinlodevPromptWorking(working: boolean): void {
	activeCinlodevPrompt?.setWorking(working);
}

export function setCinlodevPromptThinkingLevel(level: string): void {
	activeCinlodevPrompt?.setThinkingLevel(level);
}

export function installCinlodevPrompt(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const initialLevel = (ctx as unknown as { thinkingLevel?: string }).thinkingLevel ?? "default";
	ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
		activeCinlodevPrompt = new CinlodevPromptEditor(
			tui,
			editorTheme,
			keybindings,
			ctx.ui.theme,
			() => ctx.hasPendingMessages(),
		);
		activeCinlodevPrompt.setThinkingLevel(initialLevel);
		return activeCinlodevPrompt;
	});
}
