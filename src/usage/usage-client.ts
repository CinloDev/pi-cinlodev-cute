import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCutePaths, readActiveProfile } from "../cute-paths.ts";
import {
	type QuotaAccountDisplay,
	type QuotaPoolDisplay,
	prioritizeActiveAccount,
} from "./usage-thresholds.ts";

export function resolveManagementKey(): string {
	const fromEnv = (process.env.CLIPROXYAPI_MANAGEMENT_KEY || "").trim();
	if (fromEnv) return fromEnv;

	try {
		const authPath = join(homedir(), ".pi", "agent", "auth.json");
		if (existsSync(authPath)) {
			const raw = readFileSync(authPath, "utf8");
			const parsed = JSON.parse(raw);
			const cred = parsed?.["cliproxyapi"] || parsed?.["cpamc"] || parsed?.["cli-proxy-api"];
			const key = cred?.managementKey || cred?.key;
			if (typeof key === "string" && key.trim()) {
				return key.trim();
			}
		}
	} catch {}

	const cutePaths = loadCutePaths();
	const configuredPaths = Array.isArray(cutePaths.secretsPaths) ? cutePaths.secretsPaths : [];

	const candidateSecretsPaths: string[] = [];
	if (process.env.CLIPROXYAPI_SECRETS_PATH) {
		candidateSecretsPaths.push(process.env.CLIPROXYAPI_SECRETS_PATH);
	}
	for (const p of configuredPaths) {
		if (p.startsWith("~/")) {
			candidateSecretsPaths.push(join(homedir(), p.slice(2)));
		} else {
			candidateSecretsPaths.push(p);
		}
	}

	for (const secretPath of candidateSecretsPaths) {
		try {
			if (existsSync(secretPath)) {
				const content = readFileSync(secretPath, "utf8");
				const match = content.match(/Management\s*key:\s*([^\r\n]+)/i);
				if (match?.[1]?.trim()) {
					return match[1].trim();
				}
			}
		} catch {}
	}

	return "";
}

export function resolveBaseUrl(): string {
	const raw = (process.env.CLIPROXYAPI_BASE_URL || "http://127.0.0.1:8317").trim();
	return raw.replace(/\/+$/, "");
}

/**
 * Detects the active prefix configured for the current orchestrator session or profile.
 */
