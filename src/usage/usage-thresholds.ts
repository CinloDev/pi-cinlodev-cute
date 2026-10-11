import type { CutePalette } from "../cute-theme.ts";

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
