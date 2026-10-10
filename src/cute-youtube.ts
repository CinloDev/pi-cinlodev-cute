import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { cuteGlyphs, safeFg, bolden } from "./cute-theme.ts";
import { calcVisibleWidth, truncateAnsiAware } from "./cute-transcript.ts";

export const YOUTUBE_PLAYER_SYMBOL = Symbol.for("pi-youtube-player");

interface ClickableHitbox {
	line: number;
	startX: number;
	endX: number;
	action: () => void;
}

function cleanTitle(t?: string): string {
	return (t || "")
		.replace(/[\u00A0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, " ")
		.replace(/\s+/g, " ")
		.toLowerCase()
		.trim();
}

/**
 * Tarjeta interactiva del reproductor de YouTube Music para la sidebar CUTE
 */
export class CinlodevYouTubeCard {
	private tui: TUI;
	private theme?: Theme;
	private hitboxes: ClickableHitbox[] = [];
	private unsubscribe?: () => void;

	constructor(tui: TUI, theme?: Theme) {
		this.tui = tui;
		this.theme = theme;
		this.ensureSubscribed();
	}

	private ensureSubscribed(): void {
		if (this.unsubscribe) return;
		const player = this.getPlayer();
		if (player && typeof player.on === "function") {
			this.unsubscribe = player.on("stateChange", () => {
				this.tui.requestRender();
			});
		}
	}

	public dispose(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
	}

	public invalidate(): void {}

	private getPlayer(): any {
		return (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
	}

	public handleRailClick(localY: number, _button?: string, localX = 0): boolean {
		const match = this.hitboxes.find(
			(h) => h.line === localY && localX >= h.startX && localX <= h.endX
		);
		if (match) {
			match.action();
			this.tui.requestRender();
			return true;
		}
		return false;
	}

	public render(width: number, availableHeight?: number): string[] {
		this.hitboxes = [];
		this.ensureSubscribed();
		const player = this.getPlayer();
		const state = player?.getState?.();
		const g = cuteGlyphs(this.theme);

		const border = (s: string): string => (this.theme ? safeFg(this.theme, "border", s) : s);
		const borderMuted = (s: string): string => (this.theme ? safeFg(this.theme, "borderMuted", s, "muted") : s);
		const accent = (s: string): string => (this.theme ? safeFg(this.theme, "accent", s) : s);
		const pinkBright = (s: string): string => (this.theme ? safeFg(this.theme, "pinkBright", s) : s);
		const gold = (s: string): string => (this.theme ? safeFg(this.theme, "heading", s, "accent") : s);
		const yellow = (s: string): string => (this.theme ? safeFg(this.theme, "warning", s) : s);
		const mint = (s: string): string => (this.theme ? safeFg(this.theme, "mint", s, "success") : s);
		const cyan = (s: string): string => (this.theme ? safeFg(this.theme, "cyan", s, "accent") : s);
		const muted = (s: string): string => (this.theme ? safeFg(this.theme, "muted", s) : s);
		const dim = (s: string): string => (this.theme ? safeFg(this.theme, "dim", s) : s);
		const textFg = (s: string): string => (this.theme ? safeFg(this.theme, "text", s) : s);

		const isConnected = state && state.connectedClients > 0 && state.status !== "disconnected";
		const isPlaying = state?.status === "playing";

		const lines: string[] = [];

		// Header del frame
		const titleStr = isConnected ? " 🎵 YouTube Music " : " 🎵 YouTube Music (Offline) ";
		const hLine = g.h.repeat(Math.max(0, width - 2 - calcVisibleWidth(titleStr)));
		lines.push(`${border(g.tl)}${accent(bolden(this.theme, titleStr))}${border(hLine)}${border(g.tr)}`);

		if (!isConnected) {
			lines.push(`${border(g.v)}${" ".repeat(Math.max(0, width - 2))}${border(g.v)}`);

			const offlineMsg1 = `  ${cyan("✦")} ${gold("Esperando conexión de Chrome...")}`;
			const pad1 = Math.max(0, width - 2 - calcVisibleWidth(offlineMsg1));
			lines.push(`${border(g.v)}${offlineMsg1}${" ".repeat(pad1)}${border(g.v)}`);

			const offlineMsg2 = `    ${muted("Abrí")} ${accent("music.youtube.com")}`;
			const pad2 = Math.max(0, width - 2 - calcVisibleWidth(offlineMsg2));
			lines.push(`${border(g.v)}${offlineMsg2}${" ".repeat(pad2)}${border(g.v)}`);

			lines.push(`${border(g.v)}${" ".repeat(Math.max(0, width - 2))}${border(g.v)}`);
			lines.push(`${border(g.bl)}${border(g.h.repeat(Math.max(0, width - 2)))}${border(g.br)}`);
			return lines;
		}

		// 1. Línea: Aire superior
		lines.push(`${border(g.v)}${" ".repeat(Math.max(0, width - 2))}${border(g.v)}`);

		// 2. Línea: Canción
		const statusIcon = isPlaying ? mint("▶ ") : yellow("⏸ ");
		const songTitle = state.title || "Desconocido";
		const songLineRaw = `  ${statusIcon}${pinkBright(bolden(this.theme, songTitle))}`;
		const songLineTrunc = truncateAnsiAware(songLineRaw, width - 4);
		const songPad = Math.max(0, width - 2 - calcVisibleWidth(songLineTrunc));
		lines.push(`${border(g.v)}${songLineTrunc}${" ".repeat(songPad)}${border(g.v)}`);

		// 3. Línea: Artista
		const artistName = state.artist || "YouTube Music";
		const artistLineRaw = `  ${dim("👤")} ${cyan(artistName)}`;
		const artistLineTrunc = truncateAnsiAware(artistLineRaw, width - 4);
		const artistPad = Math.max(0, width - 2 - calcVisibleWidth(artistLineTrunc));
		lines.push(`${border(g.v)}${artistLineTrunc}${" ".repeat(artistPad)}${border(g.v)}`);

		// 4. Línea: Aire antes de la barra
		lines.push(`${border(g.v)}${" ".repeat(Math.max(0, width - 2))}${border(g.v)}`);

		// 5. Línea: Timeline & Scrubber con Tiempos en los extremos y Badge de volumen
		const currentTime = typeof state?.currentTime === "number" && !Number.isNaN(state.currentTime) ? state.currentTime : 0;
		const duration = typeof state?.duration === "number" && !Number.isNaN(state.duration) ? state.duration : 0;
		const curM = Math.floor(currentTime / 60);
		const curS = Math.floor(currentTime % 60);
		const durM = Math.floor(duration / 60);
		const durS = Math.floor(duration % 60);
		const timeStart = `  ${mint(`${curM.toString().padStart(2, "0")}:${curS.toString().padStart(2, "0")}`)} `;
		const timeEnd = ` ${muted(`${durM.toString().padStart(2, "0")}:${durS.toString().padStart(2, "0")}`)}`;

		const volume = typeof state?.volume === "number" && !Number.isNaN(state.volume) ? state.volume : 1;
		const volPct = Math.round(volume * 100);
		const volBadge = ` ${dim("[")}${yellow(`${volPct}%`)}${dim("]")}  `;

		const fixedTimeLen = calcVisibleWidth(timeStart) + calcVisibleWidth(timeEnd) + calcVisibleWidth(volBadge);
		const barWidth = Math.max(4, width - 2 - fixedTimeLen);

		const pct = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
		const filled = Math.max(0, Math.min(barWidth, Math.round(pct * barWidth)));
		const empty = Math.max(0, barWidth - filled);
		const progressBar = `${mint("━".repeat(filled))}${dim("─".repeat(empty))}`;

		const timelineRaw = `${timeStart}${progressBar}${timeEnd}${volBadge}`;
		const timelineRow = truncateAnsiAware(timelineRaw, width - 2);
		const timelinePad = Math.max(0, width - 2 - calcVisibleWidth(timelineRow));
		lines.push(`${border(g.v)}${timelineRow}${" ".repeat(timelinePad)}${border(g.v)}`);

		// 6. Línea: Aire antes de los controles
		lines.push(`${border(g.v)}${" ".repeat(Math.max(0, width - 2))}${border(g.v)}`);

		// 7. Línea: Controles de Reproducción Centrados con Espaciado Generoso
		const ctrlPrev = "[ ⏮  Prev ]";
		const ctrlPlay = isPlaying
			? "[ ⏸  Pausa ]"
			: "[ ▶  Play ]";
		const ctrlNext = "[ ⏭  Next ]";
		const gap = "  ";

		const rawRow1 = `${ctrlPrev}${gap}${ctrlPlay}${gap}${ctrlNext}`;
		const row1Len = calcVisibleWidth(rawRow1);
		const innerWidth = width - 2;
		const pad1 = Math.max(1, Math.floor((innerWidth - row1Len) / 2));

		const lineIndex1 = lines.length;
		let currentX1 = 1 + pad1;

		// Hitbox Prev
		this.hitboxes.push({
			line: lineIndex1,
			startX: currentX1,
			endX: currentX1 + calcVisibleWidth(ctrlPrev),
			action: () => player?.previous?.(),
		});
		currentX1 += calcVisibleWidth(ctrlPrev) + calcVisibleWidth(gap);

		// Hitbox Play/Pause
		this.hitboxes.push({
			line: lineIndex1,
			startX: currentX1,
			endX: currentX1 + calcVisibleWidth(ctrlPlay),
			action: () => player?.togglePlay?.(),
		});
		currentX1 += calcVisibleWidth(ctrlPlay) + calcVisibleWidth(gap);

		// Hitbox Next
		this.hitboxes.push({
			line: lineIndex1,
			startX: currentX1,
			endX: currentX1 + calcVisibleWidth(ctrlNext),
			action: () => player?.next?.(),
		});

		const styledRow1 = `${cyan(ctrlPrev)}${gap}${pinkBright(bolden(this.theme, ctrlPlay))}${gap}${cyan(ctrlNext)}`;
		const row1Trunc = truncateAnsiAware(" ".repeat(pad1) + styledRow1, width - 2);
		const padRight1 = Math.max(0, width - 2 - calcVisibleWidth(row1Trunc));
		lines.push(`${border(g.v)}${row1Trunc}${" ".repeat(padRight1)}${border(g.v)}`);

		// 8. Línea: Aire entre controles de reproducción y volumen
		lines.push(`${border(g.v)}${" ".repeat(Math.max(0, width - 2))}${border(g.v)}`);

		// 9. Línea: Controles de Volumen Centrados
		const ctrlVolDown = "[-] ";
		const volIcon = "🔊";
		const ctrlVolUp = " [+]";
		const gapVol = "   ";

		const rawRow2 = `${ctrlVolDown}${gapVol}${volIcon}${gapVol}${ctrlVolUp}`;
		const row2Len = calcVisibleWidth(rawRow2);
		const pad2 = Math.max(1, Math.floor((innerWidth - row2Len) / 2));

		const lineIndex2 = lines.length;
		let currentX2 = 1 + pad2;

		// Hitbox Vol Down
		this.hitboxes.push({
			line: lineIndex2,
			startX: currentX2,
			endX: currentX2 + calcVisibleWidth(ctrlVolDown),
			action: () => player?.setVolume?.(volPct - 10),
		});
		currentX2 += calcVisibleWidth(ctrlVolDown) + calcVisibleWidth(gapVol) + calcVisibleWidth(volIcon) + calcVisibleWidth(gapVol);

		// Hitbox Vol Up
		this.hitboxes.push({
			line: lineIndex2,
			startX: currentX2,
			endX: currentX2 + calcVisibleWidth(ctrlVolUp),
			action: () => player?.setVolume?.(volPct + 10),
		});

		const styledRow2 = `${yellow(ctrlVolDown)}${gapVol}${volIcon}${gapVol}${mint(ctrlVolUp)}`;
		const row2Trunc = truncateAnsiAware(" ".repeat(pad2) + styledRow2, width - 2);
		const padRight2 = Math.max(0, width - 2 - calcVisibleWidth(row2Trunc));
		lines.push(`${border(g.v)}${row2Trunc}${" ".repeat(padRight2)}${border(g.v)}`);

		// 9. Línea: Aire antes del separador de cola
		lines.push(`${border(g.v)}${" ".repeat(Math.max(0, width - 2))}${border(g.v)}`);

		// Separador hacia la Cola (Up Next)
		const queueHeader = width < 42 ? " 📜 Cola " : " 📜 A continuación (Up Next) ";
		const qHeaderSafe = truncateAnsiAware(queueHeader, Math.max(0, width - 2));
		const qFill = Math.max(0, width - 2 - calcVisibleWidth(qHeaderSafe));
		const qDivider = `${border(g.dividerL)}${gold(bolden(this.theme, qHeaderSafe))}${border(g.h.repeat(qFill))}${border(g.dividerR)}`;
		lines.push(qDivider);

		// 9. Lista de Tracks en Cola (Click to Play)
		const queue = Array.isArray(state?.queue) ? state.queue : [];
		if (queue.length === 0) {
			const emptyMsg = `  ${dim("La cola de reproducción está vacía")}`;
			const emptyPad = Math.max(0, width - 2 - calcVisibleWidth(emptyMsg));
			lines.push(`${border(g.v)}${emptyMsg}${" ".repeat(emptyPad)}${border(g.v)}`);
		} else {
			// Mostrar siempre hasta 15 canciones de la cola recibidas desde la extensión
			const displayQueue = queue.slice(0, 15);

			// Encontrar exactamente el índice de la canción que está sonando (a lo sumo 1)
			const curTitle = cleanTitle(state?.title);
			let playingIndex = -1;

			if (curTitle) {
				playingIndex = displayQueue.findIndex((t) => {
					if (t?.isCurrent) return true;
					const thisTitle = cleanTitle(t?.title);
					return thisTitle && (curTitle === thisTitle || curTitle.startsWith(thisTitle) || thisTitle.startsWith(curTitle));
				});
			}

			for (let i = 0; i < displayQueue.length; i++) {
				const track = displayQueue[i];
				const isTrackPlaying = (i === playingIndex);

				const qIndex = (i + 1).toString().padStart(2, "0");
				const trackTitle = track?.title ?? "Desconocido";
				const trackArtist = track?.artist ? `  ${dim("·")}  ${cyan(track.artist)}` : "";

				let trackLineRaw = "";
				if (isTrackPlaying) {
					// Destacado vibrante con micrófono 🎙️ ÚNICAMENTE en la canción que está sonando
					trackLineRaw = `  ${mint("🎙️")}  ${mint(bolden(this.theme, trackTitle))}${trackArtist}`;
				} else {
					trackLineRaw = `  ${gold(qIndex)}  ${textFg(trackTitle)}${trackArtist}`;
				}

				const trackLineTrunc = truncateAnsiAware(trackLineRaw, width - 4);
				const trackPad = Math.max(0, width - 2 - calcVisibleWidth(trackLineTrunc));

				const trackRowIndex = lines.length;
				this.hitboxes.push({
					line: trackRowIndex,
					startX: 1,
					endX: width - 2,
					action: () => player?.playQueueIndex?.(track?.index ?? i),
				});

				lines.push(`${border(g.v)}${trackLineTrunc}${" ".repeat(trackPad)}${border(g.v)}`);
			}
		}

		// Borde inferior
		lines.push(`${border(g.bl)}${border(g.h.repeat(Math.max(0, width - 2)))}${border(g.br)}`);

		return lines;
	}
}
