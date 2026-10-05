import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { loadCuteLayout } from "./cute-layout.ts";
import { loadCutePaths } from "./cute-paths.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";

const execAsync = promisify(exec);

export const DEFAULT_ENGRAM_PORT = 7437;
export const DEFAULT_ENGRAM_DASHBOARD = "http://localhost:7437/dashboard/";

export interface EngramCloudConfig {
	serverUrl: string;
	token?: string;
}

export interface EngramDaemonHealth {
	healthy: boolean;
	version?: string;
	instanceId?: string;
}

export interface EngramProjectStats {
	totalObservations: number;
	totalSessions: number;
	totalPrompts: number;
}

export interface EngramSyncStatus {
	enabled: boolean;
	phase: string;
	lastSyncAt: string | null;
	lastError: string;
	consecutiveFailures: number;
}

export interface EngramSnapshot {
	project: string;
	health: EngramDaemonHealth;
	stats: EngramProjectStats | null;
	sync: EngramSyncStatus | null;
	isEnrolled: boolean;
	cloudConfig: EngramCloudConfig | null;
	lastCheck: number;
}

/**
 * Resolves the canonical Engram project name for a given directory.
 */
export function detectProjectName(cwd?: string): string {
	const targetDir = cwd ? path.resolve(cwd) : process.cwd();

	// 1. Check .git/engram-project-identity.json
	try {
		const identityPath = path.join(targetDir, ".git", "engram-project-identity.json");
		if (fs.existsSync(identityPath)) {
			const content = JSON.parse(fs.readFileSync(identityPath, "utf-8"));
			if (typeof content?.project === "string" && content.project.trim().length > 0) {
				return content.project.trim();
			}
		}
	} catch {}

	// 2. Check .engram/config.json
	try {
		const engramConfigPath = path.join(targetDir, ".engram", "config.json");
		if (fs.existsSync(engramConfigPath)) {
			const content = JSON.parse(fs.readFileSync(engramConfigPath, "utf-8"));
			if (typeof content?.project === "string" && content.project.trim().length > 0) {
				return content.project.trim();
			}
		}
	} catch {}

	// 3. Check package.json name
	try {
		const pkgPath = path.join(targetDir, "package.json");
		if (fs.existsSync(pkgPath)) {
			const content = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			if (typeof content?.name === "string" && content.name.trim().length > 0) {
				return content.name.trim();
			}
		}
	} catch {}

	// 4. Fallback to folder name
	return path.basename(targetDir);
}

/**
 * Reads local cloud config from ~/.engram/cloud.json if present.
 */
export function loadEngramCloudConfig(): EngramCloudConfig | null {
	try {
		const configPath = path.join(os.homedir(), ".engram", "cloud.json");
		if (fs.existsSync(configPath)) {
			const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			if (typeof content?.server_url === "string" && content.server_url.trim().length > 0) {
				return {
					serverUrl: content.server_url.trim(),
					token: typeof content?.token === "string" ? content.token.trim() : undefined,
				};
			}
		}
	} catch {}
	return null;
}

/**
 * Resolves the web dashboard URL for Engram Cloud.
 */
export function resolveDashboardUrl(config?: EngramCloudConfig | null, project?: string, customDefault?: string): string {
	let base = customDefault || DEFAULT_ENGRAM_DASHBOARD;
	if (config?.serverUrl) {
		const clean = config.serverUrl.replace(/\/+$/, "");
		base = `${clean}/dashboard/`;
	}
	if (project && project.trim().length > 0) {
		const cleanBase = base.replace(/\/+$/, "");
		return `${cleanBase}/projects/${encodeURIComponent(project.trim())}`;
	}
	return base;
}

export interface EngramHandoffRecord {
	id?: string;
	type?: string;
	title?: string;
	content?: string;
	rawLines?: string[];
	date?: string;
	project?: string;
}

