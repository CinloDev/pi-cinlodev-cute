import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { loadCutePaths } from "../cute-paths.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	DEFAULT_ENGRAM_DASHBOARD,
	detectProjectName,
	loadEngramCloudConfig,
	resolveDashboardUrl,
	formatRelativeTime,
	openEngramDashboard,
	syncProjectCloud,
	enrollProject,
	unenrollProject,
	resetEngramCache,
	triggerEngramRefresh,
	getEngramSnapshot,
	type EngramSnapshot,
} from "./engram-client.ts";

interface ActionTarget {
	lineIndex: number;
	action: () => void | Promise<void>;
}

// In-memory reference for testing and state sharing
let lastRenderedSnapshot: EngramSnapshot | null = null;

export function getLastRenderedSnapshot(): EngramSnapshot | null {
	return lastRenderedSnapshot;
}

/**
 * CinlodevEngramCard: Interactive TUI sidebar card showing local Engram daemon health,
 * observations count, and Cloud sync status with direct click-to-open dashboard
 * and enroll/unenroll actions.
 */
export class CinlodevEngramCard implements Component {
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme?: Theme;
	private expanded = true;
	private clickTargets: ActionTarget[] = [];
	private statusNotice: string | null = null;
	private statusNoticeTimer: any = null;
	private confirmingAction: "enroll" | "unenroll" | null = null;
	private confirmTimer: any = null;

	constructor(ctx: ExtensionContext, tui: TUI, theme?: Theme) {
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
	}

	invalidate(): void {
		resetEngramCache();
		this.tui.requestRender();
	}

	toggleExpanded(): boolean {
		this.expanded = !this.expanded;
		this.resetConfirmation();
		this.tui.requestRender();
		return this.expanded;
	}

	private setConfirmTimer(durationMs = 6000): void {
		if (this.confirmTimer) clearTimeout(this.confirmTimer);
		this.confirmTimer = setTimeout(() => {
			if (this.confirmingAction) {
				this.confirmingAction = null;
				this.tui.requestRender();
			}
		}, durationMs);
		this.confirmTimer?.unref?.();
	}

	private resetConfirmation(): void {
		if (this.confirmTimer) {
			clearTimeout(this.confirmTimer);
			this.confirmTimer = null;
		}
		this.confirmingAction = null;
	}

	handleClick(lineIndex?: number): boolean {
		if (lineIndex === undefined) return false;

		// 1. Header click (line 0) toggles expand/collapse
		if (lineIndex === 0) {
			this.resetConfirmation();
			this.toggleExpanded();
			return true;
		}

		// 2. Action targets
		const target = this.clickTargets.find((t) => t.lineIndex === lineIndex);
		if (target) {
			Promise.resolve(target.action()).catch(() => {});
			return true;
		}

		// Click outside target cancels confirmation if active
		if (this.confirmingAction) {
			this.resetConfirmation();
			this.tui.requestRender();
			return true;
		}

		return false;
	}

	private setFlashNotice(msg: string, durationMs = 4000): void {
		this.statusNotice = msg;
		if (this.statusNoticeTimer) clearTimeout(this.statusNoticeTimer);
		this.statusNoticeTimer = setTimeout(() => {
			this.statusNotice = null;
			this.tui.requestRender();
		}, durationMs);
		this.statusNoticeTimer?.unref?.();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const cwd = this.ctx.cwd ?? process.cwd();
		triggerEngramRefresh(cwd, this.tui);

		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const theme = this.theme;
		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║

		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);
		const palette = cutePalette(this.theme);

		const c = {
			...palette,
			mint: (s: string) => (theme ? safeFg(theme, "success", s, "green") : s),
			coral: (s: string) => (theme ? safeFg(theme, "error", s, "red") : s),
			cyan: (s: string) => (theme ? safeFg(theme, "write", s, "cyan") : s),
			yellow: (s: string) => (theme ? safeFg(theme, "warning", s, "yellow") : s),
			pink: (s: string) => palette.pinkAccent(s),
			dim: (s: string) => palette.dim(s),
			muted: (s: string) => palette.muted(s),
		};

