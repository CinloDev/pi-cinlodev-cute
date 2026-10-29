import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface PoolAccountTelemetry {
	email: string;
	prefix: string;
	role: "leader" | "reserve" | string;
	window5hPct: number | null;
	weeklyPct: number | null;
	isCooling?: boolean;
	fatiguePct?: number;
}

export interface PoolTelemetryData {
	poolId: string;
	leaderEmail: string;
	totalMembers: number;
	accounts: PoolAccountTelemetry[];
	updatedAt: number;
}

const POOL_CACHE_TTL_MS = 2500;
let cachedPoolData: Map<string, { data: PoolTelemetryData; timestamp: number }> = new Map();
let cachedPrefixMap: Map<string, string> = new Map();
let lastPrefixFetch = 0;
let isFetching = false;

async function ensurePrefixMap(baseUrl: string, mgmtKey: string): Promise<Map<string, string>> {
	const now = Date.now();
	if (cachedPrefixMap.size > 0 && now - lastPrefixFetch < 60000) {
		return cachedPrefixMap;
	}
	try {
		const res = await fetch(`${baseUrl}/v0/management/auth-files`, {
			headers: { Authorization: `Bearer ${mgmtKey}`, Accept: "application/json" },
			signal: AbortSignal.timeout(2000),
		});
		if (!res.ok) return cachedPrefixMap;
		const data = (await res.json()) as any;
		const files = Array.isArray(data?.files) ? data.files : [];
		await Promise.allSettled(
			files.map(async (f: any) => {
				try {
					const dl = await fetch(`${baseUrl}/v0/management/auth-files/download?name=${encodeURIComponent(f.name)}`, {
						headers: { Authorization: `Bearer ${mgmtKey}`, Accept: "application/json" },
						signal: AbortSignal.timeout(1500),
					});
					if (dl.ok) {
						const c = (await dl.json()) as any;
						const pfx = (c?.prefix || "").trim();
						const email = (c?.email || f?.email || "").trim().toLowerCase();
						const name = (f?.name || "").trim().toLowerCase();
						if (pfx) {
							if (email) cachedPrefixMap.set(email, pfx);
							if (name) cachedPrefixMap.set(name, pfx);
						}
					}
				} catch {}
			}),
		);
		lastPrefixFetch = now;
	} catch {}
	return cachedPrefixMap;
}

function resolveManagementKey(): string {
	const candidates = [
		path.join(os.homedir(), "Projects", "CLIProxyAPI", ".cliproxy_mgmt_key"),
		path.join(os.homedir(), ".cliproxy_mgmt_key"),
		"/CLIProxyAPI/.cliproxy_mgmt_key",
	];
	for (const p of candidates) {
		try {
			if (fs.existsSync(p)) {
				const key = fs.readFileSync(p, "utf-8").trim();
				if (key) return key;
			}
		} catch {}
	}
	return process.env.CLIPROXY_MGMT_KEY || "";
}

export async function fetchCpamcPoolTelemetry(poolId: string): Promise<PoolTelemetryData | null> {
	const now = Date.now();
	const cached = cachedPoolData.get(poolId);
	if (cached && now - cached.timestamp < POOL_CACHE_TTL_MS) {
		return cached.data;
	}

	if (isFetching && cached) {
		return cached.data;
	}

	isFetching = true;
	try {
		const mgmtKey = resolveManagementKey();
		const headers: Record<string, string> = {
			Accept: "application/json",
		};
		if (mgmtKey) {
			headers.Authorization = `Bearer ${mgmtKey}`;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 1200);

		const res = await fetch("http://127.0.0.1:8317/v0/management/auto-switcher-pro/manifest", {
			headers,
			signal: controller.signal,
		});
		clearTimeout(timeout);

		if (!res.ok) {
			return cached?.data ?? null;
		}

		const data = (await res.json()) as {
			pools?: Array<{
				id?: string;
				base_prefix?: string;
				active_leader?: string;
				leader_auth?: string;
				members?: string[];
				reserves?: string[];
			}>;
			accounts?: Array<{
				account_key?: string;
				email?: string;
				pool_id?: string;
				role?: string;
				window_5h_pct?: number;
				weekly_pct?: number;
				is_cooling?: boolean;
				fatigue_pct?: number;
			}>;
			telemetry?: Array<{
				account_key?: string;
				window_5h_pct?: number;
				weekly_pct?: number;
			}>;
		};

		const prefixMap = await ensurePrefixMap("http://127.0.0.1:8317", mgmtKey);

		const pools = data.pools || [];
		const accounts = data.accounts || [];
		const telemetry = data.telemetry || [];

		const telemMap = new Map<string, { h5: number; wk: number }>();
		for (const t of telemetry) {
			if (t.account_key) {
				telemMap.set(t.account_key.toLowerCase(), {
					h5: t.window_5h_pct ?? 100,
					wk: t.weekly_pct ?? 100,
				});
			}
		}

		for (const p of pools) {
			const pId = p.id || p.base_prefix || "";
			if (!pId) continue;

			const poolAccs = accounts.filter(
				(a) => (a.pool_id && a.pool_id.toLowerCase() === pId.toLowerCase())
			);

			const leaderAuth = p.active_leader || p.leader_auth || "";
			const leaderEmail = leaderAuth
				.replace(/^antigravity-/, "")
				.replace(/\.json$/, "");

			const accountList: PoolAccountTelemetry[] = poolAccs.map((a) => {
				const email = a.email || a.account_key?.replace(/^antigravity-/, "").replace(/\.json$/, "") || "";
				const fallbackTelem = a.account_key ? telemMap.get(a.account_key.toLowerCase()) : undefined;
				const rawKey = (a.account_key || "").toLowerCase();
				const rawEmail = email.toLowerCase();
				const prefix =
					prefixMap.get(rawEmail) ||
					prefixMap.get(rawKey) ||
					(rawEmail.includes("@") ? rawEmail.split("@")[0] : rawEmail) ||
					"account";
				return {
					email,
					prefix,
					role: a.role || (email.toLowerCase() === leaderEmail.toLowerCase() ? "leader" : "reserve"),
					window5hPct: a.window_5h_pct ?? fallbackTelem?.h5 ?? null,
					weeklyPct: a.weekly_pct ?? fallbackTelem?.wk ?? null,
					isCooling: a.is_cooling ?? false,
					fatiguePct: a.fatigue_pct ?? 0,
				};
			});

			// Asegurar orden: Líder primero, luego reservas
			accountList.sort((a, b) => (a.role === "leader" ? -1 : b.role === "leader" ? 1 : 0));

			const telemetryResult: PoolTelemetryData = {
				poolId: pId,
				leaderEmail,
				totalMembers: p.members?.length || accountList.length,
				accounts: accountList,
				updatedAt: now,
			};

			cachedPoolData.set(pId, { data: telemetryResult, timestamp: now });
		}

		return cachedPoolData.get(poolId)?.data ?? null;
	} catch {
		return cached?.data ?? null;
	} finally {
		isFetching = false;
	}
}

export function getCachedPoolTelemetry(poolId: string): PoolTelemetryData | null {
	const exact = cachedPoolData.get(poolId);
	if (exact) return exact.data;
	const lower = poolId.toLowerCase();
	for (const [k, v] of cachedPoolData.entries()) {
		if (k.toLowerCase() === lower) return v.data;
	}
	return null;
}