export function parseEngramSearchOutput(raw: string): EngramHandoffRecord | null {
	if (!raw || typeof raw !== "string") return null;
	const idMatch = raw.match(/\[\d+\]\s+#(\d+)\s*\(([^)]+)\)\s*—\s*(.+)/);
	if (!idMatch) return null;
	const id = idMatch[1];
	const type = idMatch[2];
	const title = idMatch[3].trim();

	const lines = raw.split("\n");
	const bodyLines: string[] = [];
	let date = "";
	for (const l of lines) {
		const trimmed = l.trim();
		if (trimmed.startsWith("[")) continue;
		if (trimmed.includes("| project:") || trimmed.includes("| scope:")) {
			const datePart = trimmed.split("|")[0].trim();
			if (datePart) date = datePart;
			continue;
		}
		if (trimmed.length > 0 && !trimmed.startsWith("Found ")) {
			bodyLines.push(trimmed);
		}
	}
	return { id, type, title, content: bodyLines.join(" "), rawLines: bodyLines, date };
}

export async function fetchLatestHandoff(project: string): Promise<EngramHandoffRecord | null> {
	try {
		const { stdout } = await execAsync(`engram search "session summary" --limit 1 --project "${project}"`, {
			timeout: 2500,
		});
		return parseEngramSearchOutput(stdout);
	} catch {
		return null;
	}
}

/**
 * Checks Engram daemon health via HTTP GET /health.
 */
export async function fetchEngramHealth(port = DEFAULT_ENGRAM_PORT): Promise<EngramDaemonHealth> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/health`, {
			signal: AbortSignal.timeout(1200),
		});
		if (!res.ok) return { healthy: false };
		const data = (await res.json()) as any;
		return {
			healthy: data?.status === "ok",
			version: data?.version,
			instanceId: data?.instance_id,
		};
	} catch {
		return { healthy: false };
	}
}

/**
 * Fetches project observation metrics via HTTP GET /stats?project=...
 */
export async function fetchEngramStats(project: string, port = DEFAULT_ENGRAM_PORT): Promise<EngramProjectStats | null> {
	try {
		const url = `http://127.0.0.1:${port}/stats?project=${encodeURIComponent(project)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
		if (!res.ok) return null;
		const data = (await res.json()) as any;
		return {
			totalObservations: Number(data?.total_observations ?? 0),
			totalSessions: Number(data?.total_sessions ?? 0),
			totalPrompts: Number(data?.total_prompts ?? 0),
		};
	} catch {
		return null;
	}
}

/**
 * Fetches sync status via HTTP GET /sync/status?project=...
 */
