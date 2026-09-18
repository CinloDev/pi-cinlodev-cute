import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatTokenCount } from "./cute-metrics.ts";
import { notify, type NotificationType } from "./cute-notify.ts";

export interface ContextMonitorOptions {
	alertThreshold?: number; // default: 65
	criticalThreshold?: number; // default: 80
	criticalIntervalMs?: number; // default: 5 * 60 * 1000 (5 min)
	onNotify?: (title: string, body: string, type: NotificationType) => void;
}

export class CuteContextMonitor {
	private readonly alertThreshold: number;
	private readonly criticalThreshold: number;
	private readonly criticalIntervalMs: number;
	private readonly customNotifier?: (title: string, body: string, type: NotificationType) => void;

	private alertNotifiedOnce = false;
	private lastCriticalAlertTime = 0;
	private checkTimer: NodeJS.Timeout | null = null;
	private lastContext: ExtensionContext | null = null;

	constructor(options: ContextMonitorOptions = {}) {
		this.alertThreshold = options.alertThreshold ?? 65;
		this.criticalThreshold = options.criticalThreshold ?? 80;
		this.criticalIntervalMs = options.criticalIntervalMs ?? 5 * 60 * 1000;
		this.customNotifier = options.onNotify;
	}

	get isAlertNotified(): boolean {
		return this.alertNotifiedOnce;
	}

	get lastCriticalTime(): number {
		return this.lastCriticalAlertTime;
	}

	reset(): void {
		this.alertNotifiedOnce = false;
		this.lastCriticalAlertTime = 0;
		this.stopTimer();
	}

	stop(): void {
		this.stopTimer();
		this.lastContext = null;
	}

	private stopTimer(): void {
		if (this.checkTimer) {
			clearInterval(this.checkTimer);
			this.checkTimer = null;
		}
	}

	private startTimer(ctx: ExtensionContext): void {
		if (this.checkTimer) return;
		this.checkTimer = setInterval(() => {
			if (this.lastContext) {
				this.check(this.lastContext);
			}
		}, 30_000); // Poll every 30s to check if critical threshold interval elapsed
		this.checkTimer.unref?.();
	}

	private dispatchNotification(
		ctx: ExtensionContext,
		title: string,
		body: string,
		type: NotificationType,
	): void {
		if (this.customNotifier) {
			this.customNotifier(title, body, type);
		} else {
			notify(ctx, title, body, type);
		}
	}

	check(ctx: ExtensionContext): { level: "optimal" | "alert" | "critical"; notified: boolean } {
		this.lastContext = ctx;
		const usage = ctx.getContextUsage?.();
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 128_000;
		const tokens = usage?.tokens ?? 0;
		const rawPercent =
			usage?.percent ?? (contextWindow > 0 ? (tokens / contextWindow) * 100 : 0);
		const percent = Math.max(0, Math.min(100, rawPercent));
		const rounded = Math.round(percent);
		const formattedWindow = formatTokenCount(contextWindow);
		const now = Date.now();

		// 1. Critical Level (>= 80%)
		if (rounded >= this.criticalThreshold) {
			this.startTimer(ctx);
			const shouldAlert =
				this.lastCriticalAlertTime === 0 ||
				now - this.lastCriticalAlertTime >= this.criticalIntervalMs;

			if (shouldAlert) {
				this.lastCriticalAlertTime = now;
				const title = `⚠️ Contexto Crítico (${rounded}% / ${formattedWindow})`;
				const body =
					"Estás en zona de peligro. Te sugiero ejecutar /compact o pasar a una nueva sesión.";
				this.dispatchNotification(ctx, title, body, "warning");
				return { level: "critical", notified: true };
			}
			return { level: "critical", notified: false };
		}

		// 2. Alert Level (65% - 79%)
		if (rounded >= this.alertThreshold) {
			this.stopTimer();
			this.lastCriticalAlertTime = 0; // Reset critical timer if we dropped from critical

			if (!this.alertNotifiedOnce) {
				this.alertNotifiedOnce = true;
				const title = `💡 Contexto Elevado (${rounded}% / ${formattedWindow})`;
				const body =
					"El contexto está subiendo. Podés ir planificando una nueva sesión con /handoff, /new o /continue.";
				this.dispatchNotification(ctx, title, body, "info");
				return { level: "alert", notified: true };
			}
			return { level: "alert", notified: false };
		}

		// 3. Normal / Optimal / Medium Level (< 65%)
		this.reset();
		return { level: "optimal", notified: false };
	}
}
