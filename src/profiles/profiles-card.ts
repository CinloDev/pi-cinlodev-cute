import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg, bolden } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	getCachedAccounts,
	getQuotaThreshold,
	triggerUsageRefresh,
	formatRelativeReset,
	type QuotaPoolDisplay,
} from "../cute-usage.ts";
import {
	type SwitcherHitbox,
	type ProfileItem,
	listAvailableProfiles,
	getActiveProfileDetails,
	switchProfile,
	toggleProfileEffort,
	extractAccountFromModel,
	shortModelName,
} from "./profiles-service.ts";
import { getTaskManagerSummary } from "./profiles-task-sync.ts";

/**
 * Extended SDD Profiles & Quotas Card for Sidebar.
 * Displays:
 * 1. Switcher buttons for all local and builtin SDD profiles with click hitboxes.
 * 2. Active profile details, host model, and subagent roster.
 * 3. Live quota bars (5h rolling & Weekly limits) mapped to accounts.
 * 4. Interactive effort toggling (low -> medium -> high).
 * 5. Full-height alignment and mouse wheel internal scrolling.
 */
export class CinlodevProfilesExtendedCard implements Component {
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private readonly cwd?: string;
	private readonly ctx?: ExtensionContext;
	private readonly pi?: ExtensionAPI;
	private switcherHitboxes: SwitcherHitbox[] = [];
	private isExpanded = false;
	private scrollOffset = 0;
	private lastMaxScrollOffset = 0;

