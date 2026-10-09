import * as cp from "node:child_process";
import { readGitBranch } from "../cute-paths.ts";

export interface GitStatusCounts {
	staged: number;
	modified: number;
	untracked: number;
	conflicts: number;
	linesAdded: number;
	linesDeleted: number;
	isClean: boolean;
}

export function parseGitNumstat(output: string): { linesAdded: number; linesDeleted: number } {
	let linesAdded = 0;
	let linesDeleted = 0;
	const lines = output
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.trim().length > 0);

	for (const line of lines) {
		const parts = line.split("\t");
		if (parts.length >= 2) {
			const a = parseInt(parts[0], 10);
			const d = parseInt(parts[1], 10);
			if (!isNaN(a)) linesAdded += a;
			if (!isNaN(d)) linesDeleted += d;
		}
	}
	return { linesAdded, linesDeleted };
}

export function parseGitStatusPorcelain(output: string): Omit<GitStatusCounts, "linesAdded" | "linesDeleted"> {
	let staged = 0;
	let modified = 0;
	let untracked = 0;
	let conflicts = 0;

	const lines = output
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((l) => l.length >= 2);

	for (const line of lines) {
		const x = line[0];
		const y = line[1];

		if (x === "?" && y === "?") {
			untracked++;
			continue;
		}
		if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
			conflicts++;
			continue;
		}
		if (x !== " " && x !== "?") {
			staged++;
		}
		if (y !== " " && y !== "?") {
			modified++;
		}
	}

	const isClean = staged === 0 && modified === 0 && untracked === 0 && conflicts === 0;
	return { staged, modified, untracked, conflicts, isClean };
}

export interface GitStatusCache {
	counts: GitStatusCounts;
	readAt: number;
	cwd: string;
}

let cachedStatus: GitStatusCache | undefined;

export function fetchGitStatus(cwd: string, ttlMs = 4000): GitStatusCounts {
	const now = Date.now();
	if (cachedStatus && cachedStatus.cwd === cwd && now - cachedStatus.readAt < ttlMs) {
		return cachedStatus.counts;
	}

	try {
		const output = cp.execFileSync("git", ["status", "--porcelain=v1"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1500,
		});

		let linesAdded = 0;
		let linesDeleted = 0;
		try {
			const numstatOut = cp.execFileSync("git", ["diff", "HEAD", "--numstat"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1500,
			});
			const numstat = parseGitNumstat(numstatOut);
			linesAdded = numstat.linesAdded;
			linesDeleted = numstat.linesDeleted;
		} catch {}

		const counts: GitStatusCounts = {
			...parseGitStatusPorcelain(output),
			linesAdded,
			linesDeleted,
		};
		cachedStatus = { counts, readAt: now, cwd };
		return counts;
	} catch {
		const fallback: GitStatusCounts = {
			staged: 0,
			modified: 0,
			untracked: 0,
			conflicts: 0,
			linesAdded: 0,
			linesDeleted: 0,
			isClean: true,
		};
		cachedStatus = { counts: fallback, readAt: now, cwd };
		return fallback;
	}
}

export function resetGitStatusCache(): void {
	cachedStatus = undefined;
}

export interface GitFileChange {
	path: string;
	status: "modified" | "added" | "deleted" | "untracked" | "conflict";
	statusCode: string;
	linesAdded: number;
	linesDeleted: number;
}

export interface GitFileChangesCache {
	files: GitFileChange[];
	readAt: number;
	cwd: string;
}

let cachedFileChanges: GitFileChangesCache | undefined;

export function resetGitFileChangesCache(): void {
	cachedFileChanges = undefined;
}

export function fetchGitFileChanges(cwd: string, ttlMs = 2000): GitFileChange[] {
	const now = Date.now();
	if (cachedFileChanges && cachedFileChanges.cwd === cwd && now - cachedFileChanges.readAt < ttlMs) {
		return cachedFileChanges.files;
	}

	try {
		const statusOut = cp.execFileSync("git", ["status", "--porcelain=v1"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1500,
		});

		const numstatMap = new Map<string, { added: number; deleted: number }>();
		try {
			const numstatOut = cp.execFileSync("git", ["diff", "HEAD", "--numstat"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1500,
			});
			for (const line of numstatOut.split("\n")) {
				const parts = line.trim().split("\t");
				if (parts.length >= 3) {
					const a = parseInt(parts[0], 10) || 0;
					const d = parseInt(parts[1], 10) || 0;
					const filePath = parts.slice(2).join("\t").trim();
					numstatMap.set(filePath, { added: a, deleted: d });
				}
			}
		} catch {}

		const files: GitFileChange[] = [];
		for (const line of statusOut.split("\n")) {
			if (line.length < 3) continue;
			const statusCode = line.slice(0, 2);
			const filePath = line.slice(3).trim();
			const x = statusCode[0];
			const y = statusCode[1];

			let status: GitFileChange["status"] = "modified";
			if (x === "?" && y === "?") status = "untracked";
			else if (x === "A" || y === "A") status = "added";
			else if (x === "D" || y === "D") status = "deleted";
			else if (x === "U" || y === "U") status = "conflict";

			const num = numstatMap.get(filePath) || { added: 0, deleted: 0 };
			files.push({
				path: filePath,
				statusCode: statusCode.trim(),
				status,
				linesAdded: num.added,
				linesDeleted: num.deleted,
			});
		}
		cachedFileChanges = { files, readAt: now, cwd };
		return files;
	} catch {
		cachedFileChanges = { files: [], readAt: now, cwd };
		return [];
	}
}

