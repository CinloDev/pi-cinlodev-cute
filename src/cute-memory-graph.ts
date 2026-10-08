import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg, bolden } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";
import { notify } from "./cute-notify.ts";

const execAsync = promisify(exec);

export const DEFAULT_MEMORY_GRAPH_URL = "http://127.0.0.1:7474";

export interface MemoryGraphStats {
	available: boolean;
	dbPath: string | null;
	scope: "project" | "global" | "none";
	memoriesCount: number;
	entitiesCount: number;
	relationsCount: number;
	activeLeasesCount: number;
	lastMemorySnippet?: string;
	lastTopic?: string;
	lastCheckedAt: number;
}

interface ActionTarget {
	lineIndex: number;
	action: () => void | Promise<void>;
}

let cachedStats: { [key: string]: { stats: MemoryGraphStats; expiresAt: number } } = {};
const CACHE_TTL_MS = 5000;

export function resetMemoryGraphCache(): void {
	cachedStats = {};
}

/**
 * Resolves the candidate SQLite DB path for the current project or global fallback.
 */
export function resolveMemoryGraphDbCandidate(cwd?: string, allowGlobal = true): { path: string; scope: "project" | "global" } | null {
	const projectCwd = cwd ? path.resolve(cwd) : process.cwd();

	// 1. Project-level: .pi/memory.db or memory.db
	const projectPiDb = path.join(projectCwd, ".pi", "memory.db");
	if (fs.existsSync(projectPiDb)) {
		return { path: projectPiDb, scope: "project" };
	}
	const projectRootDb = path.join(projectCwd, "memory.db");
	if (fs.existsSync(projectRootDb)) {
		return { path: projectRootDb, scope: "project" };
	}

	// 2. Global-level fallback: ~/.pi/agent/memory/global.db
	if (allowGlobal) {
		const globalDb = path.join(os.homedir(), ".pi", "agent", "memory", "global.db");
		if (fs.existsSync(globalDb)) {
			return { path: globalDb, scope: "global" };
		}
	}

	return null;
}

/**
 * Opens the memory graph UI in the default browser.
 */
