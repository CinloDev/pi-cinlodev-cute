import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tunable Cinlodev CUTE filesystem paths. Visual and behavior defaults are
 * identical to the literals previously hardcoded in src/welcome.ts,
 * src/footer.ts, src/hud.ts and index.ts, so the default visual stays
 * unchanged — except devBinaryHygiene, which defaults to false so this
 * theme never deletes the foreign gentle-ai dev-binary file unless
 * explicitly opted in via config/CinlodevCute.paths.json.
 */
export interface CutePaths {
	/**
	 * Agent dir, home-relative with a leading ~ (default "~/.pi/agent",
	 * resolved via os.homedir()). Absolute paths are used as-is.
	 */
	agentDir: string;
	/** Profile marker relative to agentDir (was "profiles/.active"). */
	profileActive: string;
	/** Context filenames probed in cwd (was AGENTS.md, AGENTS.override.md, CLAUDE.md, SPEC.md). */
	contextFiles: string[];
	/** Alias used when shortening cwd under home (was "~"). */
	homeAlias: string;
	/** Label when no git HEAD is readable (was "no git" in welcome/hud). */
	gitNoLabel: string;
	/**
	 * Session message details key holding todo mirrors (was "gentleTodo").
	 * Reserved for the todos.ts follow-up slice; exposed here so the shape
	 * stays shared.
	 */
	todoSource: string;
	/**
	 * Opt-in hygiene for the foreign gentle-ai dev-binary override file.
	 * Default false: index.ts must not delete files it does not own.
	 */
	devBinaryHygiene: boolean;
}

export const CUTE_PATHS_FILENAME = "CinlodevCute.paths.json";

const DEFAULTS: CutePaths = {
	agentDir: "~/.pi/agent",
	profileActive: "profiles/.active",
	contextFiles: ["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "SPEC.md"],
	homeAlias: "~",
	gitNoLabel: "no git",
	todoSource: "gentleTodo",
	devBinaryHygiene: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(source: unknown, fallback: string): string {
	return typeof source === "string" && source.length > 0 ? source : fallback;
}

function pickBoolean(source: unknown, fallback: boolean): boolean {
	return typeof source === "boolean" ? source : fallback;
}

function pickStringArray(source: unknown, fallback: string[]): string[] {
	if (!Array.isArray(source)) return [...fallback];
	const next = source.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	return next.length > 0 ? next : [...fallback];
}

/** Merge a parsed JSON value over the defaults; unknown keys are ignored. */
function mergePaths(raw: unknown, baseSource: CutePaths = DEFAULTS): CutePaths {
	const base: CutePaths = { ...baseSource, contextFiles: [...baseSource.contextFiles] };
	if (!isRecord(raw)) return base;
	base.agentDir = pickString(raw.agentDir, base.agentDir);
	base.profileActive = pickString(raw.profileActive, base.profileActive);
	base.contextFiles = pickStringArray(raw.contextFiles, base.contextFiles);
	base.homeAlias = pickString(raw.homeAlias, base.homeAlias);
	base.gitNoLabel = pickString(raw.gitNoLabel, base.gitNoLabel);
	base.todoSource = pickString(raw.todoSource, base.todoSource);
	base.devBinaryHygiene = pickBoolean(raw.devBinaryHygiene, base.devBinaryHygiene);
	return base;
}

// Tunables live in config/, NOT in themes/: Pi treats every *.json under
// themes/ as a theme file and rejects ours. Legacy themes/ fallback kept.
// User overrides in ~/.pi/agent/cute.json or ~/.pi/agent/cute/CinlodevCute.paths.json
// layer on top of package defaults and persist across package updates.
function candidatePathsFiles(): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();

	const add = (filePath: string) => {
		const resolved = path.resolve(filePath);
		if (!seen.has(resolved)) {
			seen.add(resolved);
			candidates.push(resolved);
		}
	};

	// 1. Package defaults (repo clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
		add(path.join(packageDir, "config", CUTE_PATHS_FILENAME));
		add(path.join(packageDir, "themes", CUTE_PATHS_FILENAME));
	} catch {}

	// 2. User-level global overrides (~/.pi/agent, outside git, persistent across package updates)
	try {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		add(path.join(agentDir, "cute.json"));
		add(path.join(agentDir, "cinlodev-cute.json"));
		add(path.join(agentDir, "cute", CUTE_PATHS_FILENAME));
		add(path.join(agentDir, "cute", "paths.json"));
		add(path.join(agentDir, "cinlodev-cute", CUTE_PATHS_FILENAME));
		add(path.join(agentDir, "cinlodev-cute", "paths.json"));
	} catch {}

	// 3. Workspace / Project-level overrides (cwd, only when outside package clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
		const cwd = path.resolve(process.cwd());
		if (cwd !== packageDir) {
			add(path.join(cwd, ".pi", "cute.json"));
			add(path.join(cwd, ".pi", "cinlodev-cute.json"));
			add(path.join(cwd, "config", CUTE_PATHS_FILENAME));
		}
	} catch {}

	return candidates;
}

