import path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg, bolden } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import { notify } from "../cute-notify.ts";
import {
	type PersistentMemoryStats,
	DEFAULT_PERSISTENT_MEMORY_URL,
	queryPersistentMemoryStats,
	resolvePersistentMemoryDbCandidate,
	retainPersistentMemory,
	openPersistentMemoryExplorer,
	extractSessionTakeaways,
	resetPersistentMemoryCache,
} from "./memory-client.ts";

interface ActionTarget {
	lineIndex: number;
	action: () => void | Promise<void>;
}

let cachedStats: { [key: string]: { stats: PersistentMemoryStats; expiresAt: number } } = {};
const CACHE_TTL_MS = 5000;

export class CinlodevPersistentMemoryCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private readonly pi?: ExtensionAPI;
	private cwd: string;
	private fetching = false;
	private clickTargets: ActionTarget[] = [];
	private statusNotice: string | null = null;
	private statusNoticeTimer: any = null;

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme, cwd?: string, pi?: ExtensionAPI) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.pi = pi || (tui as any)?.__cutePi;
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

	private getCachedOrTrigger(): PersistentMemoryStats {
		const key = this.cwd;
		const now = Date.now();
		const cached = cachedStats[key];

		if (cached && now < cached.expiresAt) {
			return cached.stats;
		}

		if (!this.fetching) {
			this.fetching = true;
			queryPersistentMemoryStats(this.cwd)
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

		const candidate = resolvePersistentMemoryDbCandidate(this.cwd);
		return {
			available: !!candidate,
			dbPath: candidate?.path ?? null,
			scope: candidate?.scope ?? "none",
			projectName: path.basename(this.cwd),
			scopeKey: `["project","${path.basename(this.cwd)}"]`,
			projectMemoriesCount: 0,
			totalMemoriesCount: 0,
			entitiesCount: 0,
			relationsCount: 0,
			indexedCount: 0,
			pendingCount: 0,
			serverOnline: false,
			lastCheckedAt: now,
		};
	}

	invalidate(): void {
		delete cachedStats[this.cwd];
		resetPersistentMemoryCache();
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
			mint: (s: string): string => palette.mint(s),
			gold: (s: string): string => palette.gold(s),
			text: (s: string): string => palette.text(s),
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
			? `${c.pink(titleGlyph)} ${c.salmon("PERSISTENT MEMORY")}`
			: `${c.pink(titleGlyph)} ${c.salmon("PERSISTENT MEMORY")} ${c.dim("· Knowledge Base")}`;

		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(rawTitle) > maxTitleLen ? truncateAnsiAware(rawTitle, maxTitleLen) : rawTitle;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];

		// 2. Flash Status Notice
		if (this.statusNotice) {
			lines.push(boxLine(c.mint(`✨ ${this.statusNotice}`)));
			lines.push(boxLine(`${c.dim("──────────────────────────────")}`));
		}

		// 3. Inspect Stats
		const stats = this.getCachedOrTrigger();

		if (!stats.available) {
			lines.push(boxLine(`${c.dim("○")} ${c.dim("pi-persistent-memory")}`, c.muted("inactivo")));
			lines.push(boxLine(`  ${c.dim("Sin base ~/.memory/memories.db detectada")}`));

			// Action: Initialize memory database
			const initActionLine = lines.length;
			const initBtn = c.mint("+ inicializar memoria");
			this.clickTargets.push({
				lineIndex: initActionLine,
				action: async () => {
					this.setFlashNotice("Inicializando memoria del proyecto…");
					const ok = await retainPersistentMemory("Proyecto inicializado con pi-persistent-memory", {
						cwd: this.cwd,
						title: `Inicialización: ${stats.projectName}`,
						topicKey: "init",
					});
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

		// Active Memory Status Node + Explorer Action Button
		const rawProject = stats.projectName || path.basename(this.cwd) || "project";
		const shortProjectName =
			rawProject.length > 20 ? rawProject.split("/").pop() || rawProject : rawProject;

		const explorerActionLine = lines.length;
		const explorerBtn = stats.serverOnline
			? `${c.mint("●")} ${c.cyan("explorer ↗")}`
			: c.cyan("explorer ↗");

		this.clickTargets.push({
			lineIndex: explorerActionLine,
			action: async () => {
				this.setFlashNotice("Abriendo Knowledge Explorer…");
				const opened = await openPersistentMemoryExplorer(DEFAULT_PERSISTENT_MEMORY_URL);
				if (!opened) {
					this.setFlashNotice("Error al abrir navegador");
				}
			},
		});

		lines.push(
			boxLine(
				`${c.salmon("┌─")} ${c.bold("Knowledge Base")} ${c.dim(`[${shortProjectName}]`)}`,
				explorerBtn
			)
		);

		// Memories count: Project vs Total
		const projectCount =
			typeof stats.projectMemoriesCount === "number"
				? stats.projectMemoriesCount
				: ((stats as any).memoriesCount ?? 0);
		const totalCount =
			typeof stats.totalMemoriesCount === "number" ? stats.totalMemoriesCount : projectCount;

		const projectBadge =
			projectCount > 0 ? c.gold(`${projectCount} proy`) : c.dim("0 proy");
		const totalBadge =
			totalCount > 0 && totalCount !== projectCount
				? c.dim(`(${totalCount} total)`)
				: "";

		const onlineBadge = stats.serverOnline ? c.mint("UI :7474") : c.dim("offline");
		lines.push(
			boxLine(
				`${c.salmon("│")}  ${c.dim("Recuerdos:")} ${projectBadge} ${totalBadge}`.trim(),
				onlineBadge,
			),
		);

		// Knowledge Graph: Entities & Relations
		const entitiesStr = stats.entitiesCount > 0 ? c.cyan(`${stats.entitiesCount} nodos`) : c.dim("0 nodos");
		const relationsStr = stats.relationsCount > 0 ? c.celeste(`${stats.relationsCount} aristas`) : c.dim("0 aristas");
		lines.push(
			boxLine(
				`${c.salmon("│")}  ${c.dim("Grafo:")} ${entitiesStr} · ${relationsStr}`
			)
		);

		// Vector & FTS Indexing Status
		if (stats.pendingCount > 0) {
			lines.push(
				boxLine(
					`${c.salmon("│")}  ${c.dim("Vectores:")} ${c.mint(`${stats.indexedCount} ok`)} · ${c.gold(`${stats.pendingCount} pend`)}`
				)
			);
		}

		// Action: Retain Session Snapshot
		const retainActionLine = lines.length;
		const retainBtn = c.mint("💾 Retener Sesión");
		this.clickTargets.push({
			lineIndex: retainActionLine,
			action: async () => {
				// 1. Si la API de Pi está disponible, delegar al agente inteligente
				if (this.pi?.sendUserMessage) {
					this.setFlashNotice("Invocando al agente para retener sesión…");
					try {
						this.pi.sendUserMessage(
							"Revisá la memoria del proyecto con memory_context o memory_search para ver qué fue lo último guardado, analizá qué decisiones de arquitectura, hitos técnicos o soluciones se lograron en esta sesión, y guardá un resumen de sesión estructurado y útil usando la herramienta memory_save(type='session_summary').",
							{ deliverAs: "followUp" },
						);
						notify(this.ctx, "Agente iniciado para retener memoria de sesión", "info");
						this.invalidate();
					} catch {
						this.setFlashNotice("Error al invocar al agente");
					}
					return;
				}

				// 2. Fallback offline: guardado directo en SQLite
				this.setFlashNotice("Analizando sesión para retener…");
				const takeaway = extractSessionTakeaways(this.ctx);
				const contentToRetain = takeaway || `Hitos y estado de trabajo en ${path.basename(this.cwd)}`;

				const ok = await retainPersistentMemory(contentToRetain, {
					cwd: this.cwd,
					customDbPath: stats.dbPath || undefined,
					title: `Session Snapshot: ${stats.projectName}`,
					topicKey: "session.retained",
				});

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
		const lastHeadline =
			stats.lastTitle || stats.lastSnippet || (stats as any).lastMemorySnippet || "";
		if (lastHeadline) {
			const shortTopic = stats.lastTopic
				? stats.lastTopic.length > 14
					? stats.lastTopic.slice(0, 13) + "…"
					: stats.lastTopic
				: "";
			const topicTag = shortTopic ? c.gold(`[${shortTopic}] `) : "";
			lines.push(
				boxLine(
					`${c.salmon("└──")} ${c.dim("Último:")} ${topicTag}${c.text(lastHeadline)}`,
				),
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

// Backward-compatibility alias
export const CinlodevMemoryGraphCard = CinlodevPersistentMemoryCard;