export async function openMemoryGraphExplorer(url = DEFAULT_MEMORY_GRAPH_URL): Promise<boolean> {
	try {
		const isMac = process.platform === "darwin";
		const isWin = process.platform === "win32";
		const opener = isMac ? "open" : isWin ? "start" : "xdg-open";
		exec(`${opener} "${url}"`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Synthesizes and extracts key takeaways or technical progress from current session branch.
 */
export function extractSessionTakeaways(ctx?: ExtensionContext | any): string | null {
	if (!ctx?.sessionManager) return null;
	const branch = ctx.sessionManager.getBranch?.() ?? [];
	if (!Array.isArray(branch) || branch.length === 0) return null;

	// Search backwards for the most recent assistant conclusion or user prompt
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry?.type !== "message" || !entry.message) continue;
		const msg = entry.message;

		if (msg.role === "assistant") {
			let text = "";
			if (typeof msg.content === "string") {
				text = msg.content;
			} else if (Array.isArray(msg.content)) {
				text = msg.content
					.filter((p: any) => p && p.type === "text" && typeof p.text === "string")
					.map((p: any) => p.text)
					.join(" ");
			}

			// Clean and extract a solid paragraph
			const clean = text
				.replace(/```[\s\S]*?```/g, "") // strip code fences
				.replace(/[#*`_]/g, "") // strip markdown noise
				.replace(/\s+/g, " ")
				.trim();

			if (clean.length >= 25) {
				return clean.length > 240 ? clean.slice(0, 238) + "…" : clean;
			}
		}
	}

	return null;
}

/**
 * Saves a durable memory record into the local SQLite database.
 */
export async function retainMemoryRecord(content: string, cwd?: string, customDbPath?: string): Promise<boolean> {
	if (!content || content.trim().length < 5) return false;

	const resolved = customDbPath
		? { path: customDbPath, scope: "project" as const }
		: resolveMemoryGraphDbCandidate(cwd);

	const targetPath = resolved?.path || path.join(cwd ? path.resolve(cwd) : process.cwd(), ".pi", "memory.db");
	const parentDir = path.dirname(targetPath);
	if (!fs.existsSync(parentDir)) {
		try {
			fs.mkdirSync(parentDir, { recursive: true });
		} catch {}
	}

	const safeContent = content.replace(/'/g, "''").trim();
	const projectName = path.basename(cwd || process.cwd());
	const nowIso = new Date().toISOString();

	// Insert into SQLite via CLI or direct append
	const insertSql = `
		INSERT OR IGNORE INTO memories (type, scope, project, topic_key, status, content, metadata, tags, created_at, updated_at)
		VALUES ('observation', 'project', '${projectName}', 'session.retained', 'active', '${safeContent}', '{}', '["session","cute"]', '${nowIso}', '${nowIso}');
	`;

	try {
		await execAsync(`sqlite3 "${targetPath}" "${insertSql.replace(/\n\s*/g, " ").trim()}"`, { timeout: 2000 });
		return true;
	} catch {
		// If sqlite3 CLI is unavailable, try POSTing to local memory server if active
		try {
			await fetch(`${DEFAULT_MEMORY_GRAPH_URL}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: safeContent,
					type: "observation",
					scope: "project",
					project: projectName,
					tags: ["session", "cute"],
				}),
				signal: AbortSignal.timeout(1500),
			});
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * Ultralight, non-blocking inspector for pi-memory-graph SQLite databases.
 */
export async function queryMemoryGraphStats(cwd?: string, customDbPath?: string): Promise<MemoryGraphStats> {
	const resolvedCandidate = customDbPath
		? { path: customDbPath, scope: "project" as const }
		: resolveMemoryGraphDbCandidate(cwd);

	if (!resolvedCandidate || !fs.existsSync(resolvedCandidate.path)) {
		return {
			available: false,
			dbPath: null,
			scope: "none",
			memoriesCount: 0,
			entitiesCount: 0,
			relationsCount: 0,
			activeLeasesCount: 0,
			lastCheckedAt: Date.now(),
		};
	}

	const dbPath = resolvedCandidate.path;

	try {
		// Run a single bounded query with 1.5s timeout
		const query = `
			SELECT
				(SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND status = 'active'),
				(SELECT COUNT(*) FROM entities),
				(SELECT COUNT(*) FROM entity_edges),
				(SELECT COUNT(*) FROM invocation_leases WHERE status = 'active'),
				(SELECT substr(content, 1, 48) FROM memories WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1),
				(SELECT topic_key FROM memories WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1);
		`;

		const { stdout } = await execAsync(
			`sqlite3 "${dbPath}" "${query.replace(/\n\s*/g, " ").trim()}"`,
			{ timeout: 1500 }
		);

		const parts = stdout.trim().split("|");
		const memoriesCount = parseInt(parts[0], 10) || 0;
		const entitiesCount = parseInt(parts[1], 10) || 0;
		const relationsCount = parseInt(parts[2], 10) || 0;
		const activeLeasesCount = parseInt(parts[3], 10) || 0;
		const lastMemorySnippet = parts[4] ? parts[4].trim().replace(/\s+/g, " ") : undefined;
		const lastTopic = parts[5] ? parts[5].trim() : undefined;

		return {
			available: true,
			dbPath,
			scope: resolvedCandidate.scope,
			memoriesCount,
			entitiesCount,
			relationsCount,
			activeLeasesCount,
			lastMemorySnippet,
			lastTopic,
			lastCheckedAt: Date.now(),
		};
	} catch {
		return {
			available: true,
			dbPath,
			scope: resolvedCandidate.scope,
			memoriesCount: 0,
			entitiesCount: 0,
			relationsCount: 0,
			activeLeasesCount: 0,
			lastCheckedAt: Date.now(),
		};
	}
}

/**
 * CinlodevMemoryGraphCard: Interactive TUI sidebar card showing local pi-memory-graph health,
 * active memories, graph entities, semantic relations, and leases with direct action buttons.
 */
export class CinlodevMemoryGraphCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private cwd: string;
	private fetching = false;
	private clickTargets: ActionTarget[] = [];
	private statusNotice: string | null = null;
	private statusNoticeTimer: any = null;

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme, cwd?: string) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd || ctx?.cwd || process.cwd();
	}

	private setFlashNotice(msg: string, durationMs = 3500): void {
		this.statusNotice = msg;
		if (this.statusNoticeTimer) clearTimeout(this.statusNoticeTimer);
		this.statusNoticeTimer = setTimeout(() => {
			this.statusNotice = null;
			this.tui?.requestRender();
		}, durationMs);
		this.statusNoticeTimer?.unref?.();
		this.tui?.requestRender();
	}

	private getCachedOrTrigger(): MemoryGraphStats {
		const key = this.cwd;
		const now = Date.now();
		const cached = cachedStats[key];

		if (cached && now < cached.expiresAt) {
			return cached.stats;
		}

		if (!this.fetching) {
			this.fetching = true;
			queryMemoryGraphStats(this.cwd)
				.then((stats) => {
					cachedStats[key] = { stats, expiresAt: Date.now() + CACHE_TTL_MS };
					this.fetching = false;
					this.tui?.requestRender();
				})
				.catch(() => {
					this.fetching = false;
				});
		}

		if (cached) return cached.stats;

		const candidate = resolveMemoryGraphDbCandidate(this.cwd);
		return {
			available: !!candidate,
			dbPath: candidate?.path ?? null,
			scope: candidate?.scope ?? "none",
			memoriesCount: 0,
			entitiesCount: 0,
			relationsCount: 0,
			activeLeasesCount: 0,
			lastCheckedAt: now,
		};
	}

	invalidate(): void {
		delete cachedStats[this.cwd];
	}

	handleClick(lineIndex?: number, _button?: string, _localX?: number): boolean {
		if (lineIndex === undefined) return false;

		const target = this.clickTargets.find((t) => t.lineIndex === lineIndex);
		if (target) {
			Promise.resolve(target.action()).catch(() => {});
			return true;
		}

		return false;
	}

	handleRailClick(lineIndex: number, button?: string, localX?: number): boolean {
		return this.handleClick(lineIndex, button, localX);
	}

	render(width: number): string[] {
		this.clickTargets = [];
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
			violet: (s: string): string => (theme ? safeFg(theme, "border", s) : s),
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
		const rawTitle = safeWidth < 40
			? `${c.pink(titleGlyph)} ${c.salmon("GRAPH MEMORY")}`
			: `${c.pink(titleGlyph)} ${c.salmon("GRAPH MEMORY")} ${c.dim("· Episodic & Semantic")}`;

		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(rawTitle) > maxTitleLen ? truncateAnsiAware(rawTitle, maxTitleLen) : rawTitle;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];

		// 2. Flash Status Notice (feedback on click actions)
		if (this.statusNotice) {
			lines.push(boxLine(c.mint(`✨ ${this.statusNotice}`)));
			lines.push(boxLine(`${c.dim("──────────────────────────────")}`));
		}

		// 3. Inspect Stats
		const stats = this.getCachedOrTrigger();

		if (!stats.available) {
			lines.push(boxLine(`${c.dim("○")} ${c.dim("SQLite Knowledge Graph")}`, c.muted("inactivo")));
			lines.push(boxLine(`  ${c.dim("Sin base .pi/memory.db detectada")}`));

			// Action: Initialize memory for this project
			const initActionLine = lines.length;
			const initBtn = c.mint("+ inicializar memoria");
			this.clickTargets.push({
				lineIndex: initActionLine,
				action: async () => {
					this.setFlashNotice("Inicializando memoria del proyecto…");
					const ok = await retainMemoryRecord("Proyecto inicializado con pi-memory-graph", this.cwd);
					if (ok) {
						this.setFlashNotice("¡Memoria inicializada con éxito!");
						this.invalidate();
						notify(this.ctx, "Memoria de proyecto inicializada", "info");
					} else {
						this.setFlashNotice("Error al crear base de datos");
					}
				},
			});
			lines.push(boxLine(`  ${initBtn}`));
			lines.push(bottom);
			return lines;
		}

		// Active Graph Status Node + Explorer Action Button
		const scopeLabel = stats.scope === "project" ? "Proyecto" : "Global";
		const explorerActionLine = lines.length;
		const explorerBtn = c.cyan("explorer ↗");
		this.clickTargets.push({
			lineIndex: explorerActionLine,
			action: async () => {
				this.setFlashNotice("Abriendo Knowledge Explorer…");
				const opened = await openMemoryGraphExplorer();
				if (!opened) {
					this.setFlashNotice("Error al abrir navegador");
				}
			},
		});

		lines.push(
			boxLine(
				`${c.salmon("┌─")} ${c.bold("SQLite Knowledge Graph")} ${c.dim(`[${scopeLabel}]`)}`,
				explorerBtn
			)
		);

		// Core Metrics: Memories count & Leases badge
		const memoriesBadge = stats.memoriesCount > 0 ? c.gold(`${stats.memoriesCount} guardados`) : c.dim("0 recuerdos");
		lines.push(
			boxLine(
				`${c.salmon("│")}  ${c.dim("Recuerdos:")} ${memoriesBadge}`,
				stats.activeLeasesCount > 0 ? `${c.cyan(String(stats.activeLeasesCount))} ${c.dim("leases")}` : `${c.mint("●")} ${c.mint("Activo")}`
			)
		);

		// Graph Topology: Entities & Semantic Relations
		const nodesStr = stats.entitiesCount > 0 ? c.cyan(`${stats.entitiesCount} nodos`) : c.dim("0 nodos");
		const edgesStr = stats.relationsCount > 0 ? c.celeste(`${stats.relationsCount} aristas`) : c.dim("0 aristas");
		lines.push(
			boxLine(
				`${c.salmon("│")}  ${c.dim("Grafo:")} ${nodesStr} · ${edgesStr}`
			)
		);

		// Action: Retain Session Snapshot
		const retainActionLine = lines.length;
		const retainBtn = c.mint("💾 Retener Sesión");
		this.clickTargets.push({
			lineIndex: retainActionLine,
			action: async () => {
				this.setFlashNotice("Analizando sesión para retener…");
				const takeaway = extractSessionTakeaways(this.ctx);
				const contentToRetain = takeaway || `Hitos y estado de trabajo en ${path.basename(this.cwd)}`;

				const ok = await retainMemoryRecord(contentToRetain, this.cwd, stats.dbPath || undefined);
				if (ok) {
					this.setFlashNotice("¡Memoria de sesión retenida!");
					this.invalidate();
					notify(this.ctx, `Memoria retenida: "${contentToRetain.slice(0, 36)}…"`, "info");
				} else {
					this.setFlashNotice("No se pudo retener la memoria");
				}
			},
		});

		lines.push(
			boxLine(
				`${c.salmon("├─")} [Click] ${retainBtn}`,
				c.dim("snapshot")
			)
		);

		// Latest Memory Preview or Topic
		if (stats.lastMemorySnippet) {
			const topicTag = stats.lastTopic ? c.gold(`[${stats.lastTopic}] `) : "";
			lines.push(
				boxLine(
					`${c.salmon("└──")} ${c.dim("Último:")} ${topicTag}${c.text(stats.lastMemorySnippet + "…")}`
				)
			);
		} else {
			lines.push(
				boxLine(
					`${c.salmon("└──")} ${c.dim("Listo para registrar aprendizajes")}`
				)
			);
		}

		lines.push(bottom);
		return lines;
	}
}
