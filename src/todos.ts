import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Cinlodev CUTE Palette ANSI TrueColor codes (identical to src/footer.ts)
const C_VIOLET = "\x1b[38;2;142;68;173m";   // #8e44ad - Dividers & subtle borders
const C_PINK_BRIGHT = "\x1b[38;2;255;177;221m"; // #FFB1DD - Petal / Glyph accent
const C_PINK_ACCENT = "\x1b[38;2;240;149;200m"; // #F095C8 - Brand text
const C_GOLD = "\x1b[38;2;224;194;122m";      // #E0C27A - Thinking / Highlights
const C_YELLOW = "\x1b[38;2;242;184;109m";    // #F2B86D - Git dirty warning
const C_TEXT = "\x1b[38;2;246;239;243m";      // #F6EFF3 - Primary text
const C_MUTED = "\x1b[38;2;167;142;155m";     // #A78E9B - Secondary labels
const C_DIM = "\x1b[38;2;118;97;107m";        // #76616B - Dim / empty gauge
const C_MINT = "\x1b[38;2;180;231;199m";      // #B4E7C7 - Done checks
const RESET = "\x1b[39m";

const RAIL_MAX_ROWS = 8;
const BOTTOM_MAX_ROWS = 4;

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

function glyphFor(status: TodoTask["status"]): string {
	if (status === "done") return `${C_MINT}✓${RESET}`;
	if (status === "in_progress") return `${C_GOLD}◉${RESET}`;
	return `${C_DIM}○${RESET}`;
}

/** Read-only mirror of the host harness todo checklist for the sidebar rail. */
export class CinlodevTodoMirror implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private lastSignature = "";

	constructor(ctx: ExtensionContext, tui: TUI) {
		this.ctx = ctx;
		this.tui = tui;
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
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;

		const boxLine = (left: string, right = ""): string => {
			const spaceNeeded = innerWidth - visibleWidth(left) - visibleWidth(right);
			const pad = " ".repeat(Math.max(1, spaceNeeded));
			const content = truncateToWidth(left + pad + right, innerWidth);
			const fill = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
			return `${C_VIOLET}║${RESET} ${content}${fill} ${C_VIOLET}║${RESET}`;
		};

		const done = tasks.filter((task) => task.status === "done").length;
		const rawTitle = `✿ Todos · ${done} of ${tasks.length}`;
		const titleStr = `${C_PINK_BRIGHT}✿${RESET} ${C_TEXT}Todos · ${done} of ${tasks.length}${RESET}`;
		const fillTop = Math.max(0, safeWidth - 4 - visibleWidth(rawTitle) - 1);
		const top = `${C_VIOLET}╔═ ${titleStr} ${C_VIOLET}${"═".repeat(fillTop)}╗${RESET}`;
		const bottom = `${C_VIOLET}╚${"═".repeat(safeWidth - 2)}╝${RESET}`;

		const lines: string[] = [top];
		for (const task of tasks.slice(0, maxRows)) {
			lines.push(boxLine(`${glyphFor(task.status)} ${C_TEXT}${task.title}${RESET}`));
		}
		if (tasks.length > maxRows) {
			lines.push(boxLine(`${C_DIM}+${tasks.length - maxRows} más${RESET}`));
		}
		lines.push(bottom);
		return lines;
	}

	renderRail(width: number): string[] {
		try {
			return this.renderCard(width, RAIL_MAX_ROWS);
		} catch {
			return [];
		}
	}

	renderBottom(width: number): string[] {
		try {
			return this.renderCard(width, BOTTOM_MAX_ROWS);
		} catch {
			return [];
		}
	}

	invalidate(): void {}

	dispose?(): void {}
}
