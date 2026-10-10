import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { cuteGlyphs, cutePalette, frameFg } from "../cute-theme.ts";
import { loadCuteStrings, matchBracketProfile, detectSystemUser } from "../cute-strings.ts";
import { loadCuteLayout } from "../cute-layout.ts";
import { formatCwd, quoteGitCwd } from "../cute-paths.ts";
import { listAvailableProfiles, switchProfile } from "../cute-profiles.ts";
import {
	separator,
	prettifyExtraStatus,
	shortModelName,
	sessionCost,
	formatCost,
	renderGauge,
} from "./footer-formatters.ts";

const execAsync = promisify(exec);

export class CinlodevCuteFooter implements Component {
	private readonly pi: ExtensionAPI;
	private readonly ctx: ExtensionContext;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly footerData: ReadonlyFooterDataProvider;
	private dirtyCount: number | undefined;
	private lastDirtyCheck = 0;
	private unsubscribeBranch: (() => void) | undefined;
	private isProfileExpanded = false;
	private clickTargets: Array<{ lineIndex: number; action: () => void | Promise<void> }> = [];

	constructor(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
	) {
		this.pi = pi;
		this.ctx = ctx;
		this.tui = tui;
		this.theme = theme;
		this.footerData = footerData;
		if (footerData.onBranchChange) {
			this.unsubscribeBranch = footerData.onBranchChange(() => {
				this.refreshDirty();
				this.tui.requestRender();
			});
		}
		this.refreshDirty();
	}

	private refreshDirty(): void {
		const now = Date.now();
		if (now - this.lastDirtyCheck < loadCuteLayout().footer.dirtyMs) return;
		this.lastDirtyCheck = now;

		const cwd = this.ctx.cwd ?? process.cwd();
		execAsync(`git -C ${quoteGitCwd(cwd)} status --porcelain`)
			.then(({ stdout }) => {
				const trimmed = stdout.trim();
				const count = trimmed.length === 0 ? 0 : trimmed.split("\n").length;
				if (this.dirtyCount !== count) {
					this.dirtyCount = count;
					this.tui.requestRender();
				}
			})
			.catch(() => {
				this.dirtyCount = undefined;
			});
	}