export async function fetchEngramSyncStatus(project: string, port = DEFAULT_ENGRAM_PORT): Promise<EngramSyncStatus | null> {
	try {
		const url = `http://127.0.0.1:${port}/sync/status?project=${encodeURIComponent(project)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
		if (!res.ok) return null;
		const data = (await res.json()) as any;
		return {
			enabled: Boolean(data?.enabled),
			phase: String(data?.phase || "idle"),
			lastSyncAt: data?.last_sync_at ? String(data.last_sync_at) : null,
			lastError: String(data?.last_error || ""),
			consecutiveFailures: Number(data?.consecutive_failures ?? 0),
		};
	} catch {
		return null;
	}
}

/**
 * Checks whether the project is enrolled for cloud replication in SQLite or CLI.
 */
export async function checkProjectEnrolled(project: string): Promise<boolean> {
	// 1. Try direct SQLite check first (fastest, ~2ms)
	let sqliteChecked = false;
	try {
		const dbPath = path.join(os.homedir(), ".engram", "engram.db");
		if (fs.existsSync(dbPath)) {
			const safeProj = project.replace(/'/g, "''");
			const cmd = `sqlite3 "${dbPath}" "SELECT 1 FROM sync_enrolled_projects WHERE project = '${safeProj}' LIMIT 1;"`;
			const { stdout } = await execAsync(cmd, { timeout: 1500 });
			sqliteChecked = true;
			if (stdout.trim() === "1") return true;
			return false;
		}
	} catch {}

	// 2. Fallback to CLI only if SQLite check failed to run
	if (!sqliteChecked) {
		try {
			const { stdout } = await execAsync(`engram cloud status --project "${project}"`, { timeout: 2500 });
			const match = stdout.match(/Project enrollment:\s*(.*)/i);
			const line = match ? match[1].trim().toLowerCase() : "";
			return line.startsWith("enrolled") && !line.startsWith("not enrolled");
		} catch {
			return false;
		}
	}
	return false;
}

/**
 * Enrolls a project for Engram Cloud replication.
 */
export async function enrollProject(project: string): Promise<{ success: boolean; message: string }> {
	try {
		const { stdout, stderr } = await execAsync(`engram cloud enroll "${project}"`, { timeout: 5000 });
		const output = `${stdout}\n${stderr}`.trim();
		const success = output.includes("enrolled") || output.includes("✓");
		return { success, message: output };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/**
 * Unenrolls a project from Engram Cloud replication.
 */
export async function unenrollProject(project: string): Promise<{ success: boolean; message: string }> {
	try {
		const { stdout, stderr } = await execAsync(`engram cloud unenroll "${project}"`, { timeout: 5000 });
		const output = `${stdout}\n${stderr}`.trim();
		const success = output.includes("unenrolled") || output.includes("✓");
		return { success, message: output };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/**
 * Opens the Engram dashboard in the user's default browser.
 */
export async function openEngramDashboard(url?: string, project?: string): Promise<boolean> {
	const target = url || resolveDashboardUrl(loadEngramCloudConfig(), project);
	try {
		const isMac = process.platform === "darwin";
		const isWin = process.platform === "win32";
		const opener = isMac ? "open" : isWin ? "start" : "xdg-open";
		exec(`${opener} "${target}"`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Triggers cloud replication for a project in background.
 */
export async function syncProjectCloud(project: string): Promise<{ success: boolean; message: string }> {
	try {
		const { stdout, stderr } = await execAsync(`engram sync --cloud --project "${project}"`, { timeout: 15000 });
		const output = `${stdout}\n${stderr}`.trim();
		const success = !output.includes("failed") && !output.includes("error");
		return { success, message: output };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/**
 * Formats ISO date string into human-friendly relative time (e.g. "hace 5s", "hace 2m").
 */
export function formatRelativeTime(dateInput: Date | string | null | undefined, now = new Date()): string {
	if (!dateInput) return "nunca";
	const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
	const diffMs = Math.max(0, now.getTime() - d.getTime());
	const sec = Math.floor(diffMs / 1000);
	if (sec < 10) return "recién";
	if (sec < 60) return `hace ${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `hace ${min}m`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return `hace ${hours}h`;
	const days = Math.floor(hours / 24);
	return `hace ${days}d`;
}

// Global cached snapshot
let cachedSnapshot: EngramSnapshot | null = null;
let snapshotPromise: Promise<EngramSnapshot> | null = null;
let isEngramRefreshing = false;
const CACHE_TTL_MS = 10000;

export function resetEngramCache(): void {
	cachedSnapshot = null;
	snapshotPromise = null;
	isEngramRefreshing = false;
}

export async function getEngramSnapshot(cwd?: string, force = false): Promise<EngramSnapshot> {
	const now = Date.now();
	if (!force && cachedSnapshot && now - cachedSnapshot.lastCheck < CACHE_TTL_MS) {
		return cachedSnapshot;
	}

	if (snapshotPromise && !force) {
		return snapshotPromise;
	}

	const project = detectProjectName(cwd);
	snapshotPromise = (async () => {
		const cloudConfig = loadEngramCloudConfig();
		const [health, stats, sync, isEnrolled] = await Promise.all([
			fetchEngramHealth(),
			fetchEngramStats(project),
			fetchEngramSyncStatus(project),
			checkProjectEnrolled(project),
		]);

		const snapshot: EngramSnapshot = {
			project,
			health,
			stats,
			sync,
			isEnrolled,
			cloudConfig,
			lastCheck: Date.now(),
		};
		cachedSnapshot = snapshot;
		snapshotPromise = null;
		return snapshot;
	})();

	return snapshotPromise;
}

export function triggerEngramRefresh(cwd?: string, tui?: TUI, ttlMs = CACHE_TTL_MS): void {
	const now = Date.now();
	if (cachedSnapshot && now - cachedSnapshot.lastCheck < ttlMs) {
		return;
	}
	if (isEngramRefreshing) {
		return;
	}
	isEngramRefreshing = true;
	getEngramSnapshot(cwd, true)
		.then(() => {
			tui?.requestRender();
		})
		.catch(() => {})
		.finally(() => {
			isEngramRefreshing = false;
		});
}

interface ActionTarget {
	lineIndex: number;
	action: () => void | Promise<void>;
}

/**
 * CinlodevEngramCard: Interactive TUI sidebar card showing local Engram daemon health,
 * observations count, and Cloud sync status with direct click-to-open dashboard
 * and enroll/unenroll actions.
 */
export class CinlodevEngramCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private expanded = true;
	private clickTargets: ActionTarget[] = [];
	private statusNotice: string | null = null;
	private statusNoticeTimer: any = null;
	private confirmingAction: "enroll" | "unenroll" | null = null;
	private confirmTimer: any = null;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	invalidate(): void {
		resetEngramCache();
		this.tui.requestRender();
	}

	toggleExpanded(): boolean {
		this.expanded = !this.expanded;
		this.resetConfirmation();
		this.tui.requestRender();
		return this.expanded;
	}

	private setConfirmTimer(durationMs = 6000): void {
		if (this.confirmTimer) clearTimeout(this.confirmTimer);
		this.confirmTimer = setTimeout(() => {
			if (this.confirmingAction) {
				this.confirmingAction = null;
				this.tui.requestRender();
			}
		}, durationMs);
		this.confirmTimer?.unref?.();
	}

	private resetConfirmation(): void {
		if (this.confirmTimer) {
			clearTimeout(this.confirmTimer);
			this.confirmTimer = null;
		}
		this.confirmingAction = null;
	}

	handleClick(lineIndex?: number): boolean {
		if (lineIndex === undefined) return false;

		// 1. Header click (line 0) toggles expand/collapse
		if (lineIndex === 0) {
			this.resetConfirmation();
			this.toggleExpanded();
			return true;
		}

		// 2. Action targets
		const target = this.clickTargets.find((t) => t.lineIndex === lineIndex);
		if (target) {
			Promise.resolve(target.action()).catch(() => {});
			return true;
		}

		// Click outside target cancels confirmation if active
		if (this.confirmingAction) {
			this.resetConfirmation();
			this.tui.requestRender();
			return true;
		}

		return false;
	}

	private setFlashNotice(msg: string, durationMs = 4000): void {
		this.statusNotice = msg;
		if (this.statusNoticeTimer) clearTimeout(this.statusNoticeTimer);
		this.statusNoticeTimer = setTimeout(() => {
			this.statusNotice = null;
			this.tui.requestRender();
		}, durationMs);
		this.statusNoticeTimer?.unref?.();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const cwd = this.ctx.cwd ?? process.cwd();
		triggerEngramRefresh(cwd, this.tui);

		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const palette = cutePalette(this.theme);

		const c = {
			...palette,
			mint: (s: string) => (theme ? safeFg(theme, "success", s, "green") : s),
			coral: (s: string) => (theme ? safeFg(theme, "error", s, "red") : s),
			cyan: (s: string) => (theme ? safeFg(theme, "write", s, "cyan") : s),
			yellow: (s: string) => (theme ? safeFg(theme, "warning", s, "yellow") : s),
			pink: (s: string) => palette.pinkAccent(s),
			dim: (s: string) => palette.dim(s),
			muted: (s: string) => palette.muted(s),
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

		this.clickTargets = [];
		const snapshot = cachedSnapshot;
		const projectName = snapshot?.project ?? detectProjectName(cwd);

		// Header title
		const arrow = this.expanded ? "▲" : "▼";
		const headerLeft = `🧠 ${c.pink("Engram:")} ${c.cyan(projectName)}`;
		const headerRight = `${c.dim(arrow)}`;
		const headerTitle = `${headerLeft} ${headerRight}`;
		const headerLen = calcVisibleWidth(headerTitle);
		const fillTop = Math.max(0, safeWidth - 5 - headerLen);
		const top = `${frame(`${g.tl}${g.h} `)}${headerTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		if (!this.expanded) {
			// Compact 1-line collapsed view
			const obsCount = snapshot?.stats?.totalObservations ?? 0;
			const isOnline = snapshot?.health?.healthy;
			const statusDot = isOnline ? c.mint("●") : c.coral("○");
			const enrolledBadge = snapshot?.isEnrolled ? c.mint("cloud✓") : c.dim("local");
			const summary = `${statusDot} ${obsCount} obs · ${enrolledBadge}`;
			return [top, boxLine(summary), bottom];
		}

		const lines: string[] = [top];

		// If transient notice message is present
		if (this.statusNotice) {
			lines.push(boxLine(c.yellow(`⚡ ${this.statusNotice}`)));
		}

		// Section 1: Local Daemon
		const isHealthy = snapshot?.health?.healthy ?? false;
		const localStatusDot = isHealthy ? c.mint("● Online") : c.coral("○ Caído");
		const obsCount = snapshot?.stats?.totalObservations ?? 0;
		const obsText = `${obsCount} obs`;
		lines.push(boxLine(`🖥️ ${c.text("Local (7437)")}`, `${localStatusDot} · ${c.cyan(obsText)}`));

		// Section 2: Divider
		lines.push(frame(`${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));

		// Section 3: Cloud & Dashboard
		const configuredDashboard = loadCutePaths().engramDashboardUrl;
		const cloudServerUrl = snapshot?.cloudConfig?.serverUrl || configuredDashboard || DEFAULT_ENGRAM_DASHBOARD;
		let serverHost = "local";
		try {
			serverHost = new URL(cloudServerUrl).hostname;
		} catch {}

		const dashboardBtn = c.cyan("dashboard ↗");
		const cloudTitleLeft = `☁️ ${c.text("Cloud:")} ${c.dim(serverHost)}`;

		// Click target for dashboard button (opens project directly if enrolled/available)
		this.clickTargets.push({
			lineIndex: lines.length,
			action: async () => {
				this.resetConfirmation();
				const configuredDashboard = loadCutePaths().engramDashboardUrl;
				const targetUrl = resolveDashboardUrl(snapshot?.cloudConfig, projectName, configuredDashboard);
				const opened = await openEngramDashboard(targetUrl);
				if (opened) {
					this.setFlashNotice(`Abriendo ${projectName} en browser…`);
				} else {
					this.setFlashNotice("Error al abrir navegador.");
				}
			},
		});
		lines.push(boxLine(cloudTitleLeft, dashboardBtn));

		// Cloud status details
		const isEnrolled = snapshot?.isEnrolled ?? false;
		if (isEnrolled) {
			const syncPhase = snapshot?.sync?.phase || "healthy";
			const lastSync = snapshot?.sync?.lastSyncAt;
			const relativeSync = formatRelativeTime(lastSync);
			const syncStatusText =
				syncPhase === "syncing"
					? c.yellow("⟳ Sincronizando…")
					: c.mint(`● Enrolado (${relativeSync})`);

			lines.push(boxLine(`   ${c.dim("Sync:")}`, syncStatusText));

			// Action button 1: Manual sync now
			const syncNowBtn = c.cyan("sincronizar ⟳");
			this.clickTargets.push({
				lineIndex: lines.length,
				action: async () => {
					this.resetConfirmation();
					this.setFlashNotice(`Sincronizando ${projectName}…`);
					const res = await syncProjectCloud(projectName);
					if (res.success) {
						this.setFlashNotice(`✓ ${projectName} sincronizado`);
						resetEngramCache();
						triggerEngramRefresh(cwd, this.tui, 0);
					} else {
						this.setFlashNotice(`⚠ Error al sincronizar: ${res.message.slice(0, 30)}`);
					}
				},
			});
			lines.push(boxLine(`   ${c.dim("Push:")}`, syncNowBtn));

			// Action button 2: Unenroll with confirmation
			const isConfirming = this.confirmingAction === "unenroll";
			const unenrollBtn = isConfirming
				? c.coral("¿Desincronizar? [click = Sí]")
				: c.coral("desincronizar ✕");

			this.clickTargets.push({
				lineIndex: lines.length,
				action: async () => {
					if (!isConfirming) {
						this.confirmingAction = "unenroll";
						this.setConfirmTimer();
						this.tui.requestRender();
						return;
					}

					this.resetConfirmation();
					this.setFlashNotice(`Desincronizando ${projectName}…`);
					const res = await unenrollProject(projectName);
					if (res.success) {
						this.setFlashNotice(`✓ ${projectName} desincronizado`);
						resetEngramCache();
						triggerEngramRefresh(cwd, this.tui, 0);
					} else {
						this.setFlashNotice(`⚠ Error al desincronizar: ${res.message.slice(0, 30)}`);
					}
				},
			});
			lines.push(boxLine(`   ${c.dim("Acción:")}`, unenrollBtn));
		} else {
			lines.push(boxLine(`   ${c.dim("Estado:")}`, c.dim("○ No sincronizado")));

			// Action button: Enroll with confirmation
			const isConfirming = this.confirmingAction === "enroll";
			const enrollBtn = isConfirming
				? c.mint("¿Enrolar repo? [click = Sí]")
				: c.mint("+ enrolar repo");

			this.clickTargets.push({
				lineIndex: lines.length,
				action: async () => {
					if (!isConfirming) {
						this.confirmingAction = "enroll";
						this.setConfirmTimer();
						this.tui.requestRender();
						return;
					}

					this.resetConfirmation();
					this.setFlashNotice(`Enrolando ${projectName} en la nube…`);
					const res = await enrollProject(projectName);
					if (res.success) {
						this.setFlashNotice(`✓ ${projectName} enrolado con éxito!`);
						resetEngramCache();
						triggerEngramRefresh(cwd, this.tui, 0);
					} else {
						this.setFlashNotice(`⚠ Error al enrolar: ${res.message.slice(0, 30)}`);
					}
				},
			});
			lines.push(boxLine(`   ${c.dim("Acción:")}`, enrollBtn));
		}

		lines.push(bottom);
		return lines;
	}
}

/**
 * Sidebar Engram Handoff Snapshot Card for pi-cinlodev-cute.
 * Displays the latest session summary and active context directly below Engram in the MEM tab.
 */
export class CinlodevEngramHandoffCard implements Component {
	private readonly ctx?: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private cachedHandoff: EngramHandoffRecord | null = null;
	private lastFetch = 0;
	private fetching = false;

	constructor(ctx?: ExtensionContext, tui?: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui ?? ({ requestRender: () => {} } as any);
		this.theme = theme;
	}

	invalidate(): void {
		this.lastFetch = 0;
		this.cachedHandoff = null;
	}

	handleClick(): boolean {
		this.invalidate();
		this.tui.requestRender();
		return true;
	}

	private triggerRefresh(project: string): void {
		const now = Date.now();
		if (this.fetching || now - this.lastFetch < 15000) return;
		this.fetching = true;
		fetchLatestHandoff(project)
			.then((record) => {
				this.cachedHandoff = record;
				this.lastFetch = Date.now();
				this.fetching = false;
				this.tui.requestRender();
			})
			.catch(() => {
				this.fetching = false;
				this.lastFetch = Date.now();
			});
	}

	render(width: number): string[] {
		const cwd = this.ctx?.cwd ?? process.cwd();
		const projectName = detectProjectName(cwd);
		this.triggerRefresh(projectName);

		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4;
		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const c = {
			pink: (s: string): string => (theme ? safeFg(theme, "accent", s, "pink") : s),
			gold: (s: string): string => (theme ? safeFg(theme, "heading", s, "yellow") : s),
			cyan: (s: string): string => (theme ? safeFg(theme, "write", s, "cyan") : s),
			celeste: (s: string): string => (theme ? safeFg(theme, "write", s, "cyan") : s),
			mint: (s: string): string => (theme ? safeFg(theme, "mint", s, "green") : s),
			text: (s: string): string => (theme ? safeFg(theme, "text", s) : s),
			dim: (s: string): string => (theme ? safeFg(theme, "dim", s) : s),
			muted: (s: string): string => (theme ? safeFg(theme, "muted", s) : s),
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

		const titleStr = `${c.pink("🧠")} ${c.gold("Active Handoff")}`;
		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(titleStr) > maxTitleLen ? truncateAnsiAware(titleStr, maxTitleLen) : titleStr;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		if (!this.cachedHandoff) {
			return [
				top,
				boxLine(c.dim("Sin resumen de sesión previo")),
				boxLine(c.dim("(Se registrará con /handoff)")),
				bottom,
			];
		}

		const h = this.cachedHandoff;
		const relativeDate = h.date ? formatRelativeTime(h.date) : "reciente";
		const lines: string[] = [top];
		lines.push(boxLine(`${c.cyan(`#${h.id || "?"}`)} ${c.gold(h.type || "session_summary")}`, c.muted(relativeDate)));
		lines.push(frame(`${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));

		// Breathing line after divider
		lines.push(boxLine(""));

		const colorizeText = (str: string): string => {
			return str
				.replace(/(PR\s*#\d+)/gi, (m) => c.gold(m))
				.replace(/\b(develop|main|master)\b/g, (m) => c.mint(m))
				.replace(/(->|➔)/g, () => c.pink("➔"));
		};

		const rawLines = h.rawLines && h.rawLines.length > 0 ? h.rawLines : [(h.content || h.title || "").trim()];

		for (const raw of rawLines) {
			if (!raw) continue;
			const trimmed = raw.trim();

			// 1. Bullet item
			if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
				const itemText = trimmed.replace(/^[-*•]\s*/, "");
				const maxItemLen = Math.max(0, innerWidth - 5);
				const truncated = truncateAnsiAware(itemText, maxItemLen);
				const styled = colorizeText(truncated);
				lines.push(boxLine(`  ${c.pink("•")} ${c.celeste(styled)}`));
				continue;
			}

			// 2. Section header (e.g. "Features delivered:" or "Goal:")
			if (trimmed.endsWith(":") || trimmed.startsWith("#")) {
				const cleanHdr = trimmed.replace(/^#+\s*/, "");
				lines.push(boxLine(`${c.pink("✦")} ${c.gold(cleanHdr)}`));
				continue;
			}

			// 3. Regular prose / summary headline with wrapping and Dracula highlights
			const words = trimmed.split(/\s+/);
			let cur = "";
			for (const w of words) {
				if ((cur + " " + w).trim().length > innerWidth - 2) {
					lines.push(boxLine(c.celeste(colorizeText(cur.trim()))));
					cur = w;
				} else {
					cur = (cur + " " + w).trim();
				}
			}
			if (cur) {
				lines.push(boxLine(c.celeste(colorizeText(cur.trim()))));
			}
		}

		// Breathing line before bottom
		lines.push(boxLine(""));
		lines.push(bottom);
		return lines;
	}
}