		const boxLine = (left: string, right = ""): string => {
			const rightWidth = calcVisibleWidth(right);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${right} ${frame(g.v)}`;
		};

		this.clickTargets = [];
		// Fetch synchronous snapshot if cached
		let snapshot: EngramSnapshot | null = null;
		getEngramSnapshot(cwd).then((s) => {
			snapshot = s;
			lastRenderedSnapshot = s;
		}).catch(() => {});
		snapshot = lastRenderedSnapshot;

		const projectName = snapshot?.project ?? detectProjectName(cwd);

		// Header title
		const arrow = this.expanded ? "▲" : "▼";
		const headerLeft = `🧠 ${c.pink("Engram:")} ${c.cyan(projectName)}`;
		const headerRight = `${c.dim(arrow)}`;
		const headerTitle = `${headerLeft} ${headerRight}`;
		const headerLen = calcVisibleWidth(headerTitle);
		const fillTop = Math.max(0, safeWidth - 5 - headerLen);
		const top = `${frame(`${g.tl}${g.h} `)}${headerTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		if (!this.expanded) {
			// Compact 1-line collapsed view
			const obsCount = snapshot?.stats?.totalObservations ?? 0;
			const isOnline = snapshot?.health?.healthy;
			const statusDot = isOnline ? c.mint("●") : c.coral("○");
			const enrolledBadge = snapshot?.isEnrolled ? c.mint("cloud✓") : c.dim("local");
			const summary = `${statusDot} ${obsCount} obs · ${enrolledBadge}`;
			return [top, boxLine(summary), bottom];
		}

		const lines: string[] = [top];

		// If transient notice message is present
		if (this.statusNotice) {
			lines.push(boxLine(c.yellow(`⚡ ${this.statusNotice}`)));
		}

		// Section 1: Local Daemon
		const isHealthy = snapshot?.health?.healthy ?? false;
		const localStatusDot = isHealthy ? c.mint("● Online") : c.coral("○ Caído");
		const obsCount = snapshot?.stats?.totalObservations ?? 0;
		const obsText = `${obsCount} obs`;
		lines.push(boxLine(`🖥️ ${c.text("Local (7437)")}`, `${localStatusDot} · ${c.cyan(obsText)}`));

		// Section 2: Divider
		lines.push(frame(`${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));

		// Section 3: Cloud & Dashboard
		const configuredDashboard = loadCutePaths().engramDashboardUrl;
		const cloudServerUrl = snapshot?.cloudConfig?.serverUrl || configuredDashboard || DEFAULT_ENGRAM_DASHBOARD;
		let serverHost = "local";
		try {
			serverHost = new URL(cloudServerUrl).hostname;
		} catch {}

		const dashboardBtn = c.cyan("dashboard ↗");
		const cloudTitleLeft = `☁️ ${c.text("Cloud:")} ${c.dim(serverHost)}`;

		// Click target for dashboard button (opens project directly if enrolled/available)
		this.clickTargets.push({
			lineIndex: lines.length,
			action: async () => {
				this.resetConfirmation();
				const configuredDashboard = loadCutePaths().engramDashboardUrl;
				const targetUrl = resolveDashboardUrl(snapshot?.cloudConfig, projectName, configuredDashboard);
				const opened = await openEngramDashboard(targetUrl);
				if (opened) {
					this.setFlashNotice(`Abriendo ${projectName} en browser…`);
				} else {
					this.setFlashNotice("Error al abrir navegador.");
				}
			},
		});
		lines.push(boxLine(cloudTitleLeft, dashboardBtn));

		// Cloud status details
		const isEnrolled = snapshot?.isEnrolled ?? false;
		if (isEnrolled) {
			const syncPhase = snapshot?.sync?.phase || "healthy";
			const lastSync = snapshot?.sync?.lastSyncAt;
			const relativeSync = formatRelativeTime(lastSync);
			const syncStatusText =
				syncPhase === "syncing"
					? c.yellow("⟳ Sincronizando…")
					: c.mint(`● Enrolado (${relativeSync})`);

			lines.push(boxLine(`   ${c.dim("Sync:")}`, syncStatusText));

			// Action button 1: Manual sync now
			const syncNowBtn = c.cyan("sincronizar ⟳");
			this.clickTargets.push({
				lineIndex: lines.length,
				action: async () => {
					this.resetConfirmation();
					this.setFlashNotice(`Sincronizando ${projectName}…`);
					const res = await syncProjectCloud(projectName);
					if (res.success) {
						this.setFlashNotice(`✓ ${projectName} sincronizado`);
						resetEngramCache();
						triggerEngramRefresh(cwd, this.tui, 0);
					} else {
						this.setFlashNotice(`⚠ Error al sincronizar: ${res.message.slice(0, 30)}`);
					}
				},
			});
			lines.push(boxLine(`   ${c.dim("Push:")}`, syncNowBtn));

			// Action button 2: Unenroll with confirmation
			const isConfirming = this.confirmingAction === "unenroll";
			const unenrollBtn = isConfirming
				? c.coral("¿Desincronizar? [click = Sí]")
				: c.coral("desincronizar ✕");

			this.clickTargets.push({
				lineIndex: lines.length,
				action: async () => {
					if (!isConfirming) {
						this.confirmingAction = "unenroll";
						this.setConfirmTimer();
						this.tui.requestRender();
						return;
					}

					this.resetConfirmation();
					this.setFlashNotice(`Desincronizando ${projectName}…`);
					const res = await unenrollProject(projectName);
					if (res.success) {
						this.setFlashNotice(`✓ ${projectName} desincronizado`);
						resetEngramCache();
						triggerEngramRefresh(cwd, this.tui, 0);
					} else {
						this.setFlashNotice(`⚠ Error al desincronizar: ${res.message.slice(0, 30)}`);
					}
				},
			});
			lines.push(boxLine(`   ${c.dim("Acción:")}`, unenrollBtn));
		} else {
			lines.push(boxLine(`   ${c.dim("Estado:")}`, c.dim("○ No sincronizado")));

			// Action button: Enroll with confirmation
			const isConfirming = this.confirmingAction === "enroll";
			const enrollBtn = isConfirming
				? c.mint("¿Enrolar repo? [click = Sí]")
				: c.mint("+ enrolar repo");

			this.clickTargets.push({
				lineIndex: lines.length,
				action: async () => {
					if (!isConfirming) {
						this.confirmingAction = "enroll";
						this.setConfirmTimer();
						this.tui.requestRender();
						return;
					}

					this.resetConfirmation();
					this.setFlashNotice(`Enrolando ${projectName} en la nube…`);
					const res = await enrollProject(projectName);
					if (res.success) {
						this.setFlashNotice(`✓ ${projectName} enrolado con éxito!`);
						resetEngramCache();
						triggerEngramRefresh(cwd, this.tui, 0);
					} else {
						this.setFlashNotice(`⚠ Error al enrolar: ${res.message.slice(0, 30)}`);
					}
				},
			});
			lines.push(boxLine(`   ${c.dim("Acción:")}`, enrollBtn));
		}

		lines.push(bottom);
		return lines;
	}
}
