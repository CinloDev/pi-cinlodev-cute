import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TUI } from "@earendil-works/pi-tui";

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

export interface EngramHandoffRecord {
	id?: string;
	type?: string;
	title?: string;
	content?: string;
	rawLines?: string[];
	date?: string;
	project?: string;
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
export const CACHE_TTL_MS = 10000;

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
