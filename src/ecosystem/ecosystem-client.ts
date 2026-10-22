import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface EcosystemToolInfo {
	id: string;
	name: string;
	version: string;
	available: boolean;
	accent: "cyan" | "mint" | "pink" | "purple" | "gold";
}

export interface EcosystemData {
	tools: EcosystemToolInfo[];
	detectedAt: number;
}

/**
 * Strips tool names, extra prefixes or git commits to isolate the clean version string.
 * e.g. "engram 3.4.0 (commit ...)" -> "3.4.0"
 * e.g. "gentle-ai 4.1.1" -> "4.1.1"
 * e.g. "v1.3.0\n" -> "1.3.0"
 */
export function cleanVersionString(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	// Look for standard semver pattern like 1.2.3 or 1.2.3-beta
	const match = trimmed.match(/\b(\d+\.\d+\.\d+(?:-[a-zA-Z0-9_.]+)?)\b/);
	if (match) {
		return match[1];
	}
	// Fallback to first token without trailing symbols
	const firstLine = trimmed.split("\n")[0].trim();
	const tokens = firstLine.split(/\s+/);
	const lastToken = tokens[tokens.length - 1];
	return lastToken.replace(/^v/i, "");
}

/**
 * Safely executes a binary to query its version with an explicit timeout.
 */
function queryToolVersion(binary: string, args: string[] = ["--version"]): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			execFile(binary, args, { timeout: 1500, encoding: "utf8" }, (error, stdout) => {
				if (error || !stdout) {
					resolve(null);
					return;
				}
				const clean = cleanVersionString(stdout);
				resolve(clean || null);
			});
		} catch {
			resolve(null);
		}
	});
}

/**
 * Reads local package.json version of CUTE extension.
 */
export function resolveCutePackageVersion(): string {
	try {
		const pkgPath = join(import.meta.dirname ?? process.cwd(), "..", "..", "package.json");
		if (existsSync(pkgPath)) {
			const content = JSON.parse(readFileSync(pkgPath, "utf8"));
			if (typeof content.version === "string") return content.version;
		}
	} catch {}
	return "1.0.0";
}

/**
 * Resolves gentle-shell package version from installed user paths.
 */
export function resolveGentleShellPackageVersion(): string | null {
	const candidates = [
		join(homedir(), ".pi", "agent", "git", "github.com", "Gentleman-Programming", "gentle-shell", "package.json"),
		join(homedir(), ".gentle-shell", "agent", "package.json"),
		join(homedir(), "Projects", "experiments", "gentle-shell", "package.json"),
		join(homedir(), ".pi", "agent", "npm", "node_modules", "gentle-shell", "package.json"),
		join(homedir(), ".pi", "agent", "npm", "node_modules", "gentle-pi", "package.json"),
	];
	for (const candidate of candidates) {
		try {
			if (existsSync(candidate)) {
				const content = JSON.parse(readFileSync(candidate, "utf8"));
				if (typeof content.version === "string") {
					const clean = cleanVersionString(content.version);
					if (clean) return clean;
				}
			}
		} catch {}
	}
	return null;
}

let cachedEcosystem: EcosystemData | null = null;
let isDetecting = false;

export function getCachedEcosystem(): EcosystemData | null {
	return cachedEcosystem;
}

export function resetEcosystemCache(): void {
	cachedEcosystem = null;
	isDetecting = false;
}

export function setCachedEcosystemForTesting(data: EcosystemData | null): void {
	cachedEcosystem = data;
}

/**
 * Asynchronously checks installed versions for all ecosystem tools.
 */
export async function detectEcosystemTools(): Promise<EcosystemData> {
	const [piVer, gentleAiVer, gentleShellCliVer, engramVer, herdrVer] = await Promise.all([
		queryToolVersion("pi", ["--version"]),
		queryToolVersion("gentle-ai", ["--version"]),
		queryToolVersion("gentle-shell", ["--version"]),
		queryToolVersion("engram", ["version"]).then((v) => v ?? queryToolVersion("engram", ["--version"])),
		queryToolVersion("herdr", ["--version"]),
	]);

	const gentleShellVer = gentleShellCliVer || resolveGentleShellPackageVersion();
	const cuteVer = resolveCutePackageVersion();

	const tools: EcosystemToolInfo[] = [
		{
			id: "pi",
			name: "pi",
			version: piVer || "1.3.0",
			available: Boolean(piVer || process.env.PI_VERSION),
			accent: "cyan",
		},
		{
			id: "cute",
			name: "cute",
			version: cuteVer,
			available: true,
			accent: "pink",
		},
		{
			id: "gentle-shell",
			name: "gentle-shell",
			version: gentleShellVer || "-",
			available: Boolean(gentleShellVer),
			accent: "gold",
		},
		{
			id: "gentle-ai",
			name: "gentle-ai",
			version: gentleAiVer || "-",
			available: Boolean(gentleAiVer),
			accent: "mint",
		},
		{
			id: "engram",
			name: "engram",
			version: engramVer || "-",
			available: Boolean(engramVer),
			accent: "purple",
		},
		{
			id: "herdr",
			name: "herdr",
			version: herdrVer || "-",
			available: Boolean(herdrVer),
			accent: "cyan",
		},
	];

	const data: EcosystemData = {
		tools,
		detectedAt: Date.now(),
	};

	cachedEcosystem = data;
	return data;
}

/**
 * Triggers background detection without blocking TUI renders.
 */
export function triggerEcosystemDetection(onUpdated?: () => void): void {
	if (cachedEcosystem || isDetecting) return;
	isDetecting = true;
	detectEcosystemTools()
		.then(() => {
			onUpdated?.();
		})
		.catch(() => {})
		.finally(() => {
			isDetecting = false;
		});
}
