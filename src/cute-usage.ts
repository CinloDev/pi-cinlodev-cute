import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cuteGlyphs, cutePalette, safeFg, type CutePalette } from "./cute-theme.ts";
import { loadCuteColors } from "./cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";
import { readActiveProfile } from "./cute-paths.ts";

export interface QuotaPoolDisplay {
	label: string;
	availablePercent: number;
	used: number;
	total: number | null;
	unlimited: boolean;
	resetAt: string | null;
}

export interface QuotaAccountDisplay {
	provider: string;
	prefix: string;
	pools: QuotaPoolDisplay[];
}

export interface QuotaThreshold {
	color: (text: string) => string;
	level: "optimal" | "medium" | "alert" | "critical";
	label: string;
}

/**
 * Returns dynamic semáforo styling and status level based on available quota percent:
 * Evaluates against the rounded percentage (Math.round) in lockstep with visible text:
 * - >= 65%: Mint (Óptimo / Holgado)
 * - 40% - 64%: Gold (Medio / Moderado)
 * - 20% - 39%: Orange (Alerta)
 * - < 20%: Coral (Crítico)
 */
export function getQuotaThreshold(availablePercent: number, palette: CutePalette): QuotaThreshold {
	const rounded = Math.round(availablePercent);
	if (rounded < 20) {
		return { color: palette.coral, level: "critical", label: "Crítico" };
	}
	if (rounded < 40) {
		return { color: palette.orange, level: "alert", label: "Alerta" };
	}
	if (rounded < 65) {
		return { color: palette.gold, level: "medium", label: "Medio" };
	}
	return { color: palette.mint, level: "optimal", label: "Óptimo" };
}

export function cleanPoolLabel(label: string): string {
	return label
		.replace(/·?\s*Weekly Limit Remaining/i, "Weekly")
		.replace(/·?\s*Five Hour Limit Remaining/i, "5h")
		.replace(/Claude and GPT models/i, "Claude/GPT")
		.replace(/Gemini Models/i, "Gemini")
		.replace(/Codex\s*\/\s*Plus\s*5h/i, "5h Window")
		.replace(/OpenCode\s*·\s*/i, "")
		.replace(/\(Primaria\)/i, "")
		.trim();
}

export function formatRelativeReset(resetAt: string | null, now = Date.now()): string {
	if (!resetAt) return "";
	const date = new Date(resetAt);
	const ms = date.getTime() - now;
	if (Number.isNaN(ms)) return "";
	if (ms <= 0) return "reseteando…";

	const totalMins = Math.floor(ms / 60000);
	if (totalMins < 60) return `en ${totalMins}m`;

	const hours = Math.floor(totalMins / 60);
	const mins = totalMins % 60;
	if (hours < 24) return mins > 0 ? `en ${hours}h ${mins}m` : `en ${hours}h`;

	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return remHours > 0 ? `en ${days}d ${remHours}h` : `en ${days}d`;
}

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

	const candidateSecretsPaths = [
		"/mnt/d/orca/CLIProxyAPI/secrets.txt",
		join(homedir(), "CLIProxyAPI", "secrets.txt"),
	];

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

	// 1. Check if model ID carries prefix: e.g. "cpamc/cin82/gemini-3.8-flash-high"
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

/**
 * Reorders accounts so that the active orchestrator account is at index 0.
 */
