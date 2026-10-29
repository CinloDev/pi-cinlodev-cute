import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderBoxCard, type CardTheme } from "../card-frame.ts";
import { openExternalUrl } from "../editor-launcher.ts";

export interface EngramStats {
	healthy: boolean;
	totalObservations: number;
	totalSessions: number;
	totalPrompts: number;
}

export function detectProjectName(cwd: string): string {
	try {
		const identityPath = path.join(cwd, ".git", "engram-project-identity.json");
		if (fs.existsSync(identityPath)) {
			const content = JSON.parse(fs.readFileSync(identityPath, "utf-8"));
			if (typeof content?.project === "string" && content.project.trim().length > 0) {
				return content.project.trim();
			}
		}
	} catch {}

	try {
		const pkgPath = path.join(cwd, "package.json");
		if (fs.existsSync(pkgPath)) {
			const content = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			if (typeof content?.name === "string" && content.name.trim().length > 0) {
				return content.name.trim();
			}
		}
	} catch {}

	return path.basename(cwd);
}

let cachedStats: { stats: EngramStats; readAt: number; project: string } | undefined;

export function fetchEngramStats(project: string, port = 7437, ttlMs = 5000): Promise<EngramStats> {
	const now = Date.now();
	if (cachedStats && cachedStats.project === project && now - cachedStats.readAt < ttlMs) {
		return Promise.resolve(cachedStats.stats);
	}

	return new Promise((resolve) => {
		const req = http.get(
			`http://127.0.0.1:${port}/stats?project=${encodeURIComponent(project)}`,
			{ timeout: 1000 },
			(res) => {
				let data = "";
				res.on("data", (chunk) => { data += chunk; });
				res.on("end", () => {
					try {
						const json = JSON.parse(data);
						const stats: EngramStats = {
							healthy: true,
							totalObservations: Number(json.total_observations ?? json.totalObservations ?? 0),
							totalSessions: Number(json.total_sessions ?? json.totalSessions ?? 0),
							totalPrompts: Number(json.total_prompts ?? json.totalPrompts ?? 0),
						};
						cachedStats = { stats, readAt: Date.now(), project };
						resolve(stats);
					} catch {
						resolve({ healthy: true, totalObservations: 0, totalSessions: 0, totalPrompts: 0 });
					}
				});
			},
		);

		req.on("error", () => {
			resolve({ healthy: false, totalObservations: 0, totalSessions: 0, totalPrompts: 0 });
		});

		req.on("timeout", () => {
			req.destroy();
			resolve({ healthy: false, totalObservations: 0, totalSessions: 0, totalPrompts: 0 });
		});
	});
}

export class EngramCard implements Component {
	private readonly cwd: string;
	private readonly theme?: CardTheme;
	private lastStats: EngramStats = { healthy: false, totalObservations: 0, totalSessions: 0, totalPrompts: 0 };
	private checking = false;

	constructor(cwd: string, theme?: CardTheme) {
		this.cwd = cwd;
		this.theme = theme;
		this.handleRailClick = this.handleRailClick.bind(this);
		this.handleMouse = this.handleMouse.bind(this);
		this.check();
	}

	invalidate(): void {
		cachedStats = undefined;
		this.check();
	}

	digest(): string {
		return `${this.lastStats.healthy}:${this.lastStats.totalObservations}:${this.lastStats.totalSessions}`;
	}

	handleRailClick(_lineIndex?: number): boolean {
		this.invalidate();
		openExternalUrl("http://localhost:7437/dashboard/");
		return true;
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean; render?: boolean } | undefined {
		if (event.type === "click") {
			const handled = this.handleRailClick(event.y);
			if (handled) return { handled: true, render: true };
		}
		return undefined;
	}

	private check(): void {
		if (this.checking) return;
		this.checking = true;
		const project = detectProjectName(this.cwd);
		fetchEngramStats(project).then((stats) => {
			this.lastStats = stats;
			this.checking = false;
		}).catch(() => {
			this.checking = false;
		});
	}

