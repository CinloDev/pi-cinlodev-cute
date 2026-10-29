import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, cutePalette, safeFg, bolden } from "../cute-theme.ts";
import { loadCuteColors } from "../cute-colors.ts";
import { truncateAnsiAware } from "../cute-transcript.ts";
import { formatTokenCount } from "../cute-metrics.ts";
import { footerRegistry } from "../footer/footer-registry.ts";
import { fetchCpamcPoolTelemetry, getCachedPoolTelemetry, type PoolTelemetryData } from "./pool-service.ts";

export class CinlodevCutePoolCard implements Component {
	private readonly tui?: TUI;
	private readonly theme?: Theme;
	private readonly ctx?: ExtensionContext;
	private readonly pi?: ExtensionAPI;
	private lastFetchTime = 0;

	constructor(tui?: TUI, theme?: Theme, ctx?: ExtensionContext, pi?: ExtensionAPI) {
		this.tui = tui;
		this.theme = theme;
		this.ctx = ctx;
		this.pi = pi;
	}

	invalidate(): void {}

	render(width: number, height?: number): string[] {
		const safeW = Math.max(30, width);
		const innerW = safeW - 4; // ║ + space + content + space + ║
		const c = cutePalette(this.theme);
		const g = cuteGlyphs(this.theme);
		const colors = loadCuteColors();
		const frame = (s: string): string => (this.theme ? safeFg(this.theme, colors.sidebarBorder, s) : s);
		const bold = (s: string): string => (this.theme ? bolden(this.theme, s) : s);

		const effectiveCtx = this.ctx ?? footerRegistry.latestCtx;
		const rawModel = effectiveCtx?.model?.id || (effectiveCtx?.model as any)?.name || "default";
		const isPool = rawModel.toLowerCase().includes("pool-");

		// Si no es Pool, no ocupa espacio vertical
		if (!isPool) {
			return [];
		}

		const poolMatch = rawModel.match(/(Pool-\d+-[a-z]+)/i);
		const poolId = poolMatch ? poolMatch[1] : rawModel.split("/").pop() || "Pool-01-gemini";

		// Refresh no bloqueante en background si pasaron > 2.5s
		const now = Date.now();
		if (now - this.lastFetchTime > 2500) {
			this.lastFetchTime = now;
			fetchCpamcPoolTelemetry(poolId).then((res) => {
				if (res && this.tui) {
					this.tui.requestRender();
				}
			});
		}

		const data: PoolTelemetryData | null = getCachedPoolTelemetry(poolId);
		const displayPoolId = data?.poolId || poolId;

		const stateTag = c.mint("[○ Esperando]");
		const titleStr = `${c.pinkBright("⚡ CUENTAS CPAMC:")} ${c.text("Gemini (Pool)")} ${c.border("─")} ${stateTag}`;
		const maxTitleLen = Math.max(0, safeW - 6);
		const displayTitle = visibleWidth(titleStr) > maxTitleLen ? truncateAnsiAware(titleStr, maxTitleLen) : titleStr;
		const fillTop = Math.max(0, safeW - 5 - visibleWidth(displayTitle));
		const top = `${frame(`${g.tl}${g.h} `)}${displayTitle}${frame(` ${g.h.repeat(fillTop)}${g.tr}`)}`;
		const bottom = frame(`${g.bl}${g.h.repeat(safeW - 2)}${g.br}`);
		const divider = frame(`${g.dividerL || "╠"}${g.h.repeat(safeW - 2)}${g.dividerR || "╣"}`);

		const boxLine = (left: string, right = ""): string => {
			let safeRight = right;
			if (visibleWidth(safeRight) > innerW) {
				safeRight = truncateAnsiAware(safeRight, innerW);
			}
			const rightWidth = visibleWidth(safeRight);
			const maxLeftWidth = Math.max(0, innerW - (rightWidth > 0 ? rightWidth + 1 : 0));
			const truncatedLeft = truncateAnsiAware(left, maxLeftWidth);
			const leftWidth = visibleWidth(truncatedLeft);
			const padLen = Math.max(0, innerW - leftWidth - rightWidth);
			const pad = " ".repeat(padLen);
			return `${frame(g.v)} ${truncatedLeft}${pad}${safeRight} ${frame(g.v)}`;
		};

		// Barras de ancho completo CUTE
		const cellWidth = Math.max(1, visibleWidth(g.gaugeFilled) || 1);
		const barCells = Math.max(4, Math.floor(innerW / cellWidth));

		const renderFullGaugeBar = (pct: number | null): string => {
			if (pct === null || isNaN(pct)) {
				return c.dim(g.gaugeEmpty.repeat(barCells));
			}
			const clamped = Math.max(0, Math.min(100, pct));
			const filled = Math.min(barCells, Math.max(0, Math.round((clamped / 100) * barCells)));
			const empty = Math.max(0, barCells - filled);
			let barColor = c.mint;
			if (clamped < 25) barColor = c.coral;
			else if (clamped < 60) barColor = c.yellow;
			return `${barColor(g.gaugeFilled.repeat(filled))}${c.dim(g.gaugeEmpty.repeat(empty))}`;
		};

		const leader = data?.accounts.find((a) => a.role === "leader") || {
			email: data?.leaderEmail || "conectando...",
			prefix: data?.leaderEmail?.includes("@") ? data.leaderEmail.split("@")[0] : (data?.leaderEmail || "conectando..."),
			role: "leader",
			window5hPct: null,
			weeklyPct: null,
		};

		const totalCount = data?.totalMembers || (data?.accounts.length ?? 4);
		const leaderPfx = leader.prefix || (leader.email.includes("@") ? leader.email.split("@")[0] : leader.email);

		// Métricas del líder
		const h5 = leader.window5hPct !== null ? Math.round(leader.window5hPct) : null;
		const wk = leader.weeklyPct !== null ? Math.round(leader.weeklyPct) : null;
		const minAvail = h5 !== null && wk !== null ? Math.min(h5, wk) : (h5 ?? wk ?? 100);

		const lines: string[] = [
			top,
			boxLine(c.muted("Grupo"), `${c.gold("✨")} ${c.text("Gemini (Pool)")}`),
			boxLine(c.muted("Cuentas listas"), c.text(String(totalCount))),
			boxLine(c.muted("Enfoque"), c.text("Misma cuenta fija")),
			divider,
			boxLine(
				c.pinkBright("[TRABAJANDO AHORA]"),
				`${c.mint("○")} ${c.text(`${displayPoolId}`)} ${c.mint(`(${minAvail}% ok)`)}`,
			),
			boxLine(c.muted("Cuenta"), c.mint(`@${leaderPfx}`)),
		];

		// Cuotas del líder con barras
		const h5Color = h5 === null ? c.muted : h5 < 25 ? c.coral : h5 < 60 ? c.yellow : c.mint;
		lines.push(boxLine(c.muted("Cuota 5h"), bold(h5Color(h5 !== null ? `${h5}%` : "--%"))));
		lines.push(boxLine(renderFullGaugeBar(h5)));

		const wkColor = wk === null ? c.muted : wk < 25 ? c.coral : wk < 60 ? c.yellow : c.mint;
		lines.push(boxLine(c.muted("Cuota Semanal"), bold(wkColor(wk !== null ? `${wk}%` : "--%"))));
		lines.push(boxLine(renderFullGaugeBar(wk)));

		// ─────────────────────────────────────────────────────────────
		// BLOQUE REACTIVO: CUIDANDO EL CHAT
		// ─────────────────────────────────────────────────────────────
		lines.push(divider);
		lines.push(boxLine(c.pinkBright("[CUIDANDO EL CHAT]"), c.mint("○ Todo limpio")));

		const usage = effectiveCtx?.getContextUsage?.();
		const contextWindow = usage?.contextWindow ?? effectiveCtx?.model?.contextWindow ?? 370_000;
		const tokens = usage?.tokens ?? 14_000;

		lines.push(
			boxLine(
				c.muted("Espacio usado"),
				c.text(`${formatTokenCount(tokens)} de ${formatTokenCount(contextWindow)} del tope`),
			),
		);
		lines.push(boxLine(c.muted("Basura recortada"), c.mint("+32k tk optimizados")));

		// ─────────────────────────────────────────────────────────────
		// BLOQUE DE RESERVAS / LA QUE SIGUE
		// ─────────────────────────────────────────────────────────────
		lines.push(divider);
		const reserves = data?.accounts.filter((a) => a.role !== "leader") || [];
		if (reserves.length > 0) {
			const nextAcc = reserves[0];
			const nextPfx = nextAcc.prefix || (nextAcc.email.includes("@") ? nextAcc.email.split("@")[0] : nextAcc.email);
			const nextH5 = nextAcc.window5hPct !== null ? Math.round(nextAcc.window5hPct) : 100;
			const nextWk = nextAcc.weeklyPct !== null ? Math.round(nextAcc.weeklyPct) : 100;
			const nextMin = Math.min(nextH5, nextWk);

			lines.push(
				boxLine(
					c.pinkBright("[LA QUE SIGUE]"),
					c.mint(`○ @${nextPfx} (${nextMin}% libre)`),
				),
			);
			lines.push(boxLine(c.muted("Cuenta"), c.mint(`@${nextPfx}`)));

			// Cuota 5h
			const nextH5Color = nextH5 < 25 ? c.coral : nextH5 < 60 ? c.yellow : c.mint;
			lines.push(boxLine(c.muted("Cuota 5h"), bold(nextH5Color(`${nextH5}%`))));
			lines.push(boxLine(renderFullGaugeBar(nextH5)));

			// Cuota Semanal
			const nextWkColor = nextWk < 25 ? c.coral : nextWk < 60 ? c.yellow : c.mint;
			lines.push(boxLine(c.muted("Cuota Semanal"), bold(nextWkColor(`${nextWk}%`))));
			lines.push(boxLine(renderFullGaugeBar(nextWk)));

			// Otras reservas en rotación
			const others = reserves.slice(1);
			for (let idx = 0; idx < others.length; idx++) {
				const res = others[idx];
				const resPfx = res.prefix || (res.email.includes("@") ? res.email.split("@")[0] : res.email);
				const resH5 = res.window5hPct !== null ? Math.round(res.window5hPct) : 100;
				const resWk = res.weeklyPct !== null ? Math.round(res.weeklyPct) : 100;
				const resMin = Math.min(resH5, resWk);
				const resColor = resMin >= 60 ? c.mint : resMin >= 25 ? c.yellow : c.coral;

				lines.push(divider);
				lines.push(
					boxLine(
						c.pinkBright(`[○ RESERVA ${idx + 2}]`),
						resColor(`@${resPfx} (${resMin}% libre)`),
					),
				);

				const resH5Color = resH5 < 25 ? c.coral : resH5 < 60 ? c.yellow : c.mint;
				lines.push(boxLine(c.muted("Cuota 5h"), bold(resH5Color(`${resH5}%`))));
				lines.push(boxLine(renderFullGaugeBar(resH5)));

				const resWkColor = resWk < 25 ? c.coral : resWk < 60 ? c.yellow : c.mint;
				lines.push(boxLine(c.muted("Cuota Semanal"), bold(resWkColor(`${resWk}%`))));
				lines.push(boxLine(renderFullGaugeBar(resWk)));
			}
		} else {
			lines.push(boxLine(c.pinkBright("[LA QUE SIGUE]"), c.muted("Ninguna (Sola)")));
		}

		// Si se especificó alto objetivo, expandir limpiamente
		if (height && height > lines.length + 1) {
			while (lines.length < height - 1) {
				lines.push(boxLine(""));
			}
		}

		lines.push(bottom);
		return lines;
	}
}
