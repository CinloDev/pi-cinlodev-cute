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

/** Read-only mirror of the host harness todo checklist for the sidebar rail. */
export class CinlodevTodoMirror implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private lastSignature = "";

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
				this.tui.requestRender();
			}
		} catch {}
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

		const lines: string[] = [top];
		for (const task of tasks.slice(0, maxRows)) {
			lines.push(boxLine(`${glyphFor(c, task.status)} ${c.text(task.title)}`));
		}
		if (tasks.length > maxRows) {
			lines.push(
				boxLine(c.dim(strings.moreFmt.replace("{remaining}", String(tasks.length - maxRows)))),
			);
		}
		lines.push(bottom);
		return lines;
	}

	renderRail(width: number): string[] {
		try {
			return this.renderCard(width, loadCuteLayout().todos.railMaxRows);
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
