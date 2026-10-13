import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const execAsync = promisify(exec);

export const DEFAULT_PERSISTENT_MEMORY_URL = "http://127.0.0.1:7474";
export const DEFAULT_PERSISTENT_MEMORY_DB_PATH = path.join(os.homedir(), ".memory", "memories.db");

export interface PersistentMemoryStats {
	available: boolean;
	dbPath: string | null;
	scope: "project" | "global" | "none";
	projectName: string;
	scopeKey: string;
	projectMemoriesCount: number;
	totalMemoriesCount: number;
	entitiesCount: number;
	relationsCount: number;
	indexedCount: number;
	pendingCount: number;
	lastTitle?: string;
	lastTopic?: string;
	lastSnippet?: string;
	serverOnline: boolean;
	lastCheckedAt: number;
}

// Backward-compatibility alias
export type MemoryGraphStats = PersistentMemoryStats;

let cachedStats: { [key: string]: { stats: PersistentMemoryStats; expiresAt: number } } = {};
const CACHE_TTL_MS = 5000;

export function resetPersistentMemoryCache(): void {
	cachedStats = {};
}

// Backward-compatibility alias
export const resetMemoryGraphCache = resetPersistentMemoryCache;

/**
 * Normalizes git remote URL to a clean host/owner/repo format (e.g. github.com/CinloDev/pi-cinlodev-cute)
 */