	render(width: number): string[] {
		const project = detectProjectName(this.cwd);
		const body: string[] = [];

		const healthBadge = this.lastStats.healthy ? "● Daemon Activo (:7437)" : "○ Daemon Desconectado";
		body.push(healthBadge);
		body.push(`Proyecto: ${project}`);

		if (this.lastStats.healthy) {
			body.push(`Memorias: ${this.lastStats.totalObservations} · Sesiones: ${this.lastStats.totalSessions}`);
		} else {
			body.push("Memoria local disponible");
		}

		return renderBoxCard("Engram Memory", body, width, this.theme);
	}
}

export interface ToolCounts {
	read: number;
	write: number;
	bash: number;
	engram: number;
	grep: number;
	search: number;
	other: number;
	total: number;
}

export class ToolsCard implements Component {
	private readonly theme?: CardTheme;
	private readonly ctxProvider?: () => any;
	private counts: ToolCounts = { read: 0, write: 0, bash: 0, engram: 0, grep: 0, search: 0, other: 0, total: 0 };

	constructor(theme?: CardTheme, ctxProvider?: () => any) {
		this.theme = theme;
		this.ctxProvider = ctxProvider;
		this.handleRailClick = this.handleRailClick.bind(this);
		this.handleMouse = this.handleMouse.bind(this);
	}

	invalidate(): void {}

	digest(): string {
		return `${this.counts.total}:${this.counts.read}:${this.counts.write}`;
	}

	handleRailClick(_lineIndex?: number): boolean {
		this.syncWithContext();
		return true;
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean; render?: boolean } | undefined {
		if (event.type === "click") {
			const handled = this.handleRailClick(event.y);
			if (handled) return { handled: true, render: true };
		}
		return undefined;
	}

	private syncWithContext(): void {
		if (!this.ctxProvider) return;
		try {
			const ctx = this.ctxProvider();
			const branch = ctx?.sessionManager?.getBranch?.() ?? [];
			const newCounts: ToolCounts = { read: 0, write: 0, bash: 0, engram: 0, grep: 0, search: 0, other: 0, total: 0 };
			for (const entry of branch) {
				if (entry.type !== "message" || !entry.message) continue;
				const msg = entry.message;
				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					for (const part of msg.content) {
						if (part && typeof part === "object" && part.type === "toolCall") {
							const lower = String(part.name || "").trim().toLowerCase();
							newCounts.total++;
							if (lower === "read") newCounts.read++;
							else if (lower === "write" || lower === "edit") newCounts.write++;
							else if (lower === "bash") newCounts.bash++;
							else if (lower.startsWith("mem_")) newCounts.engram++;
							else if (lower === "grep") newCounts.grep++;
							else if (lower.includes("search")) newCounts.search++;
							else newCounts.other++;
						}
					}
				}
			}
			if (newCounts.total > 0) this.counts = newCounts;
		} catch {}
	}

	render(width: number): string[] {
		this.syncWithContext();
		const body: string[] = [];

		if (this.counts.total === 0) {
			body.push("Sin tools ejecutadas en sesión");
		} else {
			const pills: string[] = [];
			if (this.counts.read > 0) pills.push(`read:${this.counts.read}`);
			if (this.counts.write > 0) pills.push(`write:${this.counts.write}`);
			if (this.counts.bash > 0) pills.push(`bash:${this.counts.bash}`);
			if (this.counts.engram > 0) pills.push(`mem:${this.counts.engram}`);
			if (this.counts.grep > 0) pills.push(`grep:${this.counts.grep}`);

			body.push(pills.join(" · "));
			body.push(`Total llamadas: ${this.counts.total}`);
		}

		const hint = this.counts.total > 0 ? `${this.counts.total} calls` : undefined;
		return renderBoxCard("Tools Telemetry", body, width, this.theme, { hint });
	}
}