	render(width: number): string[] {
		this.refreshDirty();
		const safeWidth = Math.max(loadCuteLayout().footer.minWidth, width);
		const c = cutePalette(this.theme);

		// 1. Brand segment (texts from config/CinlodevCute.strings.json via loadCuteStrings())
		const strings = loadCuteStrings();
		const user = strings.welcomePersona.user || detectSystemUser();
		const brandText = strings.footerBrand.replace("{user}", user);
		const brandSegment = `${c.pinkBright(strings.footerSymbol)} ${c.pinkAccent(brandText)}`;

		// 2. Git branch & dirty badge (branch glyph via cuteGlyphs)
		const branch = this.footerData.getGitBranch() || "no-git";
		const branchGlyph = cuteGlyphs(this.theme).branch;
		const dirtyBadge =
			this.dirtyCount && this.dirtyCount > 0 ? ` ${c.yellow(`±${this.dirtyCount}`)}` : "";
		const gitSegment = `${c.text(`${branchGlyph} ${branch}`)}${dirtyBadge}`;

		// 3. Model & thinking level: model (thinking)
		const rawModel = this.ctx.model?.id ?? "no-model";
		const displayModel = shortModelName(rawModel);
		const thinking = this.pi.getThinkingLevel();
		const thinkingLabel =
			thinking && thinking !== "off" ? ` ${c.gold(`(${thinking})`)}` : "";
		const modelSegment = `${c.text(displayModel)}${thinkingLabel}`;

		// 4. Context gauge (cells via cuteGlyphs gaugeFilled/gaugeEmpty)
		const usage = this.ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		const percentStr = percent !== null ? `${Math.round(percent)}%` : "?%";
		const gaugeStr = renderGauge(this.theme, percent);
		const contextSegment = `${c.muted("ctx")} ${gaugeStr} ${c.text(percentStr)}`;

		// 5. Session Cost: $0.000
		const costStr = formatCost(sessionCost(this.ctx));
		const costSegment = `${c.text(costStr)}`;

		// 6. Optional extension statuses (e.g. MCP servers, background jobs)
		const extraStatuses: string[] = [];
		try {
			const statusesMap = this.footerData.getExtensionStatuses?.();
			if (statusesMap) {
				for (const [, text] of statusesMap) {
					if (text && text.trim().length > 0) {
						extraStatuses.push(c.muted(prettifyExtraStatus(text, this.theme)));
					}
				}
			}
		} catch {}

		// Build segments array
		let segments = [
			brandSegment,
			gitSegment,
			modelSegment,
			contextSegment,
			costSegment,
			...extraStatuses,
		];

		const joinLine = (segs: string[]) => segs.join(` ${separator(this.theme)} `);
		let line = joinLine(segments);

		// If it overflows terminal width, progressively compact
		if (visibleWidth(line) > safeWidth) {
			// 1. Drop extra statuses first
			while (segments.length > 5 && visibleWidth(line) > safeWidth) {
				segments.pop();
				line = joinLine(segments);
			}
		}
		if (visibleWidth(line) > safeWidth) {
			// 2. Compact git branch if long
			const branchMax = loadCuteLayout().footer.branchMax;
			const compactBranch =
				branch.length > branchMax ? `${branch.slice(0, branchMax - 1)}…` : branch;
			const compactGit = `${c.text(`${branchGlyph} ${compactBranch}`)}${dirtyBadge}`;
			segments = [brandSegment, compactGit, modelSegment, contextSegment, costSegment];
			line = joinLine(segments);
		}
		if (visibleWidth(line) > safeWidth) {
			// 3. Drop cost segment
			segments = [segments[0], segments[1], modelSegment, contextSegment];
			line = joinLine(segments);
		}
		if (visibleWidth(line) > safeWidth) {
			// 4. Drop context segment
			segments = [segments[0], segments[1], modelSegment];
			line = joinLine(segments);
		}
		if (visibleWidth(line) > safeWidth) {
			// 5. Shorten brand (texts from config/CinlodevCute.strings.json via loadCuteStrings())
			const shortText = strings.footerShort.replace("{user}", user);
			const shortBrand = `${c.pinkBright(strings.footerSymbol)} ${c.pinkAccent(shortText)}`;
			segments = [shortBrand, segments[1]];
			line = joinLine(segments);
		}

		return [truncateToWidth(line, safeWidth, "…")];
	}

