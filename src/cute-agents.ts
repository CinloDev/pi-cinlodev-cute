import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg, bolden, type CutePalette } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";
import { readActiveProfile } from "./cute-paths.ts";
import { loadProfileDetails, type FullProfileData } from "./cute-profiles.ts";

export interface SubagentTaskRecord {
	id: string;
	callId?: string;
	agent: string;
	label: string;
	task: string;
	mode: "task" | "background";
	status: "running" | "completed" | "failed" | "cancelled";
	startedAt: number;
	finishedAt?: number;
	resultSummary?: string;
	error?: string;
}

export interface OrchestratorStatus {
	hostModel: string;
	hostEffort?: string;
	activeSessionId?: string;
	state: "orchestrating" | "delegating" | "idle";
	runningCount: number;
	completedCount: number;
	failedCount: number;
	totalTasks: number;
}

/**
 * Returns dynamic role color based on semantic subagent name conventions.
 * Respects Zero-Hardcode Rule 4: Grouping by convention with safe fallbacks.
 */
export function getAgentRoleColor(agentName: string, palette: any): (s: string) => string {
	const lower = agentName.toLowerCase();
	if (lower.startsWith("arch") || lower.includes("architect") || lower.includes("plan") || lower.includes("lead")) {
		return palette.cyan || palette.celeste || palette.mint; // Celeste
	}
	if (lower.includes("research") || lower.includes("search") || lower.includes("explore") || lower.includes("investig")) {
		return palette.gold; // Dorado
	}
	if (lower.includes("write") || lower.includes("code") || lower.includes("impl") || lower.includes("dev") || lower.includes("worker")) {
		return palette.mint; // Menta
	}
	if (lower.includes("review") || lower.includes("judge") || lower.includes("verify") || lower.includes("audit") || lower.includes("test")) {
		return palette.salmon || palette.orange || palette.coral; // Salmón
	}
	return palette.pinkAccent || palette.pink || palette.gold; // Rosa CUTE por defecto
}

/**
 * Formats status tag with semáforo icons and palette colors.
 */
export function formatSubagentStatusTag(status: SubagentTaskRecord["status"], palette: any): string {
	switch (status) {
		case "running":
			return `${palette.mint("●")} ${palette.mint("RUNNING")}`;
		case "completed":
			return `${palette.mint("✔")} ${palette.dim("DONE")}`;
		case "failed":
			return `${palette.coral("✖")} ${palette.coral("FAIL")}`;
		case "cancelled":
			return `${palette.muted("⊘")} ${palette.muted("CANCEL")}`;
	}
}

/**
 * Formats duration from milliseconds into human-readable string.
 */