export interface GitGraphCache {
	rawLines: string[];
	readAt: number;
	cwd: string;
}

let cachedGraph: GitGraphCache | undefined;

export function fetchGitLogGraph(cwd: string, maxCommits = 20, ttlMs = 4000): string[] {
	const now = Date.now();
	if (cachedGraph && cachedGraph.cwd === cwd && now - cachedGraph.readAt < ttlMs) {
		return cachedGraph.rawLines;
	}

	try {
		const output = cp.execFileSync(
			"git",
			["log", "--graph", "--oneline", "--decorate", "-n", String(maxCommits)],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2000,
			},
		);

		const rawLines = output
			.replace(/\r\n/g, "\n")
			.split("\n")
			.filter((l) => l.trim().length > 0);

		cachedGraph = { rawLines, readAt: now, cwd };
		return rawLines;
	} catch {
		cachedGraph = { rawLines: [], readAt: now, cwd };
		return [];
	}
}

export function resetGitGraphCache(): void {
	cachedGraph = undefined;
}

export function shortenRelativeTime(rel: string): string {
	return rel
		.replace(/ minutes? ago/, "m")
		.replace(/ hours? ago/, "h")
		.replace(/ days? ago/, "d")
		.replace(/ weeks? ago/, "w")
		.replace(/ months? ago/, "mo")
		.replace(/ seconds? ago/, "s");
}

export interface GitBranchItem {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
	tracking?: string;
	ahead?: number;
	behind?: number;
	gone?: boolean;
	relativeDate?: string;
}

interface GitBranchesCache {
	branches: GitBranchItem[];
	readAt: number;
	cwd: string;
}

let cachedBranches: GitBranchesCache | undefined;

export function fetchGitBranches(cwd: string, ttlMs = 3000): GitBranchItem[] {
	const now = Date.now();
	if (cachedBranches && cachedBranches.cwd === cwd && now - cachedBranches.readAt < ttlMs) {
		return cachedBranches.branches;
	}

	try {
		const out = cp.execFileSync(
			"git",
			[
				"for-each-ref",
				"--sort=-committerdate",
				"--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:relative)",
				"refs/heads/",
				"refs/remotes/",
			],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2000,
			},
		);

		const currentBranch = readGitBranch(cwd);
		const localBranches: GitBranchItem[] = [];
		const remoteOnlyBranches: GitBranchItem[] = [];
		const localNames = new Set<string>();

		const lines = out.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
		for (const line of lines) {
			const parts = line.split("\t");
			if (parts.length < 2) continue;
			const fullRef = parts[0].trim();
			const shortRef = parts[1].trim();
			if (!shortRef || shortRef === "origin" || fullRef.endsWith("/HEAD") || shortRef.endsWith("/HEAD")) continue;

			const tracking = parts[2]?.trim() || undefined;
			const track = parts[3]?.trim() || "";
			const relDate = parts[4]?.trim() || "";

			let ahead: number | undefined;
			let behind: number | undefined;
			const aheadM = /ahead (\d+)/.exec(track);
			if (aheadM) ahead = parseInt(aheadM[1], 10);
			const behindM = /behind (\d+)/.exec(track);
			if (behindM) behind = parseInt(behindM[1], 10);
			const gone = track.includes("gone");

			const isRemote = fullRef.startsWith("refs/remotes/");
			if (!isRemote) {
				localNames.add(shortRef);
				localBranches.push({
					name: shortRef,
					isCurrent: shortRef === currentBranch,
					isRemote: false,
					tracking,
					ahead,
					behind,
					gone,
					relativeDate: shortenRelativeTime(relDate),
				});
			} else {
				const remoteShort = shortRef.replace(/^origin\//, "");
				if (!localNames.has(remoteShort) && !localNames.has(shortRef)) {
					remoteOnlyBranches.push({
						name: shortRef,
						isCurrent: false,
						isRemote: true,
						relativeDate: shortenRelativeTime(relDate),
					});
				}
			}
		}

		localBranches.sort((a, b) => {
			if (a.isCurrent) return -1;
			if (b.isCurrent) return 1;
			return 0;
		});

		const result = [...localBranches, ...remoteOnlyBranches];
		cachedBranches = { branches: result, readAt: now, cwd };
		return result;
	} catch {
		const fallback: GitBranchItem[] = [{ name: readGitBranch(cwd), isCurrent: true, isRemote: false }];
		cachedBranches = { branches: fallback, readAt: now, cwd };
		return fallback;
	}
}