	renderSidebarCard(width: number): string[] {
		this.refreshDirty();
		const safeWidth = Math.max(loadCuteLayout().footer.cardMinWidth, width);
		const innerWidth = safeWidth - 4;
		const c = cutePalette(this.theme);
		const theme = this.theme;

		const cTitle = (s: string) => c.pinkBright(s);
		const cLabel = (s: string) => c.gold(s);
		const cText = (s: string) => c.text(s);
		const cAccent = (s: string) => c.pinkAccent(s);
		const cWarning = (s: string) => c.yellow(s);
		const cMuted = (s: string) => c.muted(s);

		const g = cuteGlyphs(theme);
		const boxLine = (left: string, right = ""): string => {
			const spaceNeeded = innerWidth - visibleWidth(left) - visibleWidth(right);
			const pad = " ".repeat(Math.max(1, spaceNeeded));
			const content = truncateToWidth(left + pad + right, innerWidth);
			const fill = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
			return `${frameFg(theme, g.v)} ${content}${fill} ${frameFg(theme, g.v)}`;
		};

		const statusTitle = loadCuteStrings().statusTitle;
		const titleStr = cTitle(statusTitle);
		const rawTitle = statusTitle;
		const fillTop = Math.max(0, safeWidth - 4 - visibleWidth(rawTitle) - 1);
		const top = `${frameFg(theme, `${g.tl}${g.h} `)}${titleStr}${frameFg(theme, ` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frameFg(theme, `${g.bl}${g.h.repeat(safeWidth - 2)}${g.br}`);

		const rawCwd = this.ctx.cwd ?? process.cwd();
		const shortCwd = formatCwd(rawCwd);

		const branch = this.footerData.getGitBranch() || "no-git";
		const cardBranchGlyph = cuteGlyphs(theme).branch;
		const dirtyBadge = this.dirtyCount && this.dirtyCount > 0 ? ` ${cWarning(`±${this.dirtyCount}`)}` : "";

		const rawModel = this.ctx.model?.id ?? "no-model";
		const displayModel = shortModelName(rawModel);
		const thinking = this.pi.getThinkingLevel();
		const thinkingStr = thinking && thinking !== "off" ? ` ${cLabel(`(${thinking})`)}` : "";

		this.clickTargets = [];
		const availableProfiles = listAvailableProfiles(this.ctx.cwd);
		const activeProfileFromList = availableProfiles.find((p) => p.active);

		let profileStatusRaw: string | null = null;
		const otherStatuses: string[] = [];
		try {
			const statusesMap = this.footerData.getExtensionStatuses?.();
			if (statusesMap) {
				for (const [key, text] of statusesMap) {
					if (!text || text.trim().length === 0) continue;
					const pretty = prettifyExtraStatus(text, this.theme);
					if (
						key === "sdd-profile" ||
						text.includes("🤖") ||
						matchBracketProfile(text) !== null
					) {
						profileStatusRaw = pretty;
					} else {
						otherStatuses.push(pretty);
					}
				}
			}
		} catch {}

		const hasProfiles = availableProfiles.length > 0 || profileStatusRaw !== null;
		const activeName =
			activeProfileFromList?.name ||
			(profileStatusRaw ? profileStatusRaw.replace(/^[🤖\s]+/, "").trim() : "default");

		const lines: string[] = [
			top,
			boxLine(cLabel("Project"), cText(shortCwd)),
			boxLine(cLabel("Branch"), `${cText(`${cardBranchGlyph} ${branch}`)}${dirtyBadge}`),
			boxLine(cLabel("Model"), `${cAccent(displayModel)}${thinkingStr}`),
		];

		if (otherStatuses.length > 0 || hasProfiles) {
			lines.push(frameFg(theme, `${g.dividerL}${g.h.repeat(safeWidth - 2)}${g.dividerR}`));
			for (const status of otherStatuses.slice(0, loadCuteLayout().footer.extraMax)) {
				lines.push(boxLine(cMuted(status)));
			}

			if (hasProfiles) {
				const arrow = this.isProfileExpanded ? "▾" : "▸";
				const profileGlyph = cuteGlyphs(theme).profileIcon || "🤖";
				const profileHeaderLeft = `${profileGlyph} ${cMuted(activeName)}`;
				const profileHeaderRight = cAccent(arrow);

				this.clickTargets.push({
					lineIndex: lines.length,
					action: () => {
						this.isProfileExpanded = !this.isProfileExpanded;
						this.tui.requestRender();
					},
				});
				lines.push(boxLine(profileHeaderLeft, profileHeaderRight));

				if (this.isProfileExpanded && availableProfiles.length > 0) {
					for (const p of availableProfiles) {
						this.clickTargets.push({
							lineIndex: lines.length,
							action: async () => {
								await this.selectProfile(p.name);
							},
						});

						if (p.active) {
							lines.push(boxLine(cAccent(`  ● ${p.name}`), cAccent("(activo)")));
						} else {
							lines.push(boxLine(cMuted(`  ○ ${p.name}`)));
						}
					}
				}
			}
		}

		lines.push(bottom);
		return lines;
	}

	isProfileDropdownOpen(): boolean {
		return this.isProfileExpanded;
	}

	closeProfileDropdown(): void {
		if (this.isProfileExpanded) {
			this.isProfileExpanded = false;
			this.tui.requestRender();
		}
	}

	private async selectProfile(name: string): Promise<void> {
		this.isProfileExpanded = false;
		await switchProfile(name, this.ctx, this.pi, this.ctx.cwd);
		this.tui.requestRender();
	}

	handleCardClick(localLineIndex: number): boolean {
		const target = this.clickTargets.find((t) => t.lineIndex === localLineIndex);
		if (target) {
			const res = target.action();
			if (res && typeof (res as any).then === "function") {
				(res as Promise<void>).then(() => {
					this.tui.requestRender();
				});
			}
			return true;
		}
		return false;
	}

	invalidate(): void {}

	dispose(): void {
		if (this.unsubscribeBranch) {
			this.unsubscribeBranch();
			this.unsubscribeBranch = undefined;
		}
	}
}
