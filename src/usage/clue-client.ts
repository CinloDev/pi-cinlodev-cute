import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClueUsageModelStat {
	model: string;
	requests: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number;
	actualCost: number;
}

export interface ClueUsageData {
	balance: number;
	remaining: number;
	currency: string;
	isValid: boolean;
	planName: string;
	todayRequests: number;
	todayTokens: number;
	todayCost: number;
	topModels: ClueUsageModelStat[];
}

/**
 * Safely parses the clue API key from config.yaml without third-party dependencies.
 */
function extractClueApiKeyFromConfig(content: string): string {
	// Look for clue provider under openai-compatibility
	const lines = content.split(/\r?\n/);
	let inOpenAiCompat = false;
	let inClue = false;
	let inApiKeys = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;

		if (/^openai-compatibility\s*:/i.test(line)) {
			inOpenAiCompat = true;
			continue;
		}

		if (inOpenAiCompat) {
			// If we hit another top-level section, exit
			if (/^[a-zA-Z0-9_-]+\s*:/i.test(line) && !line.startsWith(" ")) {
				break;
			}

			if (/-\s*name\s*:\s*["']?clue["']?/i.test(line)) {
				inClue = true;
				continue;
			}

			if (inClue) {
				// Next provider starts
				if (/-\s*name\s*:/i.test(line) && !/clue/i.test(line)) {
					break;
				}

				if (/api-key-entries\s*:/i.test(line)) {
					inApiKeys = true;
					continue;
				}

				if (inApiKeys) {
					const match = line.match(/api-key\s*:\s*["']?([^"'\s]+)["']?/i);
					if (match?.[1]?.trim()) {
						return match[1].trim();
					}
				}
			}
		}
	}

	return "";
}

/**
 * Safely resolves the API key without exposing it to the UI or hardcoding it.
 */
export function resolveClueApiKey(): string {
	const fromEnv = (process.env.CLUE_API_KEY || process.env.MWAPI_API_KEY || "").trim();
	if (fromEnv) return fromEnv;

	const candidateConfigPaths = [
		join(homedir(), "Projects", "CLIProxyAPI", "config.yaml"),
		join(homedir(), "CLIProxyAPI", "config.yaml"),
	];

	for (const configPath of candidateConfigPaths) {
		try {
			if (existsSync(configPath)) {
				const content = readFileSync(configPath, "utf8");
				const key = extractClueApiKeyFromConfig(content);
				if (key) return key;
			}
		} catch {}
	}

	return "";
}

export function resolveClueBaseUrl(): string {
	const raw = (process.env.CLUE_BASE_URL || process.env.MWAPI_BASE_URL || "https://api.mwapi.dev/v1").trim();
	return raw.replace(/\/+$/, "");
}

let cachedClueUsage: ClueUsageData | null = null;
let lastFetchTime = 0;
let isFetching = false;
let lastError: string | null = null;

export function resetClueUsageCache(): void {
	cachedClueUsage = null;
	lastFetchTime = 0;
	isFetching = false;
	lastError = null;
}

export function getCachedClueUsage(): ClueUsageData | null {
	return cachedClueUsage;
}

export function getClueUsageLastError(): string | null {
	return lastError;
}

export function setCachedClueUsageForTesting(data: ClueUsageData | null): void {
	cachedClueUsage = data;
}

export function parseRawClueUsage(raw: any): ClueUsageData {
	const balance = typeof raw?.balance === "number" ? raw.balance : (typeof raw?.remaining === "number" ? raw.remaining : 0);
	const remaining = typeof raw?.remaining === "number" ? raw.remaining : balance;
	const currency = typeof raw?.unit === "string" ? raw.unit : "USD";
	const isValid = Boolean(raw?.isValid ?? true);
	const planName = typeof raw?.planName === "string" ? raw.planName : "Saldo";

	const todayUsage = raw?.usage?.today || {};
	const todayRequests = Number(todayUsage?.requests) || 0;
	const todayTokens = Number(todayUsage?.total_tokens) || 0;
	const todayCost = Number(todayUsage?.actual_cost ?? todayUsage?.cost) || 0;

	const rawStats = Array.isArray(raw?.model_stats) ? raw.model_stats : [];
	const topModels: ClueUsageModelStat[] = rawStats
		.map((m: any) => ({
			model: String(m?.model || ""),
			requests: Number(m?.requests) || 0,
			inputTokens: Number(m?.input_tokens) || 0,
			outputTokens: Number(m?.output_tokens) || 0,
			totalTokens: Number(m?.total_tokens) || 0,
			cost: Number(m?.cost) || 0,
			actualCost: Number(m?.actual_cost) || 0,
		}))
		.filter((m: ClueUsageModelStat) => m.model.length > 0 && m.requests > 0)
		.sort((a: ClueUsageModelStat, b: ClueUsageModelStat) => b.requests - a.requests)
		.slice(0, 3);

	return {
		balance,
		remaining,
		currency,
		isValid,
		planName,
		todayRequests,
		todayTokens,
		todayCost,
		topModels,
	};
}

export async function fetchClueUsage(signal?: AbortSignal): Promise<ClueUsageData | null> {
	const apiKey = resolveClueApiKey();
	if (!apiKey) {
		lastError = "API key no configurada";
		return null;
	}

	const baseUrl = resolveClueBaseUrl();
	const res = await fetch(`${baseUrl}/usage`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		signal: signal ?? AbortSignal.timeout(6000),
	});

	if (!res.ok) {
		lastError = `HTTP ${res.status}`;
		return null;
	}

	const json = await res.json();
	const data = parseRawClueUsage(json);
	lastError = null;
	return data;
}

export function triggerClueUsageRefresh(minIntervalMs = 30000, force = false, onUpdated?: () => void): void {
	const now = Date.now();
	if (!force && now - lastFetchTime < minIntervalMs) return;
	if (isFetching) return;

	isFetching = true;
	fetchClueUsage()
		.then((data) => {
			if (data) {
				cachedClueUsage = data;
				lastFetchTime = Date.now();
				onUpdated?.();
			}
		})
		.catch((err: any) => {
			lastError = err?.message || "Error al conectar con MWAPI";
		})
		.finally(() => {
			isFetching = false;
		});
}