export function formatTaskDuration(ms: number): string {
	if (ms <= 0 || isNaN(ms)) return "0s";
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const remSecs = secs % 60;
	return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

/**
 * Extracts and reconstructs subagent tasks from the active session branch history.
 */
export function collectSessionSubagentTasks(ctx?: ExtensionContext | any): SubagentTaskRecord[] {
	if (!ctx) return [];
	const branch = ctx.sessionManager?.getBranch?.() ?? [];
	const tasks: SubagentTaskRecord[] = [];
	const taskMapByCallId = new Map<string, SubagentTaskRecord>();
	const taskMapByTaskId = new Map<string, SubagentTaskRecord>();

	let taskSeq = 1;

	for (const entry of branch) {
		if (entry.type !== "message" || !entry.message) continue;
		const msg = entry.message;

		// 1. Assistant message initiating subagents
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (!part || typeof part !== "object") continue;
				if (part.type === "toolCall" && (part.name === "subagent_run" || part.name === "subagent_continue")) {
					const args = part.arguments || {};
					const agent = String(args.agent || args.name || "worker");
					const label = String(args.label || args.task || args.prompt || `Task ${taskSeq}`).trim();
					const fullTask = String(args.task || args.prompt || "");
					const mode = args.mode === "background" ? "background" : "task";
					const startedAt = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();

					const record: SubagentTaskRecord = {
						id: `T-${taskSeq++}`,
						callId: part.id,
						agent,
						label: label.length > 36 ? label.slice(0, 35) + "…" : label,
						task: fullTask,
						mode,
						status: "running",
						startedAt,
					};

					tasks.push(record);
					if (part.id) {
						taskMapByCallId.set(part.id, record);
					}
				} else if (part.type === "toolCall" && part.name === "subagent_cancel") {
					const targetTaskId = String(part.arguments?.task_id || "").trim();
					if (targetTaskId && taskMapByTaskId.has(targetTaskId)) {
						const rec = taskMapByTaskId.get(targetTaskId)!;
						rec.status = "cancelled";
					}
				}
			}
		}

		// 2. Tool result message resolving subagent runs
		if (msg.role === "toolResult" && msg.toolCallId) {
			const record = taskMapByCallId.get(msg.toolCallId);
			if (record) {
				const finishedAt = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
				record.finishedAt = finishedAt;

				if (msg.isError) {
					record.status = "failed";
					record.error = String(msg.content ?? msg.text ?? "Execution error");
				} else {
					const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
					if (contentStr.toLowerCase().includes("cancelled") || contentStr.toLowerCase().includes("canceled")) {
						record.status = "cancelled";
					} else {
						record.status = "completed";
					}

					// Check if background task returned a task_id
					try {
						const match = contentStr.match(/task_id["':\s]+([a-zA-Z0-9_-]+)/i);
						if (match && match[1]) {
							taskMapByTaskId.set(match[1], record);
							record.id = match[1];
						}
					} catch {}

					const preview = contentStr.trim().replace(/\s+/g, " ");
					record.resultSummary = preview.length > 50 ? preview.slice(0, 48) + "…" : preview;
				}
			}
		}
	}

	return tasks;
}

/**
 * Sidebar Orchestrator & Subagents Card for pi-cinlodev-cute.
 * Displays:
 * 1. Host Orchestrator status node (model, effort, session status).
 * 2. Visual tree of configured subagent roster (architect, researcher, writer, reviewer, etc.).
 * 3. Live tree of delegated subagent tasks with status pills, elapsed duration, and results.
 * 4. Interactive click toggling between compact tree and detailed views.
 */
export class CinlodevAgentsCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private readonly pi?: ExtensionAPI;
	private cwd?: string;

	private liveTasks: SubagentTaskRecord[] = [];
	private expandedTaskId: string | null = null;
	private viewMode: "all" | "tasks" | "roster" = "all";
	private taskScrollOffset = 0;
	private lastBranchLength = -1;

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme, pi?: ExtensionAPI, cwd?: string) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.pi = pi;
		this.cwd = cwd || ctx?.cwd || process.cwd();

		if (this.pi) {
			this.pi.on("tool_execution_start", (event: any) => {
				if (event?.toolName === "subagent_run" || event?.toolName === "subagent_continue") {
					const args = event.arguments || {};
					const agent = String(args.agent || args.name || "worker");
					const label = String(args.label || args.task || args.prompt || "Subagent Task").trim();
					const fullTask = String(args.task || args.prompt || "");
					const mode = args.mode === "background" ? "background" : "task";

					const newTask: SubagentTaskRecord = {
						id: `live-${Date.now().toString(36)}`,
						agent,
						label: label.length > 36 ? label.slice(0, 35) + "…" : label,
						task: fullTask,
						mode,
						status: "running",
						startedAt: Date.now(),
					};
					this.liveTasks.unshift(newTask);
					this.tui?.requestRender();
				}
			});

			this.pi.on("tool_execution_end", (event: any) => {
				if (event?.toolName === "subagent_run" || event?.toolName === "subagent_continue") {
					if (this.liveTasks.length > 0 && this.liveTasks[0].status === "running") {
						this.liveTasks[0].finishedAt = Date.now();
						this.liveTasks[0].status = event.isError ? "failed" : "completed";
						if (event.result) {
							const str = String(event.result);
							this.liveTasks[0].resultSummary = str.slice(0, 48);
						}
					}
					this.tui?.requestRender();
				}
			});
		}
	}

	invalidate(): void {
		this.lastBranchLength = -1;
	}

	handleClick(_lineIndex?: number, button?: string, _localX?: number): boolean {
		if (button === "right") {
			// Right click cycles view modes: all -> tasks -> roster -> all
			this.viewMode = this.viewMode === "all" ? "tasks" : this.viewMode === "tasks" ? "roster" : "all";
		} else {
			// Left click toggles expanding recent task details
			const allTasks = this.getUnifiedTasks();
			if (allTasks.length > 0) {
				const firstId = allTasks[0].id;
				this.expandedTaskId = this.expandedTaskId === firstId ? null : firstId;
			} else {
				this.viewMode = this.viewMode === "all" ? "roster" : "all";
			}
		}
		this.tui?.requestRender();
		return true;
	}

	handleWheel(delta: number): boolean {
		if (delta === 0) return false;
		const allTasks = this.getUnifiedTasks();
		if (allTasks.length <= 3) return false;

		const maxOffset = Math.max(0, allTasks.length - 3);
		const newOffset = Math.min(maxOffset, Math.max(0, this.taskScrollOffset + (delta > 0 ? 1 : -1)));
		if (newOffset !== this.taskScrollOffset) {
			this.taskScrollOffset = newOffset;
			this.tui?.requestRender();
			return true;
		}
		return false;
	}

	handleRailClick(lineIndex: number, button?: string, localX?: number): boolean {
		return this.handleClick(lineIndex, button, localX);
	}

	handleRailWheel(delta: number): boolean {
		return this.handleWheel(delta);
	}

	private getUnifiedTasks(): SubagentTaskRecord[] {
		const sessionTasks = collectSessionSubagentTasks(this.ctx);
		// Deduplicate: prepend liveTasks that are not in sessionTasks
		const ids = new Set(sessionTasks.map((t) => t.id));
		const combined = [...sessionTasks];
		for (const lt of this.liveTasks) {
			if (!ids.has(lt.id)) {
				combined.unshift(lt);
			}
		}
		// Sort newest first
		return combined.sort((a, b) => b.startedAt - a.startedAt);
	}

	render(width: number): string[] {
		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const palette = cutePalette(this.theme);
		const c = {
			...palette,
			pink: (s: string): string => palette.pinkAccent(s),
			muted: (s: string): string => palette.muted(s),
			dim: (s: string): string => palette.dim(s),
			celeste: (s: string): string => (theme ? safeFg(theme, "write", s) : s),
			cyan: (s: string): string => (theme ? safeFg(theme, "write", s) : s),
			salmon: (s: string): string => (theme ? safeFg(theme, "salmon", s) : s),
			bold: (s: string): string => bolden(theme, s),
		};

		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		// 1. Top border with Title & Glyph
		const titleGlyph = g.brand || "✿";
		const rawTitle = safeWidth < 40 ? `${c.pink(titleGlyph)} ${c.gold("AGENTS")}` : `${c.pink(titleGlyph)} ${c.gold("AGENTS")} ${c.dim("· Orquestador & Workers")}`;
		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(rawTitle) > maxTitleLen ? truncateAnsiAware(rawTitle, maxTitleLen) : rawTitle;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];

		// 2. Load Active Profile details for Host and Subagents roster
		const activeProfileName = readActiveProfile(this.cwd);
		const profileDetails = loadProfileDetails(activeProfileName, this.cwd);
		const allTasks = this.getUnifiedTasks();

		const runningTasks = allTasks.filter((t) => t.status === "running");
		const completedTasks = allTasks.filter((t) => t.status === "completed");
		const failedTasks = allTasks.filter((t) => t.status === "failed");

		// Host Orchestrator info
		const hostModelRaw = profileDetails?.model_profiles?.host?.model || profileDetails?.default_model || (this.ctx as any)?.model?.id || "orchestrator";
		const hostModelShort = hostModelRaw.split("/").pop() || hostModelRaw;
		const hostEffort = profileDetails?.model_profiles?.host?.effort || profileDetails?.default_effort || "high";

		let hostStatusBadge = `${c.mint("●")} ${c.mint("Activo")}`;
		if (runningTasks.length > 0) {
			hostStatusBadge = `${c.cyan("●")} ${c.cyan(`Delegando (${runningTasks.length})`)}`;
		} else if (allTasks.length === 0) {
			hostStatusBadge = `${c.dim("●")} ${c.dim("En espera")}`;
		}

		// 3. Render Host Root Node
		lines.push(boxLine(`${c.pink("┌─")} ${c.bold("Host Orchestrator")} ${c.dim(`[${activeProfileName}]`)}`, hostStatusBadge));
		lines.push(boxLine(`${c.pink("│")}  ${c.dim("Model:")} ${c.gold(hostModelShort)} ${c.dim(`[${hostEffort}]`)}`));

		const sessId = (this.ctx?.sessionManager as any)?.getSessionId?.() || "";
		const shortSess = sessId ? `sess-${sessId.slice(0, 6)}` : "local";
		lines.push(
			boxLine(
				`${c.pink("│")}  ${c.dim("Sess:")} ${c.muted(shortSess)}`,
				`${c.cyan(String(allTasks.length))} ${c.dim("tareas")}`
			)
		);

		// Divider branch between Host and details
		lines.push(boxLine(`${c.pink("│")}`));

		// 4. Render Subagents Activity / Tasks Section (if viewMode !== "roster")
		if (this.viewMode !== "roster") {
			const tasksHeaderBadge = runningTasks.length > 0
				? `${c.mint(`${runningTasks.length} act`)} · ${c.dim(`${completedTasks.length} ok`)}`
				: `${c.dim(`${allTasks.length} total`)}`;

			const hasTasks = allTasks.length > 0;
			const treeConnector = this.viewMode === "tasks" || !profileDetails?.model_profiles ? "└─" : "├─";

			lines.push(
				boxLine(
					`${c.pink(treeConnector)} ${c.bold("Tareas Delegadas")}`,
					tasksHeaderBadge
				)
			);

			if (!hasTasks) {
				const subBar = treeConnector === "└─" ? "  " : `${c.pink("│")} `;
				lines.push(boxLine(`${subBar}${c.dim("(Sin tareas delegadas en esta sesión)")}`));
				lines.push(boxLine(`${subBar}${c.dim("Esperando llamadas a subagent_run…")}`));
			} else {
				// Display top tasks with pagination/scrolling window of 3
				const visibleTasks = allTasks.slice(this.taskScrollOffset, this.taskScrollOffset + 3);
				const isLastSection = treeConnector === "└─";
				const sectionBar = isLastSection ? " " : c.pink("│");

				for (let i = 0; i < visibleTasks.length; i++) {
					const t = visibleTasks[i];
					const isLastTask = i === visibleTasks.length - 1;
					const taskConnector = isLastTask ? "└─►" : "├─►";
					const taskSubBar = isLastTask ? "   " : "│  ";

					const roleColor = getAgentRoleColor(t.agent, palette);
					const agentTag = roleColor(`[${t.agent}]`);
					const statusTag = formatSubagentStatusTag(t.status, palette);

					lines.push(
						boxLine(
							`${sectionBar} ${c.pink(taskConnector)} ${agentTag} ${c.text(t.label)}`,
							statusTag
						)
					);

					// Task metadata line: mode, duration
					const now = Date.now();
					const durationMs = t.finishedAt ? t.finishedAt - t.startedAt : now - t.startedAt;
					const durStr = formatTaskDuration(durationMs);
					const modeStr = t.mode === "background" ? c.dim("bg") : c.dim("task");

					lines.push(
						boxLine(
							`${sectionBar} ${c.pink(taskSubBar)} ${c.dim("ID:")} ${c.muted(t.id)} ${c.dim("·")} ${modeStr} ${c.dim("·")} ${c.muted(durStr)}`
						)
					);

					// Expanded result summary if clicked
					if (this.expandedTaskId === t.id && (t.resultSummary || t.error)) {
						const detail = t.error ? c.coral(`ERR: ${t.error}`) : c.dim(`Res: ${t.resultSummary}`);
						lines.push(boxLine(`${sectionBar} ${c.pink(taskSubBar)} ↳ ${detail}`));
					}
				}

				if (allTasks.length > 3) {
					lines.push(
						boxLine(
							`${sectionBar} ${c.dim(`[Scroll mouse: ${this.taskScrollOffset + 1}-${Math.min(allTasks.length, this.taskScrollOffset + 3)} de ${allTasks.length}]`)}`
						)
					);
				}
			}

			if (this.viewMode !== "tasks" && profileDetails?.model_profiles) {
				lines.push(boxLine(`${c.pink("│")}`));
			}
		}

		// 5. Render Configured Subagents Roster Section (if viewMode !== "tasks")
		if (this.viewMode !== "tasks" && profileDetails?.model_profiles) {
			const subagentEntries = Object.entries(profileDetails.model_profiles).filter(
				([name]) => name !== "host"
			);

			lines.push(
				boxLine(
					`${c.pink("└──")} ${c.bold("Topología de Subagentes")}`,
					c.dim(`${subagentEntries.length} agentes`)
				)
			);

			if (subagentEntries.length === 0) {
				lines.push(boxLine(`    ${c.dim("No hay subagentes configurados en este perfil")}`));
			} else {
				// If viewMode === "roster" or allTasks.length === 0, render full vertical tree
				if (this.viewMode === "roster" || allTasks.length === 0) {
					for (let i = 0; i < subagentEntries.length; i++) {
						const [name, cfg] = subagentEntries[i];
						const isLast = i === subagentEntries.length - 1;
						const conn = isLast ? "└──" : "├──";
						const roleColor = getAgentRoleColor(name, palette);
						const modelRaw = cfg.model || "default";
						const modelShort = modelRaw.split("/").pop() || modelRaw;
						const effort = cfg.effort || "med";

						lines.push(
							boxLine(
								`    ${c.pink(conn)} ${roleColor(`[${name}]`)} ${c.gold(modelShort)}`,
								c.dim(`[${effort}]`)
							)
						);
					}
				} else {
					// Compact pills row in combined mode
					const pills: string[] = [];
					for (const [name] of subagentEntries.slice(0, 4)) {
						const roleColor = getAgentRoleColor(name, palette);
						pills.push(roleColor(`[${name}]`));
					}
					if (subagentEntries.length > 4) {
						pills.push(c.dim(`+${subagentEntries.length - 4}`));
					}
					lines.push(boxLine(`    ${c.pink("├─►")} ${pills.join(" ")}`, c.dim("(Clic: toggle)")));
				}
			}
		}

		lines.push(bottom);
		return lines;
	}
}