	constructor(tui?: TUI, theme?: Theme, cwd?: string, ctx?: ExtensionContext, pi?: ExtensionAPI) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.ctx = ctx;
		this.pi = pi;
	}

	getSwitcherHitboxes(): SwitcherHitbox[] {
		return [...this.switcherHitboxes];
	}

	handleRailClick(localLineIndex: number, _button?: string, localX?: number): boolean {
		if (localX !== undefined) {
			const hit = this.switcherHitboxes.find(
				(h) => h.lineIndex === localLineIndex && localX >= h.startX && localX <= h.endX,
			);
			if (hit) {
				if (hit.type === "toggle-pagination") {
					this.isExpanded = !this.isExpanded;
					this.tui?.requestRender();
					return true;
				}

				if (hit.type === "effort-host") {
					const active = getActiveProfileDetails(this.cwd);
					if (active?.name) {
						const next = toggleProfileEffort(active.name, undefined, this.cwd);
						if (next && this.pi && typeof this.pi.setThinkingLevel === "function") {
							try {
								this.pi.setThinkingLevel(next);
							} catch {}
						}
						this.tui?.requestRender();
					}
					return true;
				}

				if (hit.type === "effort-agent" && hit.agentId) {
					const active = getActiveProfileDetails(this.cwd);
					if (active?.name) {
						toggleProfileEffort(active.name, hit.agentId, this.cwd);
						this.tui?.requestRender();
					}
					return true;
				}

				if (hit.profileName) {
					switchProfile(hit.profileName, this.ctx, this.pi, this.cwd).then(() => {
						this.tui?.requestRender();
					});
					return true;
				}
			}
		}

		return false;
	}

	handleRailWheel(wheelDelta: number): boolean {
		if (wheelDelta !== 0) {
			const step = wheelDelta > 0 ? 2 : -2;
			if (this.lastMaxScrollOffset > 0) {
				const next = Math.max(0, Math.min(this.lastMaxScrollOffset, this.scrollOffset + step));
				if (next !== this.scrollOffset) {
					this.scrollOffset = next;
					this.tui?.requestRender();
					return true;
				}
				return true;
			}
		}
		return false;
	}

	render(width: number, availableHeight?: number): string[] {
		const theme = this.theme;
		const g = cuteGlyphs(theme);
		const colors = loadCuteColors();
		const palette = cutePalette(theme);
		const c = {
			...palette,
			accent: (s: string) => palette.pinkAccent(s),
			pink: (s: string) => palette.pinkAccent(s),
			pinkBright: (s: string) => (theme ? safeFg(theme, "pinkBright", s) : s),
			violet: (s: string) => (theme ? safeFg(theme, "border", s) : s),
			celeste: (s: string) => (theme ? safeFg(theme, "write", s) : s),
			salmon: (s: string) => (theme ? safeFg(theme, "salmon", s) : s),
			bold: (s: string) => bolden(theme, s),
		};

		const safeWidth = Math.max(30, width);
		const innerWidth = safeWidth - 4; // ║ + space + content + space + ║
		const frame = (s: string): string => (theme ? safeFg(theme, colors.sidebarBorder, s) : s);

		const titleStr = `${c.pink(g.brand || "✿")} ${c.pinkBright("Profiles & Clusters")}`;
		const maxTitleLen = Math.max(0, safeWidth - 6);
		const displayTitle = calcVisibleWidth(titleStr) > maxTitleLen ? truncateAnsiAware(titleStr, maxTitleLen) : titleStr;
		const titleLen = calcVisibleWidth(displayTitle);
		const fillTop = Math.max(0, safeWidth - 5 - titleLen);
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);
		const divider = frame(`${g.dividerL || "╠"}${g.h.repeat(safeWidth - 2)}${g.dividerR || "╣"}`);

		const boxLine = (left: string, right = ""): string => {
			let safeRight = right;
			if (calcVisibleWidth(safeRight) > innerWidth) {
				safeRight = truncateAnsiAware(safeRight, innerWidth);
			}
			const rightWidth = calcVisibleWidth(safeRight);
			const maxLeftWidth = Math.max(0, innerWidth - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = calcVisibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerWidth - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${safeRight} ${frame(g.v)}`;
		};

		this.switcherHitboxes = [];

		const availableProfiles = listAvailableProfiles(this.cwd);
		const profilesToRender: ProfileItem[] =
			availableProfiles.length > 0
				? availableProfiles
				: [{ name: "default", active: true, source: "builtin" }];

		const activeDetails = getActiveProfileDetails(this.cwd) || {
			name: profilesToRender.find((p) => p.active)?.name || profilesToRender[0]?.name || "default",
			default_model: "default",
			default_effort: "high",
		};
		const activeName = (activeDetails.name || "").toLowerCase();

		const clusterButtons = profilesToRender.map((item, idx) => {
			const num = idx + 1;
			const isActive = item.active || item.name.toLowerCase() === activeName;
			const dot = isActive ? "●" : "○";
			const raw = `[${dot} ${num}: ${item.name}]`;
			const styled = isActive
				? c.pinkBright(c.bold(raw))
				: `${c.dim(`[○ ${num}: `)}${c.muted(item.name)}${c.dim("]")}`;
			return {
				name: item.name,
				styled,
				len: calcVisibleWidth(raw),
			};
		});

		const lines: string[] = [top];

		// Dynamic line wrapping with max 3 lines pagination
		const MAX_PROFILE_LINES = 3;
		const toggleBtnRaw = this.isExpanded ? "[▲]" : "[▼]";
		const toggleBtnLen = calcVisibleWidth(toggleBtnRaw);
		const toggleBtnStyled = c.pinkBright(c.bold(toggleBtnRaw));

		// First pass: wrap all buttons into rows
		const wrappedRows: typeof clusterButtons[] = [];
		let rowButtons: typeof clusterButtons = [];
		let rowWidth = 0;

		for (const btn of clusterButtons) {
			const space = rowWidth > 0 ? 1 + btn.len : btn.len;
			if (rowWidth + space <= innerWidth) {
				rowButtons.push(btn);
				rowWidth += space;
			} else {
				if (rowButtons.length > 0) wrappedRows.push(rowButtons);
				rowButtons = [btn];
				rowWidth = btn.len;
			}
		}
		if (rowButtons.length > 0) wrappedRows.push(rowButtons);

		const needsPagination = wrappedRows.length > MAX_PROFILE_LINES;
		const rowsToRenderCount = !needsPagination || this.isExpanded ? wrappedRows.length : MAX_PROFILE_LINES;

		for (let r = 0; r < rowsToRenderCount; r++) {
			const isLastVisibleRow = r === rowsToRenderCount - 1 && needsPagination;
			const row = wrappedRows[r];
			const lineIndex = lines.length;
			let currentX = 2; // initial border + space

			if (isLastVisibleRow) {
				// Fit as many buttons as possible leaving room for [▼] or [▲]
				const availableWidth = innerWidth - toggleBtnLen - 1;
				const visibleRowButtons: typeof clusterButtons = [];
				let accumWidth = 0;

				for (const btn of row) {
					const space = accumWidth > 0 ? 1 + btn.len : btn.len;
					if (accumWidth + space <= availableWidth) {
						visibleRowButtons.push(btn);
						accumWidth += space;
					} else {
						break;
					}
				}

				for (const btn of visibleRowButtons) {
					this.switcherHitboxes.push({
						type: "profile",
						profileName: btn.name,
						lineIndex,
						startX: currentX,
						endX: currentX + btn.len,
					});
					currentX += btn.len + 1;
				}

				// Add toggle button at the end
				const lineContent = visibleRowButtons.map((b) => b.styled).join(" ");
				this.switcherHitboxes.push({
					type: "toggle-pagination",
					lineIndex,
					startX: currentX,
					endX: currentX + toggleBtnLen,
				});

				const leftPart = lineContent.length > 0 ? `${lineContent} ${toggleBtnStyled}` : toggleBtnStyled;
				lines.push(boxLine(leftPart));
			} else {
				for (const btn of row) {
					this.switcherHitboxes.push({
						type: "profile",
						profileName: btn.name,
						lineIndex,
						startX: currentX,
						endX: currentX + btn.len,
					});
					currentX += btn.len + 1;
				}
				const lineContent = row.map((b) => b.styled).join(" ");
				lines.push(boxLine(lineContent));
			}
		}

		// Divider between switchers and agents
		lines.push(divider);
		const fixedHeaderLength = lines.length;

		triggerUsageRefresh(this.ctx, this.tui, 15000);
		const cachedAccounts = getCachedAccounts();

		const bodyLines: string[] = [];
		const bodyEffortHitboxes: {
			type: "effort-host" | "effort-agent";
			agentId?: string;
			bodyLineIndex: number;
			startX: number;
			endX: number;
		}[] = [];

		const getAccountModelPools = (
			account: string,
			model: string,
		): {
			hasAccount: boolean;
			pool5h?: { pct: number; threshold: any; resetStr: string };
			poolWeekly?: { pct: number; threshold: any; resetStr: string };
		} => {
			let matching: any;
			if (cachedAccounts && cachedAccounts.length > 0) {
				const accLower = account.toLowerCase();
				matching = cachedAccounts.find(
					(a) =>
						a.prefix.toLowerCase() === accLower ||
						a.prefix.toLowerCase().includes(accLower) ||
						accLower.includes(a.prefix.toLowerCase()),
				);
			}

			if (!matching || !matching.pools || matching.pools.length === 0) {
				return { hasAccount: false };
			}

			const modelLower = model.toLowerCase();
			let candidatePools: QuotaPoolDisplay[] = matching.pools;

			// Extract significant model family tokens (e.g. "gemini", "claude", "gpt", "deepseek", "qwen", "mistral")
			const modelTokens = modelLower
				.split(/[\/_.:\s-]+/)
				.filter((t) => t.length >= 3 && !/^(cpam|cpamc|default|model|high|low|medium|pro|flash|mini|preview|latest)$/.test(t));

			const matchingModelPools = matching.pools.filter((p: QuotaPoolDisplay) => {
				const labelLower = p.label.toLowerCase();
				return modelTokens.some((tok) => labelLower.includes(tok));
			});

			if (matchingModelPools.length > 0) {
				candidatePools = matchingModelPools;
			}

			const raw5h = candidatePools.find((p) => /5\s*h|five\s*hour|window|rolling|hourly/i.test(p.label));
			const rawWeekly = candidatePools.find((p) => /week|seman|7\s*d/i.test(p.label));

			let final5h = raw5h;
			let finalWeekly = rawWeekly;

			// Fallback si no coinciden exactamente los nombres de 5h o Weekly
			if (!final5h && !finalWeekly && candidatePools.length > 0) {
				if (candidatePools.length === 1) {
					final5h = candidatePools[0];
				} else {
					final5h = candidatePools[0];
					finalWeekly = candidatePools[1];
				}
			}

			const toPoolInfo = (p?: QuotaPoolDisplay) => {
				if (!p) return undefined;
				const pct = Math.round(p.availablePercent);
				const threshold = getQuotaThreshold(p.availablePercent, c);
				const resetStr = formatRelativeReset(p.resetAt);
				return { pct, threshold, resetStr };
			};

			return {
				hasAccount: true,
				pool5h: toPoolInfo(final5h),
				poolWeekly: toPoolInfo(finalWeekly),
			};
		};

		const cellWidth = Math.max(1, calcVisibleWidth(g.gaugeFilled) || 1);
		const barCells = Math.max(4, Math.floor(innerWidth / cellWidth));

		const renderFullGaugeBar = (quota?: { pct: number; threshold: any }): string => {
			if (!quota) {
				return c.dim(g.gaugeEmpty.repeat(barCells));
			}
			const filled = Math.min(barCells, Math.max(0, Math.round((quota.pct / 100) * barCells)));
			const empty = Math.max(0, barCells - filled);
			return `${quota.threshold.color(g.gaugeFilled.repeat(filled))}${c.dim(g.gaugeEmpty.repeat(empty))}`;
		};

		const renderModelQuotaBars = (
			account: string,
			quotaInfo: ReturnType<typeof getAccountModelPools>,
		): void => {
			if (!quotaInfo.hasAccount || (!quotaInfo.pool5h && !quotaInfo.poolWeekly)) {
				bodyLines.push(boxLine(c.mint(`@${account}`), c.dim("sin cuota")));
				bodyLines.push(boxLine(renderFullGaugeBar(undefined)));
				return;
			}

			// Barra 1: 5h Window
			if (quotaInfo.pool5h) {
				const p5 = quotaInfo.pool5h;
				const left5h = `${c.mint(`@${account}`)} ${c.dim("·")} ${c.muted("5h")}`;
				const pctText = c.bold(p5.threshold.color(`${p5.pct}%`));
				const right5h = p5.resetStr ? `${pctText} ${c.dim(`(${p5.resetStr})`)}` : pctText;
				bodyLines.push(boxLine(left5h, right5h));
				bodyLines.push(boxLine(renderFullGaugeBar(p5)));
			}

			// Barra 2: Weekly Limit
			if (quotaInfo.poolWeekly) {
				const pw = quotaInfo.poolWeekly;
				const leftWeekly = `${c.muted("Semanal")}`;
				const pctText = c.bold(pw.threshold.color(`${pw.pct}%`));
				const rightWeekly = pw.resetStr ? `${pctText} ${c.dim(`(${pw.resetStr})`)}` : pctText;
				bodyLines.push(boxLine(leftWeekly, rightWeekly));
				bodyLines.push(boxLine(renderFullGaugeBar(pw)));
			}
		};

		// 2. Host row
		const hostModel = activeDetails.default_model || "default";
		const hostEffort = activeDetails.default_effort || "high";
		const hostAccount = (activeDetails as any).default_account || extractAccountFromModel(hostModel) || "host";
		const shortHost = shortModelName(hostModel).replace(/-high$/, "");

		// Line 1: Host title + model
		const hostLeft = `${c.violet("🎯")} ${c.bold(c.violet("host / orquestador"))}`;
		const hostMeta = `${c.gold(shortHost)} ${c.dim(`(${hostEffort})`)}`;
		const hostBodyLineIndex = bodyLines.length;
		if (calcVisibleWidth("🎯 host / orquestador") + calcVisibleWidth(`${shortHost} (${hostEffort})`) + 2 <= innerWidth) {
			bodyLines.push(boxLine(hostLeft, hostMeta));
			// Effort hitbox on the right side
			const effortWidth = calcVisibleWidth(`(${hostEffort})`);
			const safeRightX = innerWidth + 2 - effortWidth;
			bodyEffortHitboxes.push({
				type: "effort-host",
				bodyLineIndex: hostBodyLineIndex,
				startX: Math.max(2, safeRightX),
				endX: innerWidth + 2,
			});
		} else {
			bodyLines.push(boxLine(hostLeft));
			const subBodyLineIndex = bodyLines.length;
			bodyLines.push(boxLine(`  ${hostMeta}`));
			const effortWidth = calcVisibleWidth(`(${hostEffort})`);
			const safeRightX = innerWidth + 2 - effortWidth;
			bodyEffortHitboxes.push({
				type: "effort-host",
				bodyLineIndex: subBodyLineIndex,
				startX: Math.max(2, safeRightX),
				endX: innerWidth + 2,
			});
		}

		// Quota bars (5h y Semanal)
		const hostQuota = getAccountModelPools(hostAccount, hostModel);
		renderModelQuotaBars(hostAccount, hostQuota);

		// 3. Dynamic agent rows discovered from active profile
		const allAgentIds = Object.keys(activeDetails.model_profiles || {});

		const getAgentStyle = (agentId: string) => {
			if (agentId.startsWith("gentle-ai-")) {
				// ODD Core: Celeste
				return { bullet: c.celeste("•"), name: (s: string) => c.celeste(s) };
			}
			if (agentId.startsWith("jd-")) {
				// Judgment Day: Dorado
				return { bullet: c.gold("•"), name: (s: string) => c.gold(s) };
			}
			if (agentId.startsWith("review-")) {
				// Review Lenses: Menta
				return { bullet: c.mint("•"), name: (s: string) => c.mint(s) };
			}
			if (agentId.startsWith("research-")) {
				// Deep Research: Salmón
				return { bullet: c.salmon("•"), name: (s: string) => c.salmon(s) };
			}
			// Fallback / Custom user subagents: Pink accent bullet + text color
			return { bullet: c.pink("•"), name: (s: string) => c.text(s) };
		};

		if (allAgentIds.length === 0) {
			bodyLines.push(boxLine(""));
			bodyLines.push(boxLine(c.dim("sin subagentes configurados")));
		} else {
			for (const agentId of allAgentIds) {
				bodyLines.push(boxLine(""));

				const agentCfg = activeDetails.model_profiles?.[agentId];
				const model = agentCfg?.model || hostModel;
				const effort = agentCfg?.effort || hostEffort;
				const account = (agentCfg as any)?.account || extractAccountFromModel(agentCfg?.model) || hostAccount;
				const shortAgent = shortModelName(model).replace(/-high$/, "");

				const agentQuota = getAccountModelPools(account, model);
				const style = getAgentStyle(agentId);

				// Line 1: If name + model fits in one line, keep it together; otherwise put model on its own subline
				const leftText = `${style.bullet} ${style.name(agentId)}`;
				const rightText = `${c.gold(shortAgent)} ${c.dim(`(${effort})`)}`;
				const agentBodyLineIndex = bodyLines.length;
				if (calcVisibleWidth(`• ${agentId}`) + calcVisibleWidth(`${shortAgent} (${effort})`) + 2 <= innerWidth) {
					bodyLines.push(boxLine(leftText, rightText));
					const effortWidth = calcVisibleWidth(`(${effort})`);
					const safeRightX = innerWidth + 2 - effortWidth;
					bodyEffortHitboxes.push({
						type: "effort-agent",
						agentId,
						bodyLineIndex: agentBodyLineIndex,
						startX: Math.max(2, safeRightX),
						endX: innerWidth + 2,
					});
				} else {
					bodyLines.push(boxLine(leftText));
					const subBodyLineIndex = bodyLines.length;
					bodyLines.push(boxLine(`  ${rightText}`));
					const effortWidth = calcVisibleWidth(`(${effort})`);
					const safeRightX = innerWidth + 2 - effortWidth;
					bodyEffortHitboxes.push({
						type: "effort-agent",
						agentId,
						bodyLineIndex: subBodyLineIndex,
						startX: Math.max(2, safeRightX),
						endX: innerWidth + 2,
					});
				}

				// Quota bars (5h y Semanal)
				renderModelQuotaBars(account, agentQuota);
			}
		}

		// 4. Task Manager status summary if available
		const tm = getTaskManagerSummary(this.cwd);
		if (tm && tm.total > 0) {
			bodyLines.push(divider);
			const ratioStr = `${tm.completed}/${tm.total}`;
			const inProgStr = tm.inProgress > 0 ? ` · ${c.gold(`${tm.inProgress} en curso`)}` : "";
			bodyLines.push(boxLine(`${c.accent("📋 Task Manager")}`, `${c.mint(ratioStr)}${inProgStr}`));
			if (tm.currentTaskTitle) {
				bodyLines.push(boxLine(`   ▶ ${c.text(tm.currentTaskTitle)}`));
			}
		}

		const targetCardLines =
			availableHeight ||
			(this.tui?.terminal?.rows && this.tui.terminal.rows >= 15
				? Math.max(10, this.tui.terminal.rows - 11)
				: undefined);

		if (targetCardLines !== undefined && targetCardLines > fixedHeaderLength + 2) {
			const availableBodyLines = targetCardLines - fixedHeaderLength - 1; // -1 for bottom border
			if (bodyLines.length > availableBodyLines) {
				const maxVisibleBody = availableBodyLines - 1; // reserve 1 line for scroll indicator
				this.lastMaxScrollOffset = Math.max(0, bodyLines.length - maxVisibleBody);
				this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.lastMaxScrollOffset));
				const visibleBody = bodyLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleBody);

				for (const l of visibleBody) {
					lines.push(l);
				}

				for (const hb of bodyEffortHitboxes) {
					if (hb.bodyLineIndex >= this.scrollOffset && hb.bodyLineIndex < this.scrollOffset + visibleBody.length) {
						this.switcherHitboxes.push({
							type: hb.type,
							agentId: hb.agentId,
							lineIndex: fixedHeaderLength + (hb.bodyLineIndex - this.scrollOffset),
							startX: hb.startX,
							endX: hb.endX,
						});
					}
				}

				const remainingBelow = bodyLines.length - (this.scrollOffset + visibleBody.length);
				const parts: string[] = [];
				if (this.scrollOffset > 0) parts.push("▲ " + this.scrollOffset + " arriba");
				if (remainingBelow > 0) parts.push("▼ " + remainingBelow + " abajo");
				lines.push(boxLine(c.dim("... " + parts.join(" · ") + " (wheel scroll)")));
			} else {
				this.lastMaxScrollOffset = 0;
				this.scrollOffset = 0;
				for (const l of bodyLines) {
					lines.push(l);
				}
				for (const hb of bodyEffortHitboxes) {
					this.switcherHitboxes.push({
						type: hb.type,
						agentId: hb.agentId,
						lineIndex: fixedHeaderLength + hb.bodyLineIndex,
						startX: hb.startX,
						endX: hb.endX,
					});
				}
				while (lines.length < targetCardLines - 1) {
					lines.push(boxLine(""));
				}
			}
			lines.push(bottom);
		} else {
			this.lastMaxScrollOffset = 0;
			for (const l of bodyLines) {
				lines.push(l);
			}
			for (const hb of bodyEffortHitboxes) {
				this.switcherHitboxes.push({
					type: hb.type,
					agentId: hb.agentId,
					lineIndex: fixedHeaderLength + hb.bodyLineIndex,
					startX: hb.startX,
					endX: hb.endX,
				});
			}
			lines.push(bottom);
		}

		return lines;
	}
}
