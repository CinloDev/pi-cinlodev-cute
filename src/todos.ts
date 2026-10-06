import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, frameFg, type CutePalette } from "./cute-theme.ts";
import { loadCuteLayout } from "./cute-layout.ts";
import { loadCuteStrings } from "./cute-strings.ts";

// Cinlodev CUTE colors come from themes/CinlodevCute.json via cutePalette().
// No hardcoded ANSI here: footer.ts shares the same single source of truth.
// Row limits and card width come from config/CinlodevCute.layout.json via loadCuteLayout().
const identityPalette: CutePalette = {
	border: (s) => s,
	pinkBright: (s) => s,
	pinkAccent: (s) => s,
	gold: (s) => s,
	yellow: (s) => s,
	text: (s) => s,
	muted: (s) => s,
	dim: (s) => s,
	mint: (s) => s,
};

export interface TodoTask {
	id: number;
	title: string;
	status: "pending" | "in_progress" | "done";
	note?: string;
}

function normalizeStatus(value: unknown): TodoTask["status"] {
	return value === "pending" || value === "in_progress" || value === "done" ? value : "pending";
}

function normalizeTask(raw: unknown, index: number): TodoTask | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
	const candidate = raw as Record<string, unknown>;
	if (typeof candidate.title !== "string" || candidate.title.length === 0) return undefined;
	const task: TodoTask = {
		id: typeof candidate.id === "number" ? candidate.id : index,
		title: candidate.title,
		status: normalizeStatus(candidate.status),
	};
	if (typeof candidate.note === "string") task.note = candidate.note;
	return task;
}

/** Scan the session for the latest host todo state. Never throws. */
export function readTodoTasks(ctx: ExtensionContext): TodoTask[] | undefined {
	try {
		const sessionManager = (ctx as unknown as { sessionManager?: any }).sessionManager;
		const entries = (sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? []) as unknown;
		if (!Array.isArray(entries)) return undefined;
		let lastTasks: unknown;
		for (const entry of entries) {
			if (
				typeof entry === "object" &&
				entry !== null &&
				(entry as Record<string, unknown>).type === "message"
			) {
				const message = (entry as Record<string, unknown>).message as Record<string, unknown> | undefined;
				const tasks = (message?.details as Record<string, unknown> | undefined)?.gentleTodo as
					| Record<string, unknown>
					| undefined;
				if (
					message?.role === "toolResult" &&
					message?.toolName === "todo" &&
					Array.isArray(tasks?.tasks)
				) {
					lastTasks = tasks.tasks;
				}
			}
		}
		if (!Array.isArray(lastTasks)) return undefined;
		const tasks: TodoTask[] = [];
		lastTasks.forEach((raw, index) => {
			const task = normalizeTask(raw, index);
			if (task) tasks.push(task);
		});
		return tasks;
	} catch {
		return undefined;
	}
}

function glyphFor(c: CutePalette, status: TodoTask["status"]): string {
	if (status === "done") return c.mint("✓");
	if (status === "in_progress") return c.gold("◉");
	return c.dim("○");
}

