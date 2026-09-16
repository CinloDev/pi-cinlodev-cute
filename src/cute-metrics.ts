import type { CutePalette } from "./cute-theme.ts";

/**
 * Formats a token count into a compact human-readable string:
 * - >= 1,000,000 -> "1.0M", "2.5M", "10M"
 * - >= 1,000 -> "1.2k", "24.5k", "128k"
 * - < 1,000 -> "850", "0"
 */
export function formatTokenCount(n: number): string {
	if (n >= 1_000_000) {
		const val = n / 1_000_000;
		return `${val >= 10 ? Math.round(val) : val.toFixed(1)}M`;
	}
	if (n >= 1_000) {
		const val = n / 1_000;
		return `${val >= 100 ? Math.round(val) : val.toFixed(1)}k`;
	}
	return `${Math.round(n)}`;
}

export interface ContextThreshold {
	color: (s: string) => string;
	label: string;
	level: "optimal" | "medium" | "alert" | "critical";
}

/**
 * Returns dynamic semáforo styling and status label based on context percent:
 * - 0% - 39.9%: Mint (Óptimo)
 * - 40% - 64.9%: Gold (Medio)
 * - 65% - 79.9%: Orange (Alerta)
 * - 80% - 100%: Coral/Rojo (Crítico)
 */
export function getContextThreshold(percent: number, palette: CutePalette): ContextThreshold {
	if (percent >= 80) {
		return { color: palette.coral, label: "● Crítico", level: "critical" };
	}
	if (percent >= 65) {
		return { color: palette.orange, label: "● Alerta", level: "alert" };
	}
	if (percent >= 40) {
		return { color: palette.gold, label: "● Medio", level: "medium" };
	}
	return { color: palette.mint, label: "● Óptimo", level: "optimal" };
}