export function prioritizeActiveAccount(accounts: QuotaAccountDisplay[], activePrefix?: string): QuotaAccountDisplay[] {
	if (!activePrefix || !accounts.length) return accounts;
	const cleanTarget = activePrefix.toLowerCase().trim();
	const idx = accounts.findIndex((a) => {
		const p = a.prefix.toLowerCase();
		return p === cleanTarget || p.includes(cleanTarget) || cleanTarget.includes(p);
	});
	if (idx <= 0) return accounts;

	const prioritized = [...accounts];
	const [active] = prioritized.splice(idx, 1);
	prioritized.unshift(active);
	return prioritized;
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

		const data = await res.json() as any;
		const files = Array.isArray(data?.files) ? data.files : [];

		await Promise.allSettled(
			files.map(async (f: any) => {
				try {
					const dl = await fetch(`${baseUrl}/v0/management/auth-files/download?name=${encodeURIComponent(f.name)}`, {
						headers: { Authorization: `Bearer ${key}` },
						signal: signal ?? AbortSignal.timeout(3000),
					});
					if (dl.ok) {
						const c = await dl.json() as any;
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
			})
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
				const availablePercent = typeof p?.availablePercentage === "number"
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
			const data = await res.json() as any;
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

/**
 * Sidebar Quota / Usage Card for pi-cinlodev-cute.
 * - Non-blocking ambient component.
 * - Toggled via Alt+Q shortcut or /usage-card command.
 * - Focuses on ONE account at a time by its Prefix (no email displayed).
 * - Renders the account's 4 quota bars with Context-style gauges (▰▰▰▱▱).
 * - Clicking the card or scrolling the mouse wheel cycles through accounts.
 */
export class CinlodevUsageCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private visible = false;
	private selectedIndex = 0;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	isVisible(): boolean {
		return this.visible;
	}

	setVisible(visible: boolean): void {
		if (this.visible !== visible) {
			this.visible = visible;
			if (this.visible) {
				triggerUsageRefresh(this.ctx, this.tui, 0); // Force fresh check on open
			}
			this.tui.requestRender();
		}
	}

	toggle(): boolean {
		this.setVisible(!this.visible);
		return this.visible;
	}

	cycleAccount(direction: 1 | -1 = 1): void {
		if (!cachedAccounts || !cachedAccounts.length) return;
		const len = cachedAccounts.length;
		this.selectedIndex = (this.selectedIndex + direction + len) % len;
		this.tui.requestRender();
	}

	handleClick(_localIndex?: number, button?: string): boolean {
		// Right click steps backward, left click advances forward
		const direction = button === "right" ? -1 : 1;
		this.cycleAccount(direction);
		return true;
	}

	handleWheel(wheelDelta: number): boolean {
		if (wheelDelta === 0) return false;
		const direction = wheelDelta > 0 ? 1 : -1;
		this.cycleAccount(direction);
		return true;
	}

	invalidate(): void {
		resetUsageCache();
	}

	render(width: number): string[] {
		// When hidden, take up 0 space in the sidebar rail
		if (!this.visible) return [];

		triggerUsageRefresh(this.ctx, this.tui, 15000);

		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const palette = cutePalette(this.theme);
		const c = {
			...palette,
			pink: (s: string): string => palette.pinkAccent(s),
			warning: (s: string): string => (theme ? safeFg(theme, "warning", s, "yellow") : s),
		};

		// Standard boxLine: strictly guarantees total visible width = safeWidth
		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		// If no cached data yet and fetching
		if (!cachedAccounts) {
			const titleGlyph = g.brand || "✿";
			const titleStr = `${c.pink(titleGlyph)} ${c.gold("Quotas")} ${c.dim("Alt+Q")}`;
			const titleLen = calcVisibleWidth(titleStr);
			const fillTop = Math.max(0, safeWidth - 5 - titleLen);
			const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
			const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

			const lines: string[] = [top];
			if (lastError) {
				lines.push(boxLine(c.coral("⚠ Sin conexión con CLIProxyAPI")));
				lines.push(boxLine(c.dim("Verificá auth.json o puerto 8317")));
			} else {
				lines.push(boxLine(c.dim("Cargando cuotas…")));
			}
			lines.push(bottom);
			return lines;
		}

		if (!cachedAccounts.length) {
			const titleGlyph = g.brand || "✿";
			const titleStr = `${c.pink(titleGlyph)} ${c.gold("Quotas")} ${c.dim("Alt+Q")}`;
			const titleLen = calcVisibleWidth(titleStr);
			const fillTop = Math.max(0, safeWidth - 5 - titleLen);
			const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
			const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

			return [top, boxLine(c.muted("No hay cuentas activas registradas")), bottom];
		}

		// Ensure valid account index
		if (this.selectedIndex >= cachedAccounts.length) {
			this.selectedIndex = 0;
		}

		const currentAccount = cachedAccounts[this.selectedIndex];
		const titleGlyph = g.brand || "✿";

		// Title shows provider and prefix: "✿ antigravity · cin82 ▾ Alt+Q" (NO EMAIL!)
		const titleStr = `${c.pink(titleGlyph)} ${c.gold(currentAccount.provider)} ${c.mint(`· ${currentAccount.prefix}`)} ${c.dim("▾")} ${c.dim("Alt+Q")}`;
		const titleLen = calcVisibleWidth(titleStr);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${titleStr}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const lines: string[] = [top];

		// Render all quota pools of the selected account (typically 4 for Antigravity, 1 for Codex, 3 for OpenCode)
		for (let i = 0; i < currentAccount.pools.length; i++) {
			const p = currentAccount.pools[i];

			// Format color by remaining percentage using 4-tier dynamic semáforo
			const pct = Math.round(p.availablePercent);
			const threshold = getQuotaThreshold(p.availablePercent, c);

			// Clean label for models (e.g. "Gemini 5h", "Claude/GPT Weekly")
			const cleanLabel = cleanPoolLabel(p.label);
			const poolHeaderLeft = `${threshold.color("●")} ${c.text(cleanLabel)}`;

			const resetStr = formatRelativeReset(p.resetAt);
			const pctFormatted = `\x1b[1m${threshold.color(`${pct}%`)}\x1b[22m`;
			const poolHeaderRight = resetStr ? `${pctFormatted} ${c.muted("·")} ${c.dim(resetStr)}` : pctFormatted;

			lines.push(boxLine(poolHeaderLeft, poolHeaderRight));

			// Gauge bar matching Context card style: full-width gaugeFilled and gaugeEmpty
			const cellWidth = Math.max(1, calcVisibleWidth(g.gaugeFilled));
			const barCells = Math.max(4, Math.floor(innerWidth / cellWidth));
			const filledCount = Math.round((pct / 100) * barCells);
			const emptyCount = Math.max(0, barCells - filledCount);
			const barStr = `${threshold.color(g.gaugeFilled.repeat(filledCount))}${c.dim(g.gaugeEmpty.repeat(emptyCount))}`;

			lines.push(boxLine(barStr));
		}

		lines.push(bottom);
		return lines;
	}
}