function wrapWords(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [text];
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0) return [""];
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (!current) {
			current = word;
		} else if (visibleWidth(current + " " + word) <= maxWidth) {
			current += " " + word;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/** Read-only mirror of the host harness todo checklist for the sidebar rail. */
export class CinlodevTodoMirror implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private lastSignature = "";
	private scrollOffset = 0;
	private lastMaxScrollOffset = 0;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	private palette(): CutePalette {
		return this.theme ? cutePalette(this.theme) : identityPalette;
	}

	private current(): TodoTask[] {
		try {
			return readTodoTasks(this.ctx) ?? [];
		} catch {
			return [];
		}
	}

	private touch(tasks: TodoTask[]): void {
		try {
			const signature = JSON.stringify(tasks);
			if (signature !== this.lastSignature) {
				this.lastSignature = signature;
				this.scrollOffset = 0;
				this.tui.requestRender();
			}
		} catch {}
	}

	handleRailWheel(delta: number): boolean {
		if (delta === 0) return false;
		if (this.lastMaxScrollOffset <= 0) return false;
		const step = delta > 0 ? 1 : -1;
		const next = Math.max(0, Math.min(this.lastMaxScrollOffset, this.scrollOffset + step));
		if (next !== this.scrollOffset) {
			this.scrollOffset = next;
			this.tui.requestRender();
			return true;
		}
		return false;
	}

	handleMouse(event: any): any {
		if (event?.wheelDelta) {
			const handled = this.handleRailWheel(event.wheelDelta);
			if (handled) return { handled: true };
		}
		return undefined;
	}

	private renderCard(width: number, maxRows: number): string[] {
		const tasks = this.current();
		this.touch(tasks);
		if (tasks.length === 0) return [];
		const safeWidth = Math.max(loadCuteLayout().todos.minWidth, width);
		const innerWidth = safeWidth - 4;
		const c = this.palette();
		const g = cuteGlyphs(this.theme);
		const frame = (s: string): string =>
			this.theme ? frameFg(this.theme, s) : s;

		const boxLine = (left: string, right = ""): string => {
			const spaceNeeded = innerWidth - visibleWidth(left) - visibleWidth(right);
			const pad = " ".repeat(Math.max(1, spaceNeeded));
			const content = truncateToWidth(left + pad + right, innerWidth);
			const fill = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
			return `${frame(g.v)} ${content}${fill} ${frame(g.v)}`;
		};

		const done = tasks.filter((task) => task.status === "done").length;
		const strings = loadCuteStrings().todos;
		const titleText = strings.textFmt
			.replace("{done}", String(done))
			.replace("{total}", String(tasks.length));
		const rawTitle = `${strings.glyph} ${titleText}`;
		const titleStr = `${c.pinkBright(strings.glyph)} ${c.text(titleText)}`;
		const fillTop = Math.max(0, safeWidth - 4 - visibleWidth(rawTitle) - 1);
		const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		// Build all body lines with clean word wrapping for full text display
		const allBodyLines: string[] = [];
		const textIndentWidth = 2; // "  "
		const textAvailableWidth = Math.max(10, innerWidth - textIndentWidth);

		for (const task of tasks) {
			const glyph = glyphFor(c, task.status);
			const colorFn =
				task.status === "in_progress"
					? c.pinkBright
					: task.status === "done"
						? c.dim
						: c.text;

			const wrappedTitle = wrapWords(task.title, textAvailableWidth);
			if (wrappedTitle.length === 0) {
				allBodyLines.push(`${glyph} `);
			} else {
				allBodyLines.push(`${glyph} ${colorFn(wrappedTitle[0])}`);
				for (let i = 1; i < wrappedTitle.length; i++) {
					allBodyLines.push(`  ${colorFn(wrappedTitle[i])}`);
				}
			}

			// If task is in_progress and has a note, display it cleanly wrapped below
			if (task.note && task.status === "in_progress") {
				const noteIndent = "  ↳ ";
				const noteAvailableWidth = Math.max(8, innerWidth - visibleWidth(noteIndent));
				const wrappedNote = wrapWords(task.note, noteAvailableWidth);
				for (let i = 0; i < wrappedNote.length; i++) {
					const prefix = i === 0 ? noteIndent : "    ";
					allBodyLines.push(c.dim(`${prefix}${wrappedNote[i]}`));
				}
			}
		}

		// Calculate scrolling limits
		const totalLines = allBodyLines.length;
		const hasOverflow = totalLines > maxRows;
		const maxVisibleLines = hasOverflow ? Math.max(1, maxRows - 1) : maxRows;
		this.lastMaxScrollOffset = Math.max(0, totalLines - maxVisibleLines);
		if (this.scrollOffset > this.lastMaxScrollOffset) {
			this.scrollOffset = this.lastMaxScrollOffset;
		}

		const visibleSlice = allBodyLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);
		const lines: string[] = [top];

		for (const line of visibleSlice) {
			lines.push(boxLine(line));
		}

		if (hasOverflow) {
			const remainingBelow = Math.max(0, totalLines - (this.scrollOffset + visibleSlice.length));
			const infoParts: string[] = [];
			if (this.scrollOffset > 0) infoParts.push(`▲ ${this.scrollOffset} arriba`);
			if (remainingBelow > 0) infoParts.push(`▼ ${remainingBelow} abajo`);
			const scrollIndicator = c.dim(`... ${infoParts.join(" · ")} (wheel scroll)`);
			lines.push(boxLine(scrollIndicator));
		}

		lines.push(bottom);
		return lines;
	}

	renderRail(width: number, availableHeight?: number): string[] {
		try {
			const rows =
				typeof availableHeight === "number" && availableHeight >= 5
					? Math.max(availableHeight - 2, loadCuteLayout().todos.railMaxRows)
					: loadCuteLayout().todos.railMaxRows;
			return this.renderCard(width, rows);
		} catch {
			return [];
		}
	}

	renderBottom(width: number): string[] {
		try {
			return this.renderCard(width, loadCuteLayout().todos.bottomMaxRows);
		} catch {
			return [];
		}
	}

	invalidate(): void {}

	dispose?(): void {}
}