export function resetGitBranchesCache(): void {
	cachedBranches = undefined;
}

/**
 * Returns a concise sync badge for the current Git branch (e.g. "▲1", "▼2", "▲1▼2" or "").
 * Uses cached branch information with 3-second TTL for zero render overhead.
 */
export function getGitSyncBadge(cwd: string = process.cwd()): string {
	try {
		const branches = fetchGitBranches(cwd);
		const current = branches.find((b) => b.isCurrent);
		if (!current) return "";
		const parts: string[] = [];
		if (typeof current.ahead === "number" && current.ahead > 0) {
			parts.push(`▲${current.ahead}`);
		}
		if (typeof current.behind === "number" && current.behind > 0) {
			parts.push(`▼${current.behind}`);
		}
		return parts.join("");
	} catch {
		return "";
	}
}

export interface BranchDiffFile {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "unknown";
	statusCode: string;
	linesAdded: number;
	linesDeleted: number;
}

export interface BranchDiffSummary {
	branch: string;
	baseBranch: string;
	files: BranchDiffFile[];
	totalAdded: number;
	totalDeleted: number;
}

interface BranchDiffCache {
	summary: BranchDiffSummary;
	readAt: number;
	key: string;
}

let cachedBranchDiff: BranchDiffCache | undefined;

export function fetchBranchDiff(cwd: string, targetBranch: string, ttlMs = 3000): BranchDiffSummary {
	const current = readGitBranch(cwd);
	const key = `${cwd}::${current}::${targetBranch}`;
	const now = Date.now();
	if (cachedBranchDiff && cachedBranchDiff.key === key && now - cachedBranchDiff.readAt < ttlMs) {
		return cachedBranchDiff.summary;
	}

	try {
		let numstatOut = "";
		let isDirectDiff = false;
		try {
			numstatOut = cp.execFileSync("git", ["diff", `HEAD...${targetBranch}`, "--numstat"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 2500,
			});
		} catch {}

		if (!numstatOut.trim()) {
			try {
				numstatOut = cp.execFileSync("git", ["diff", "HEAD", targetBranch, "--numstat"], {
					cwd,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
					timeout: 2500,
				});
				isDirectDiff = true;
			} catch {}
		}

		let nameStatusOut = "";
		try {
			nameStatusOut = cp.execFileSync(
				"git",
				isDirectDiff ? ["diff", "HEAD", targetBranch, "--name-status"] : ["diff", `HEAD...${targetBranch}`, "--name-status"],
				{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2500 },
			);
		} catch {}

		const statusMap = new Map<string, string>();
		for (const line of nameStatusOut.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parts = trimmed.split(/\s+/);
			if (parts.length >= 2) {
				const code = parts[0];
				const filePath = parts.slice(1).join(" ");
				statusMap.set(filePath, code);
			}
		}

		let totalAdded = 0;
		let totalDeleted = 0;
		const files: BranchDiffFile[] = [];

		for (const line of numstatOut.split("\n")) {
			const parts = line.trim().split("\t");
			if (parts.length >= 3) {
				const a = parseInt(parts[0], 10) || 0;
				const d = parseInt(parts[1], 10) || 0;
				const filePath = parts.slice(2).join("\t").trim();
				totalAdded += a;
				totalDeleted += d;
				const code = statusMap.get(filePath) || "M";
				let status: BranchDiffFile["status"] = "modified";
				if (code.startsWith("A")) status = "added";
				else if (code.startsWith("D")) status = "deleted";
				else if (code.startsWith("R")) status = "renamed";

				files.push({
					path: filePath,
					status,
					statusCode: code,
					linesAdded: a,
					linesDeleted: d,
				});
			}
		}

		const summary: BranchDiffSummary = {
			branch: targetBranch,
			baseBranch: current,
			files,
			totalAdded,
			totalDeleted,
		};
		cachedBranchDiff = { summary, readAt: now, key };
		return summary;
	} catch {
		const fallback: BranchDiffSummary = {
			branch: targetBranch,
			baseBranch: current,
			files: [],
			totalAdded: 0,
			totalDeleted: 0,
		};
		cachedBranchDiff = { summary: fallback, readAt: now, key };
		return fallback;
	}
}

export function resetBranchDiffCache(): void {
	cachedBranchDiff = undefined;
}