export function resolveActiveOrchestratorPrefix(ctx?: ExtensionContext): string | undefined {
	const cwd = ctx?.cwd ?? process.cwd();

	// 1. Check if model ID carries prefix: e.g. "cpamc/<account>/<model>"
	try {
		const modelId = (ctx?.model as any)?.id || "";
		const modelMatch = String(modelId).match(/^cpamc\/([^/]+)\//i);
		if (modelMatch?.[1]) {
			return modelMatch[1].trim();
		}
	} catch {}

	// 2. Check active SDD profile definition
	try {
		const profileName = readActiveProfile(cwd);
		if (profileName) {
			const candidateFiles = [
				join(cwd, ".pi", "profiles", `${profileName}.json`),
				join(homedir(), ".pi", "agent", "profiles", `${profileName}.json`),
			];
			for (const file of candidateFiles) {
				if (existsSync(file)) {
					const parsed = JSON.parse(readFileSync(file, "utf8"));
					const defModel = String(parsed?.default_model || "");
					const m = defModel.match(/^cpamc\/([^/]+)\//i);
					if (m?.[1]) {
						return m[1].trim();
					}
				}
			}
			return profileName;
		}
	} catch {}

	return undefined;
}

let cachedAccounts: QuotaAccountDisplay[] | null = null;
let lastFetchTime = 0;
let isFetching = false;
let lastError: string | null = null;

export function resetUsageCache(): void {
	cachedAccounts = null;
	lastFetchTime = 0;
	isFetching = false;
	lastError = null;
}

export function getCachedAccounts(): QuotaAccountDisplay[] | null {
	return cachedAccounts;
}

export function getUsageLastError(): string | null {
	return lastError;
}

export function setCachedAccountsForTesting(accounts: QuotaAccountDisplay[] | null): void {
	cachedAccounts = accounts;
}

/**
 * Downloads all auth files to extract configured account prefixes from CPAM.
 */
export async function fetchPrefixMap(baseUrl: string, key: string, signal?: AbortSignal): Promise<Map<string, string>> {
	const prefixMap = new Map<string, string>();
	try {
		const res = await fetch(`${baseUrl}/v0/management/auth-files`, {
			headers: { Authorization: `Bearer ${key}` },
			signal: signal ?? AbortSignal.timeout(4000),
		});
		if (!res.ok) return prefixMap;

		const data = (await res.json()) as any;
		const files = Array.isArray(data?.files) ? data.files : [];

		await Promise.allSettled(
			files.map(async (f: any) => {
				try {
					const dl = await fetch(`${baseUrl}/v0/management/auth-files/download?name=${encodeURIComponent(f.name)}`, {
						headers: { Authorization: `Bearer ${key}` },
						signal: signal ?? AbortSignal.timeout(3000),
					});
					if (dl.ok) {
						const c = (await dl.json()) as any;
						const pfx = (c?.prefix || "").trim();
						const email = (c?.email || f?.email || f?.name || "").trim();
						const provider = String(f?.provider || f?.type || "").trim().toLowerCase();
						if (pfx) {
							if (provider && email) {
								prefixMap.set(`${provider}:${email}`, pfx);
							}
							if (provider && f?.name) {
								prefixMap.set(`${provider}:${f.name}`, pfx);
							}
							if (email) {
								prefixMap.set(email, pfx);
							}
							if (f?.name) {
								prefixMap.set(f.name, pfx);
							}
						}
					}
				} catch {}
			}),
		);
	} catch {}

	return prefixMap;
}

/**
 * Parses raw CLIProxyAPI provider groups into QuotaAccountDisplay records.
 */
export function parseRawUsageToAccounts(groups: any[], prefixMap?: Map<string, string>): QuotaAccountDisplay[] {
	const accounts: QuotaAccountDisplay[] = [];
	if (!Array.isArray(groups)) return accounts;

	for (const group of groups) {
		const provider = String(group?.provider || "unknown").toLowerCase();
		const rawAccounts = Array.isArray(group?.accounts) ? group.accounts : [];

		for (const acc of rawAccounts) {
			const email = String(acc?.account || acc?.id || "");
			const accId = String(acc?.id || "");
			const rawPrefix =
				prefixMap?.get(`${provider}:${email}`) ||
				prefixMap?.get(`${provider}:${accId}`) ||
				prefixMap?.get(email) ||
				prefixMap?.get(accId) ||
				"";
			// If no prefix configured, fallback to username without @domain
			const prefix = rawPrefix || (email.includes("@") ? email.split("@")[0] : email);

			const rawPools = Array.isArray(acc?.pools) ? acc.pools : [];
			const pools: QuotaPoolDisplay[] = [];

			for (const p of rawPools) {
				const label = String(p?.displayName || p?.label || "Quota");
				const availablePercent =
					typeof p?.availablePercentage === "number"
						? Math.max(0, Math.min(100, p.availablePercentage))
						: 100;
				const used = typeof p?.used === "number" ? p.used : 0;
				const total = typeof p?.total === "number" ? p.total : null;
				const unlimited = Boolean(p?.unlimited);
				const resetAt = typeof p?.resetAt === "string" ? p.resetAt : null;

				pools.push({
					label,
					availablePercent,
					used,
					total,
					unlimited,
					resetAt,
				});
			}

			if (pools.length > 0) {
				accounts.push({
					provider,
					prefix,
					pools,
				});
			}
		}
	}

	return accounts;
}

/**
 * Fetches all accounts and their pools with real prefixes from CLIProxyAPI.
 */
export async function fetchUsageAccounts(signal?: AbortSignal): Promise<QuotaAccountDisplay[]> {
	const baseUrl = resolveBaseUrl();
	const key = resolveManagementKey();
	if (!key) {
		throw new Error("CLIProxyAPI Management Key no encontrada");
	}

	// 1. Fetch prefix map in background
	const prefixMapPromise = fetchPrefixMap(baseUrl, key, signal);

	// 2. Fetch usage data from cpamc-usage module or direct API
	let rawGroups: any[] = [];
	try {
		const cpamcPath = join(homedir(), ".pi", "agent", "extensions", "cpamc-usage", "src", "api.ts");
		if (existsSync(cpamcPath)) {
			const mod = await import(cpamcPath);
			if (typeof mod.fetchUsage === "function") {
				rawGroups = await mod.fetchUsage(signal);
			}
		}
	} catch {}

	if (!rawGroups.length) {
		const res = await fetch(`${baseUrl}/v0/management/auth-files`, {
			headers: { Authorization: `Bearer ${key}` },
			signal: signal ?? AbortSignal.timeout(5000),
		});
		if (res.ok) {
			const data = (await res.json()) as any;
			const files = Array.isArray(data?.files) ? data.files : [];
			for (const f of files) {
				if (f?.disabled || f?.unavailable) continue;
				const provider = f?.provider || "unknown";
				const pools: any[] = [];
				if (f?.quota?.signals) {
					for (const [k, v] of Object.entries(f.quota.signals)) {
						const pct = parseFloat(String(v));
						if (!isNaN(pct)) {
							pools.push({
								label: k,
								availablePercentage: pct,
								unlimited: false,
								used: 100 - pct,
								total: 100,
								resetAt: null,
							});
						}
					}
				}
				let g = rawGroups.find((x) => x.provider === provider);
				if (!g) {
					g = { provider, accounts: [] };
					rawGroups.push(g);
				}
				g.accounts.push({ account: f?.email || f?.account || f?.name || "account", pools });
			}
		}
	}

	const prefixMap = await prefixMapPromise;
	return parseRawUsageToAccounts(rawGroups, prefixMap);
}

/**
 * Triggers background refresh if cache is older than TTL.
 */
export function triggerUsageRefresh(ctx?: ExtensionContext, tui?: TUI, ttlMs = 15000): void {
	const now = Date.now();
	if (isFetching || (cachedAccounts && now - lastFetchTime < ttlMs)) {
		return;
	}

	isFetching = true;
	fetchUsageAccounts()
		.then((accounts) => {
			const activePrefix = resolveActiveOrchestratorPrefix(ctx);
			cachedAccounts = prioritizeActiveAccount(accounts, activePrefix);
			lastFetchTime = Date.now();
			lastError = null;
			isFetching = false;
			tui?.requestRender();
		})
		.catch((err) => {
			lastError = err instanceof Error ? err.message : String(err);
			lastFetchTime = Date.now();
			isFetching = false;
			tui?.requestRender();
		});
}