export function normalizeGitRemoteUrl(rawUrl: string): string | null {
	const url = rawUrl.trim();
	if (!url || url.startsWith("/") || url.startsWith("./") || url.startsWith("../") || url.startsWith("file://")) {
		return null;
	}

	// 1. SSH scp-like: git@github.com:owner/repo.git
	const scpMatch = url.match(/^([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):(.+)$/);
	if (scpMatch) {
		const host = scpMatch[2].toLowerCase();
		const repo = scpMatch[3].replace(/^\/+/, "").replace(/\.git$/, "");
		return repo ? `${host}/${repo}` : null;
	}

	// 2. SSH URL: ssh://git@host/owner/repo.git
	const sshMatch = url.match(/^ssh:\/\/([^@]+@)?([^\/:]+)(?::\d+)?\/(.+)$/);
	if (sshMatch) {
		const host = sshMatch[2].toLowerCase();
		const rawRepo = sshMatch[3] || "";
		const repo = rawRepo.replace(/^\/+/, "").replace(/\.git$/, "");
		return repo ? `${host}/${repo}` : null;
	}

	// 3. HTTPS: https://host/owner/repo.git
	if (url.startsWith("https://")) {
		try {
			const u = new URL(url);
			const host = u.hostname.toLowerCase();
			const repo = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
			return repo ? `${host}/${repo}` : null;
		} catch {
			return null;
		}
	}

	return null;
}

/**
 * Resolves the scope key and display project name for the given workspace directory.
 */
export function resolvePersistentMemoryScope(cwd?: string): { scopeKey: string; projectName: string; isGlobal: boolean } {
	const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();
	const home = path.resolve(os.homedir());

	if (resolvedCwd === home) {
		return { scopeKey: '["global"]', projectName: "Global", isGlobal: true };
	}

	// 1. Check .pi/memory.json
	const configPath = path.join(resolvedCwd, ".pi", "memory.json");
	if (fs.existsSync(configPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
			if (typeof parsed?.project_name === "string" && parsed.project_name.trim().length > 0) {
				const name = parsed.project_name.trim();
				return { scopeKey: JSON.stringify(["project", name]), projectName: name, isGlobal: false };
			}
		} catch {}
	}

	// 2. Check git remotes
	try {
		const raw = execSync("git remote -v", {
			cwd: resolvedCwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1000,
		});
		const lines = raw.split("\n").filter((l) => l.trim().length > 0);
		for (const line of lines) {
			const match = line.match(/^[^\s]+\s+([^\s]+)\s+\((fetch|push)\)$/);
			if (match) {
				const normalized = normalizeGitRemoteUrl(match[1]);
				if (normalized) {
					return {
						scopeKey: JSON.stringify(["project", normalized]),
						projectName: normalized,
						isGlobal: false,
					};
				}
			}
		}
	} catch {}

	// 3. Fallback to folder basename
	const baseName = path.basename(resolvedCwd) || "workspace";
	return {
		scopeKey: JSON.stringify(["project", baseName]),
		projectName: baseName,
		isGlobal: false,
	};
}

/**
 * Resolves candidate SQLite DB path for pi-persistent-memory.
 */
export function resolvePersistentMemoryDbCandidate(
	cwd?: string,
	allowGlobal = true,
): { path: string; scope: "project" | "global" } | null {
	const projectCwd = cwd ? path.resolve(cwd) : process.cwd();

	// 1. Explicit env override
	if (process.env.PI_MEMORY_DB_PATH && fs.existsSync(process.env.PI_MEMORY_DB_PATH)) {
		return { path: path.resolve(process.env.PI_MEMORY_DB_PATH), scope: "project" };
	}

	// 2. Project-level: .pi/memory.db or memory.db
	const projectPiDb = path.join(projectCwd, ".pi", "memory.db");
	if (fs.existsSync(projectPiDb)) {
		return { path: projectPiDb, scope: "project" };
	}

	const projectRootDb = path.join(projectCwd, "memory.db");
	if (fs.existsSync(projectRootDb)) {
		return { path: projectRootDb, scope: "project" };
	}

	// 3. Canonical pi-persistent-memory database at ~/.memory/memories.db (global fallback)
	if (allowGlobal && fs.existsSync(DEFAULT_PERSISTENT_MEMORY_DB_PATH)) {
		return { path: DEFAULT_PERSISTENT_MEMORY_DB_PATH, scope: "project" };
	}

	return null;
}

// Backward-compatibility alias
export const resolveMemoryGraphDbCandidate = resolvePersistentMemoryDbCandidate;

/**
 * Checks if the Web UI server on port 7474 is responsive.
 */
export async function checkPersistentMemoryServerHealth(url = DEFAULT_PERSISTENT_MEMORY_URL): Promise<boolean> {
	try {
		const res = await fetch(`${url}/api/health`, {
			method: "GET",
			signal: AbortSignal.timeout(600),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Opens the memory graph/explorer UI in the default browser.
 */
export async function openPersistentMemoryExplorer(url = DEFAULT_PERSISTENT_MEMORY_URL): Promise<boolean> {
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

// Backward-compatibility alias
export const openMemoryGraphExplorer = openPersistentMemoryExplorer;

/**
 * Synthesizes and extracts key takeaways or technical progress from current session branch.
 */
export function extractSessionTakeaways(ctx?: ExtensionContext | any): string | null {
	if (!ctx?.sessionManager) return null;
	const branch = ctx.sessionManager.getBranch?.() ?? [];
	if (!Array.isArray(branch) || branch.length === 0) return null;

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

			const clean = text
				.replace(/```[\s\S]*?```/g, "")
				.replace(/[#*`_]/g, "")
				.replace(/\s+/g, " ")
				.trim();

			if (clean.length >= 25) {
				return clean.length > 1500 ? clean.slice(0, 1490) + "…" : clean;
			}
		}
	}

	return null;
}

/**
 * Helper to safely open a database with node:sqlite DatabaseSync.
 */
function openSqliteDb(dbPath: string, readOnly = true): DatabaseSync | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { DatabaseSync } = require("node:sqlite");
		const db = new DatabaseSync(dbPath, { readOnly });
		db.exec("PRAGMA busy_timeout = 2000;");
		return db;
	} catch {
		return null;
	}
}

/**
 * Ultralight, non-blocking inspector for pi-persistent-memory SQLite database.
 */
export async function queryPersistentMemoryStats(cwd?: string, customDbPath?: string): Promise<PersistentMemoryStats> {
	const resolvedCandidate = customDbPath
		? { path: customDbPath, scope: "project" as const }
		: resolvePersistentMemoryDbCandidate(cwd);

	const scopeInfo = resolvePersistentMemoryScope(cwd);

	if (!resolvedCandidate || !fs.existsSync(resolvedCandidate.path)) {
		return {
			available: false,
			dbPath: null,
			scope: "none",
			projectName: scopeInfo.projectName,
			scopeKey: scopeInfo.scopeKey,
			projectMemoriesCount: 0,
			totalMemoriesCount: 0,
			entitiesCount: 0,
			relationsCount: 0,
			indexedCount: 0,
			pendingCount: 0,
			serverOnline: false,
			lastCheckedAt: Date.now(),
		};
	}

	const dbPath = resolvedCandidate.path;
	let serverOnline = false;

	// Check web UI in parallel without blocking DB read
	checkPersistentMemoryServerHealth().then((ok) => {
		serverOnline = ok;
	}).catch(() => {});

	// 1. Try native node:sqlite DatabaseSync first (fastest, zero child process)
	const db = openSqliteDb(dbPath, true);
	if (db) {
		try {
			const projectMemoriesRow = db.prepare(
				"SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND scope_key = ?;"
			).get(scopeInfo.scopeKey) as { count?: number } | undefined;

			const totalMemoriesRow = db.prepare(
				"SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL;"
			).get() as { count?: number } | undefined;

			const entitiesRow = db.prepare(
				"SELECT COUNT(*) as count FROM entities;"
			).get() as { count?: number } | undefined;

			const relationsRow = db.prepare(
				"SELECT COUNT(*) as count FROM relations;"
			).get() as { count?: number } | undefined;

			const indexedRow = db.prepare(
				"SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND indexing_status = 'indexed';"
			).get() as { count?: number } | undefined;

			const pendingRow = db.prepare(
				"SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND indexing_status = 'pending';"
			).get() as { count?: number } | undefined;

			const latestRow = db.prepare(`
				SELECT title, topic_key, substr(content, 1, 60) as snippet
				FROM memories
				WHERE deleted_at IS NULL
				ORDER BY id DESC
				LIMIT 1;
			`).get() as { title?: string; topic_key?: string; snippet?: string } | undefined;

			db.close();

			return {
				available: true,
				dbPath,
				scope: resolvedCandidate.scope,
				projectName: scopeInfo.projectName,
				scopeKey: scopeInfo.scopeKey,
				projectMemoriesCount: Number(projectMemoriesRow?.count ?? 0),
				totalMemoriesCount: Number(totalMemoriesRow?.count ?? 0),
				entitiesCount: Number(entitiesRow?.count ?? 0),
				relationsCount: Number(relationsRow?.count ?? 0),
				indexedCount: Number(indexedRow?.count ?? 0),
				pendingCount: Number(pendingRow?.count ?? 0),
				lastTitle: latestRow?.title || undefined,
				lastTopic: latestRow?.topic_key || undefined,
				lastSnippet: latestRow?.snippet ? latestRow.snippet.replace(/\s+/g, " ") : undefined,
				serverOnline,
				lastCheckedAt: Date.now(),
			};
		} catch {
			try { db.close(); } catch {}
		}
	}

	// 2. Fallback to sqlite3 CLI if node:sqlite failed or schema differed
	try {
		const query = `
			SELECT
				(SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND scope_key = '${scopeInfo.scopeKey.replace(/'/g, "''")}'),
				(SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL),
				(SELECT COUNT(*) FROM entities),
				(SELECT COUNT(*) FROM relations),
				(SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND indexing_status = 'indexed'),
				(SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND indexing_status = 'pending'),
				(SELECT title FROM memories WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1),
				(SELECT topic_key FROM memories WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1),
				(SELECT substr(content, 1, 60) FROM memories WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1);
		`;

		const { stdout } = await execAsync(
			`sqlite3 "${dbPath}" "${query.replace(/\n\s*/g, " ").trim()}"`,
			{ timeout: 1500 }
		);

		const parts = stdout.trim().split("|");
		const projectMemoriesCount = parseInt(parts[0], 10) || 0;
		const totalMemoriesCount = parseInt(parts[1], 10) || 0;
		const entitiesCount = parseInt(parts[2], 10) || 0;
		const relationsCount = parseInt(parts[3], 10) || 0;
		const indexedCount = parseInt(parts[4], 10) || 0;
		const pendingCount = parseInt(parts[5], 10) || 0;
		const lastTitle = parts[6] ? parts[6].trim() : undefined;
		const lastTopic = parts[7] ? parts[7].trim() : undefined;
		const lastSnippet = parts[8] ? parts[8].trim().replace(/\s+/g, " ") : undefined;

		return {
			available: true,
			dbPath,
			scope: resolvedCandidate.scope,
			projectName: scopeInfo.projectName,
			scopeKey: scopeInfo.scopeKey,
			projectMemoriesCount,
			totalMemoriesCount,
			entitiesCount,
			relationsCount,
			indexedCount,
			pendingCount,
			lastTitle,
			lastTopic,
			lastSnippet,
			serverOnline,
			lastCheckedAt: Date.now(),
		};
	} catch {
		return {
			available: true,
			dbPath,
			scope: resolvedCandidate.scope,
			projectName: scopeInfo.projectName,
			scopeKey: scopeInfo.scopeKey,
			projectMemoriesCount: 0,
			totalMemoriesCount: 0,
			entitiesCount: 0,
			relationsCount: 0,
			indexedCount: 0,
			pendingCount: 0,
			serverOnline: false,
			lastCheckedAt: Date.now(),
		};
	}
}

// Backward-compatibility alias
export const queryMemoryGraphStats = queryPersistentMemoryStats;

export interface RetainMemoryOptions {
	cwd?: string;
	customDbPath?: string;
	title?: string;
	topicKey?: string;
	sessionId?: string;
	type?: "decision" | "lesson" | "convention" | "session_summary" | "note";
}

/**
 * Saves a durable memory record into the local pi-persistent-memory SQLite database.
 */
export async function retainPersistentMemory(
	content: string,
	options?: RetainMemoryOptions
): Promise<boolean> {
	if (!content || content.trim().length < 5) return false;

	const cwd = options?.cwd;
	const resolved = options?.customDbPath
		? { path: options.customDbPath, scope: "project" as const }
		: resolvePersistentMemoryDbCandidate(cwd);

	const targetPath = resolved?.path || DEFAULT_PERSISTENT_MEMORY_DB_PATH;
	const parentDir = path.dirname(targetPath);
	if (!fs.existsSync(parentDir)) {
		try {
			fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
		} catch {}
	}

	const scopeInfo = resolvePersistentMemoryScope(cwd);
	const scopeKey = scopeInfo.scopeKey;
	const cleanContent = content.trim();
	const title = options?.title || `Session Snapshot: ${scopeInfo.projectName}`;
	const topicKey = options?.topicKey || "session.snapshot";
	const memoryType = options?.type || "session_summary";
	const sessionId = options?.sessionId || `cute_session_${Date.now()}`;

	// 1. Try node:sqlite DatabaseSync first
	const db = openSqliteDb(targetPath, false);
	if (db) {
		try {
			db.exec("BEGIN IMMEDIATE;");

			// Ensure session exists
			db.prepare(`
				INSERT INTO sessions (id, scope_key, kind, status, created_at, updated_at)
				VALUES (?, ?, 'normal', 'open', datetime('now'), datetime('now'))
				ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now');
			`).run(sessionId, scopeKey);

			// Insert memory
			const insertRes = db.prepare(`
				INSERT INTO memories (
					scope_key, title, content, type, topic_key, content_version,
					deleted_at, indexing_status, pending_reason, session_id,
					created_at, updated_at
				) VALUES (
					?, ?, ?, ?, ?, 1,
					NULL, 'pending', NULL, ?,
					datetime('now'), datetime('now')
				);
			`).run(scopeKey, title, cleanContent, memoryType, topicKey, sessionId);

			// Populate FTS if table exists
			try {
				db.prepare(`
					INSERT INTO memory_fts (rowid, title, content)
					VALUES (?, ?, ?);
				`).run(Number(insertRes.lastInsertRowid), title, cleanContent);
			} catch {}

			db.exec("COMMIT;");
			db.close();
			resetPersistentMemoryCache();
			return true;
		} catch {
			try { db.exec("ROLLBACK;"); } catch {}
			try { db.close(); } catch {}
		}
	}

	// 2. Fallback to sqlite3 CLI
	try {
		const safeTitle = title.replace(/'/g, "''");
		const safeContent = cleanContent.replace(/'/g, "''");
		const safeTopic = topicKey.replace(/'/g, "''");
		const safeScopeKey = scopeKey.replace(/'/g, "''");
		const safeSessionId = sessionId.replace(/'/g, "''");

		const sql = `
			BEGIN IMMEDIATE;
			INSERT INTO sessions (id, scope_key, kind, status, created_at, updated_at)
			VALUES ('${safeSessionId}', '${safeScopeKey}', 'normal', 'open', datetime('now'), datetime('now'))
			ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now');

			INSERT INTO memories (
				scope_key, title, content, type, topic_key, content_version,
				deleted_at, indexing_status, pending_reason, session_id,
				created_at, updated_at
			) VALUES (
				'${safeScopeKey}', '${safeTitle}', '${safeContent}', '${memoryType}', '${safeTopic}', 1,
				NULL, 'pending', NULL, '${safeSessionId}',
				datetime('now'), datetime('now')
			);

			INSERT INTO memory_fts (rowid, title, content)
			VALUES (last_insert_rowid(), '${safeTitle}', '${safeContent}');
			COMMIT;
		`;

		await execAsync(`sqlite3 "${targetPath}" "${sql.replace(/\n\s*/g, " ").trim()}"`, { timeout: 3000 });
		resetPersistentMemoryCache();
		return true;
	} catch {
		return false;
	}
}

// Backward-compatibility alias
export const retainMemoryRecord = (content: string, cwd?: string, customDbPath?: string) =>
	retainPersistentMemory(content, { cwd, customDbPath });