let cached: CutePaths | null = null;

/**
 * Load tunable paths, cached in memory. Falls back to the compiled
 * defaults when the JSON file is missing or unparsable, so widgets keep
 * rendering with the current behavior instead of throwing.
 *
 * Layers package defaults, user-level overrides (~/.pi/agent), and project overrides.
 */
export function loadCutePaths(): CutePaths {
	if (cached) return cached;
	let current: CutePaths = mergePaths(undefined, DEFAULTS);
	for (const file of candidatePathsFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!isRecord(parsed)) continue;
			const data = "paths" in parsed ? parsed.paths : parsed;
			current = mergePaths(data, current);
		} catch {}
	}
	cached = current;
	return cached;
}

/** Clear the in-memory cache (tests and follow-up slices). */
export function resetCutePathsCache(): void {
	cached = null;
}

/** Resolve the agent dir, expanding a leading ~ via os.homedir(). */
export function resolveAgentDir(paths: CutePaths = loadCutePaths()): string {
	const raw = paths.agentDir.trim() || DEFAULTS.agentDir;
	if (raw === "~") return os.homedir();
	if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
	if (path.isAbsolute(raw)) return raw;
	return path.join(os.homedir(), raw);
}

/** Resolve the active-profile marker file inside the agent dir. */
export function resolveProfileActivePath(paths: CutePaths = loadCutePaths()): string {
	return path.join(resolveAgentDir(paths), paths.profileActive);
}

/**
 * Foreign gentle-ai dev-binary override file. Centralized here so index.ts
 * consumes it via the loader; removal stays opt-in via devBinaryHygiene.
 */
export function resolveDevBinaryPath(): string {
	return path.join(os.homedir(), ".pi", "gentle-ai", "dev-binary.json");
}

/** Read the active profile marker; undefined when missing or unreadable. */
export function readActiveProfile(paths: CutePaths = loadCutePaths()): string | undefined {
	try {
		const activePath = resolveProfileActivePath(paths);
		if (fs.existsSync(activePath)) {
			return fs.readFileSync(activePath, "utf-8").trim() || undefined;
		}
	} catch {}
	return undefined;
}

/** Read the git branch from .git/HEAD without spawning git; falls back to gitNoLabel. */
export function readGitBranch(cwd: string, paths: CutePaths = loadCutePaths()): string {
	try {
		const gitHeadPath = path.join(cwd, ".git", "HEAD");
		if (fs.existsSync(gitHeadPath)) {
			const headContent = fs.readFileSync(gitHeadPath, "utf8").trim();
			if (headContent.startsWith("ref: refs/heads/")) {
				return headContent.replace("ref: refs/heads/", "");
			}
			return headContent.slice(0, 7);
		}
	} catch {}
	return paths.gitNoLabel;
}

/**
 * Escape a cwd for embedding inside a double-quoted `git -C "..."` shell
 * fragment. Quoting shape is unchanged; paths with quotes, dollars or
 * backticks no longer break out of the argument.
 */
export function quoteGitCwd(cwd: string): string {
	const escaped = cwd
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\$/g, "\\$")
		.replace(/`/g, "\\`");
	return `"${escaped}"`;
}

/** Shorten a cwd under home with the configured alias (default "~"). */
export function formatCwd(cwd: string, homeAlias: string = loadCutePaths().homeAlias): string {
	try {
		const homedir = os.homedir();
		if (cwd === homedir) return homeAlias;
		if (cwd.startsWith(homedir + "/")) {
			return homeAlias + cwd.slice(homedir.length);
		}
	} catch {}
	return cwd;
}

/** Details key holding todo mirrors; reserved for the todos.ts follow-up slice. */
export function todoSourceKey(paths: CutePaths = loadCutePaths()): string {
	return paths.todoSource;
}
