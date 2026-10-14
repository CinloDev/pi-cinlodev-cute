import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
	getCapabilities,
	setCapabilityOverrides,
	encodeKitty,
	deleteKittyImage,
	deleteAllKittyImages,
} from "@earendil-works/pi-tui";
import { registerKittyImageMetadata } from "@earendil-works/pi-tui/dist/terminal-image.js";
import { cuteGlyphs, safeFg, bolden } from "../cute-theme.ts";
import { calcVisibleWidth, truncateAnsiAware } from "../cute-transcript.ts";
import {
	YOUTUBE_PLAYER_SYMBOL,
	type ClickableHitbox,
	cleanTitle,
	cleanArtist,
} from "./youtube-types.ts";
import { getCoverData, computeCoverColumns } from "./youtube-cover.ts";

/**
 * Tarjeta interactiva del reproductor de YouTube Music para la sidebar CUTE.
 * Estructura modular con acordeones colapsables:
 * - 1. ♪ SONANDO (Portada Kitty 1:1 / fallback vinilo, Scrubber, Controles, Preview próximo)
 * - 2. ≡ COLA (Tracks, micrófono en canción activa, duración a la derecha)
 */
export class CinlodevYouTubeCard {
	private tui: TUI;
	private theme?: Theme;
	private ctx?: any;
	private hitboxes: ClickableHitbox[] = [];
	private unsubscribe?: () => void;
	private activeCoverImageId?: number;

	// Estado de acordeones modulares (expandido/colapsado)
	public sections = {
		nowPlaying: true,
		queue: true,
	};
	public queueScrollOffset = 0;

	constructor(tui: TUI, theme?: Theme, ctx?: any) {
		this.tui = tui;
		this.theme = theme;
		this.ctx = ctx;
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
		this.clearCover();
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
	}

	public clearCover(specificId?: number): void {
		const id = specificId ?? this.activeCoverImageId;
		if (id !== undefined) {
			try {
				if (typeof this.tui?.terminal?.write === "function") {
					this.tui.terminal.write(deleteKittyImage(id));
				}
			} catch {}
			if (!specificId || specificId === this.activeCoverImageId) {
				this.activeCoverImageId = undefined;
			}
		}
	}

	public invalidate(): void {}

	private getPlayer(): any {
		return (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
	}

	public handleRailWheel(delta: number): boolean {
		if (delta === 0) return false;
		const player = this.getPlayer();
		const state = player?.getState?.();
		const queue = Array.isArray(state?.queue) ? state.queue : [];
		if (queue.length <= 10) return false;

		const maxOffset = Math.max(0, queue.length - 10);
		const newOffset = Math.max(0, Math.min(maxOffset, this.queueScrollOffset + (delta > 0 ? 1 : -1)));
		if (newOffset !== this.queueScrollOffset) {
			this.queueScrollOffset = newOffset;
			this.tui.requestRender();
			return true;
		}
		return false;
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

	public render(width: number, _availableHeight?: number): string[] {
		this.hitboxes = [];
		this.ensureSubscribed();
		const player = this.getPlayer();
		const state = player?.getState?.();
		const g = cuteGlyphs(this.theme);

		const border = (s: string): string => (this.theme ? safeFg(this.theme, "border", s) : s);
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
		const innerWidth = width - 2;

		const boxLine = (content: string, right = ""): string => {
			const rightW = calcVisibleWidth(right);
			const maxContentW = Math.max(0, innerWidth - (rightW > 0 ? rightW + 1 : 0));
			const truncContent = truncateAnsiAware(content, maxContentW);
			const contentW = calcVisibleWidth(truncContent);
			const padLen = Math.max(0, innerWidth - contentW - rightW);
			const pad = " ".repeat(padLen);
			return `${border(g.v)}${truncContent}${pad}${right}${border(g.v)}`;
		};

		// Header del marco principal
		const isYoutubeStandard = state?.platform === "youtube";
		const brandName = isYoutubeStandard ? "YouTube" : "YouTube Music";
		const titleStr = isConnected ? ` 🎵 ${brandName} ` : ` 🎵 ${brandName} (Offline) `;
		const hLine = g.h.repeat(Math.max(0, width - 2 - calcVisibleWidth(titleStr)));
		lines.push(`${border(g.tl)}${accent(bolden(this.theme, titleStr))}${border(hLine)}${border(g.tr)}`);

		if (!isConnected) {
			this.clearCover();
			lines.push(boxLine(""));
			lines.push(boxLine(`  ${cyan("✦")} ${gold("Esperando conexión de Chrome...")}`));
			lines.push(boxLine(`    ${muted("Abrí")} ${accent("youtube.com")} ${muted("o")} ${accent("music.youtube.com")}`));
			lines.push(boxLine(""));
			lines.push(`${border(g.bl)}${border(g.h.repeat(Math.max(0, width - 2)))}${border(g.br)}`);
			return lines;
		}

		// =========================================================================
		// 1. TARJETA MODULAR: ♪ SONANDO
		// =========================================================================
		const sonandoExpanded = this.sections.nowPlaying;
		const sonandoArrow = sonandoExpanded ? "▾" : "▸";
		const sonandoLabel = ` ${sonandoArrow} ♪ SONANDO `;
		const sonandoFill = Math.max(0, width - 2 - calcVisibleWidth(sonandoLabel));
		const sonandoHeaderRow = `${border(g.dividerL)}${gold(bolden(this.theme, sonandoLabel))}${border(g.h.repeat(sonandoFill))}${border(g.dividerR)}`;

		const sonandoHeaderIndex = lines.length;
		this.hitboxes.push({
			line: sonandoHeaderIndex,
			startX: 1,
			endX: width - 2,
			action: () => {
				this.sections.nowPlaying = !this.sections.nowPlaying;
			},
		});
		lines.push(sonandoHeaderRow);

		if (sonandoExpanded) {
			lines.push(boxLine(""));

			// Renderizado de portada (Kitty graphics si está disponible, o fallback estético)
			const coverData = getCoverData(state);
			let kittySequence = "";
			let kittyCols = 0;
			// Forzar que la terminal soporte Kitty graphics para pintar la portada
			try {
				setCapabilityOverrides({ images: "kitty" });
			} catch {}
			const caps = getCapabilities?.() ?? ({} as any);

			if (caps.images === "kitty" && coverData) {
				try {
					const targetCols = computeCoverColumns(coverData.dimensions, innerWidth);
					if (coverData.imageId) {
						registerKittyImageMetadata({
							imageId: coverData.imageId,
							columns: targetCols,
							rows: 3,
							widthPx: coverData.dimensions?.widthPx ?? 48,
							heightPx: coverData.dimensions?.heightPx ?? 48,
						});
					}
					// Especificar columns y rows exactas para preservar la relación de aspecto sin solapar el texto
					kittySequence = encodeKitty(coverData.base64, {
						columns: targetCols,
						rows: 3,
						imageId: coverData.imageId,
						moveCursor: false,
					});
					kittyCols = targetCols;
					if (this.activeCoverImageId && this.activeCoverImageId !== coverData.imageId) {
						this.clearCover(this.activeCoverImageId);
					}
					this.activeCoverImageId = coverData.imageId;
				} catch {}
			} else {
				this.clearCover();
			}

			const statusIcon = isPlaying ? mint("▶ ") : yellow("⏸  ");
			const songTitle = state?.title || "Desconocido";
			const artistName = cleanArtist(state?.artist, songTitle);

			// Espacio seguro disponible a la derecha de la portada para no desbordar el marco:
			const coverCols = kittyCols || 7;
			const contentRightBudget = Math.max(10, innerWidth - 3 - coverCols - 4);
			const titleTrunc = truncateAnsiAware(songTitle, contentRightBudget);
			const artistTrunc = truncateAnsiAware(artistName, contentRightBudget);

			if (kittySequence && kittyCols > 0) {
				// Cover con Kitty graphics: 7 columnas de resguardo para portada cuadrada 1:1 x 3 filas
				const coverPlaceholder = " ".repeat(kittyCols);
				const line1Left = `   ${kittySequence}${coverPlaceholder}  ${statusIcon}${pinkBright(bolden(this.theme, titleTrunc))}`;
				const line2Left = `   ${coverPlaceholder}  ${dim("👤")} ${cyan(artistTrunc)}`;
				const line3Left = `   ${coverPlaceholder}`;
				lines.push(boxLine(line1Left));
				lines.push(boxLine(line2Left));
				lines.push(boxLine(line3Left));
			} else {
				// Fallback estético de vinilo / marco de portada cuadrado (7 columnas x 3 filas)
				const line1Left = `   ┌─────┐  ${statusIcon}${pinkBright(bolden(this.theme, titleTrunc))}`;
				const line2Left = `   │  💿 │  ${dim("👤")} ${cyan(artistTrunc)}`;
				const line3Left = `   └─────┘`;
				lines.push(boxLine(line1Left));
				lines.push(boxLine(line2Left));
				lines.push(boxLine(line3Left));
			}

			lines.push(boxLine(""));

			// Timeline & Scrubber con tiempos en los extremos
			const currentTime = typeof state?.currentTime === "number" && !Number.isNaN(state.currentTime) ? state.currentTime : 0;
			const duration = typeof state?.duration === "number" && !Number.isNaN(state.duration) ? state.duration : 0;
			const curM = Math.floor(currentTime / 60);
			const curS = Math.floor(currentTime % 60);
			const durM = Math.floor(duration / 60);
			const durS = Math.floor(duration % 60);
			const timeStart = `  ${mint(`${curM.toString().padStart(2, "0")}:${curS.toString().padStart(2, "0")}`)} `;
			const timeEnd = ` ${muted(`${durM.toString().padStart(2, "0")}:${durS.toString().padStart(2, "0")}`)}  `;

			const volume = typeof state?.volume === "number" && !Number.isNaN(state.volume) ? state.volume : 1;
			const volPct = Math.round(volume * 100);

			const fixedTimeLen = calcVisibleWidth(timeStart) + calcVisibleWidth(timeEnd);
			const barWidth = Math.max(4, width - 2 - fixedTimeLen);

			const pct = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
			const filled = Math.max(0, Math.min(barWidth, Math.round(pct * barWidth)));
			const empty = Math.max(0, barWidth - filled);
			const progressBar = `${mint("━".repeat(filled))}${dim("─".repeat(empty))}`;

			lines.push(boxLine(`${timeStart}${progressBar}${timeEnd}`));
			lines.push(boxLine(""));

			// Controles de Reproducción Centrados
			const ctrlPrev = "[ ⏮  Prev ]";
			const ctrlPlay = isPlaying ? "[ ⏸  Pausa ]" : "[ ▶  Play ]";
			const ctrlNext = "[ ⏭  Next ]";
			const gap = "  ";

			const rawRow1 = `${ctrlPrev}${gap}${ctrlPlay}${gap}${ctrlNext}`;
			const row1Len = calcVisibleWidth(rawRow1);
			const padTransport = Math.max(1, Math.floor((innerWidth - row1Len) / 2));

			const lineIndexTransport = lines.length;
			let currentX1 = 1 + padTransport;

			// Hitbox Prev (con margen de tolerancia)
			const prevW = calcVisibleWidth(ctrlPrev);
			this.hitboxes.push({
				line: lineIndexTransport,
				startX: Math.max(1, currentX1 - 1),
				endX: currentX1 + prevW,
				action: () => player?.previous?.(),
			});
			currentX1 += prevW + calcVisibleWidth(gap);

			// Hitbox Play/Pause (con margen de tolerancia para captura exacta)
			const playW = calcVisibleWidth(ctrlPlay);
			this.hitboxes.push({
				line: lineIndexTransport,
				startX: currentX1 - 1,
				endX: currentX1 + playW + 1,
				action: () => player?.togglePlay?.(),
			});
			currentX1 += playW + calcVisibleWidth(gap);

			// Hitbox Next (con margen de tolerancia)
			const nextW = calcVisibleWidth(ctrlNext);
			this.hitboxes.push({
				line: lineIndexTransport,
				startX: currentX1 - 1,
				endX: currentX1 + nextW + 1,
				action: () => player?.next?.(),
			});

			const styledRow1 = `${cyan(ctrlPrev)}${gap}${pinkBright(bolden(this.theme, ctrlPlay))}${gap}${cyan(ctrlNext)}`;
			lines.push(boxLine(" ".repeat(padTransport) + styledRow1));
			lines.push(boxLine(""));

			// Controles de Modo & Volumen: [ 🔁 ] [ - ] 🔊 [ + ] [ 🔀 ] [ 📺 ]
			const repMode = state?.repeatMode || "NONE";
			const isShuffle = Boolean(state?.shuffle);
			const isPip = Boolean(state?.isPip);

			const ctrlRepeat = repMode === "ONE" ? "[ 🔂 ]" : "[ 🔁 ]";
			const ctrlVolDown = "[ - ]";
			const volIcon = " 🔊 ";
			const ctrlVolUp = "[ + ]";
			const ctrlShuffle = "[ 🔀 ]";
			const ctrlPip = "[ 📺 ]";
			const gapCtrl = " ";

			const rawRow2 = `${ctrlRepeat}${gapCtrl}${ctrlVolDown}${volIcon}${ctrlVolUp}${gapCtrl}${ctrlShuffle}${gapCtrl}${ctrlPip}`;
			const row2Len = calcVisibleWidth(rawRow2);
			const padRow2 = Math.max(1, Math.floor((innerWidth - row2Len) / 2));

			const lineIndexRow2 = lines.length;
			let currentX2 = 1 + padRow2;

			// Hitbox Repeat
			this.hitboxes.push({
				line: lineIndexRow2,
				startX: currentX2,
				endX: currentX2 + calcVisibleWidth(ctrlRepeat),
				action: () => player?.toggleRepeat?.(),
			});
			currentX2 += calcVisibleWidth(ctrlRepeat) + calcVisibleWidth(gapCtrl);

			// Hitbox Vol Down
			this.hitboxes.push({
				line: lineIndexRow2,
				startX: currentX2,
				endX: currentX2 + calcVisibleWidth(ctrlVolDown),
				action: () => player?.setVolume?.(volPct - 10),
			});
			currentX2 += calcVisibleWidth(ctrlVolDown) + calcVisibleWidth(volIcon);

			// Hitbox Vol Up
			this.hitboxes.push({
				line: lineIndexRow2,
				startX: currentX2,
				endX: currentX2 + calcVisibleWidth(ctrlVolUp),
				action: () => player?.setVolume?.(volPct + 10),
			});
			currentX2 += calcVisibleWidth(ctrlVolUp) + calcVisibleWidth(gapCtrl);

			// Hitbox Shuffle
			this.hitboxes.push({
				line: lineIndexRow2,
				startX: currentX2,
				endX: currentX2 + calcVisibleWidth(ctrlShuffle),
				action: () => player?.toggleShuffle?.(),
			});
			currentX2 += calcVisibleWidth(ctrlShuffle) + calcVisibleWidth(gapCtrl);

			// Hitbox PiP (Ventana flotante de video)
			this.hitboxes.push({
				line: lineIndexRow2,
				startX: currentX2,
				endX: currentX2 + calcVisibleWidth(ctrlPip),
				action: () => {
					if (typeof player?.togglePip === "function") {
						player.togglePip();
					} else {
						player?.dispatchCommand?.("TOGGLE_PIP");
					}
				},
			});

			const styledRepeat = repMode === "ONE" ? pinkBright(bolden(this.theme, ctrlRepeat)) : repMode === "ALL" ? mint(bolden(this.theme, ctrlRepeat)) : dim(ctrlRepeat);
			const styledShuffle = isShuffle ? mint(bolden(this.theme, ctrlShuffle)) : dim(ctrlShuffle);
			const styledPip = isPip ? pinkBright(bolden(this.theme, ctrlPip)) : dim(ctrlPip);
			const styledRow2 = `${styledRepeat}${gapCtrl}${yellow(ctrlVolDown)}${volIcon}${mint(ctrlVolUp)}${gapCtrl}${styledShuffle}${gapCtrl}${styledPip}`;
			lines.push(boxLine(" ".repeat(padRow2) + styledRow2));
			lines.push(boxLine(""));

			// Preview del tema que sigue: ↳ ${state.queue[1]?.title || "Fin de cola"}
			const nextTitle = state?.queue?.[1]?.title || "Fin de cola";
			const nextTrackRow = `  ${dim("↳")} ${muted("Próximo:")} ${cyan(nextTitle)}`;
			lines.push(boxLine(nextTrackRow));
			lines.push(boxLine(""));
		} else {
			this.clearCover();
		}

		// =========================================================================
		// 2. TARJETA MODULAR: ≡ COLA (Up Next)
		// =========================================================================
		const queue = Array.isArray(state?.queue) ? state.queue : [];
		const colaExpanded = this.sections.queue;
		const colaArrow = colaExpanded ? "▾" : "▸";
		const colaLabel = width < 42 ? ` ${colaArrow} ≡ COLA (${queue.length}) ` : ` ${colaArrow} ≡ COLA (${queue.length} temas) `;
		const colaFill = Math.max(0, width - 2 - calcVisibleWidth(colaLabel));
		const colaHeaderRow = `${border(g.dividerL)}${gold(bolden(this.theme, colaLabel))}${border(g.h.repeat(colaFill))}${border(g.dividerR)}`;

		const colaHeaderIndex = lines.length;
		this.hitboxes.push({
			line: colaHeaderIndex,
			startX: 1,
			endX: width - 2,
			action: () => {
				this.sections.queue = !this.sections.queue;
			},
		});
		lines.push(colaHeaderRow);

		if (colaExpanded) {
			if (queue.length === 0) {
				lines.push(boxLine(`  ${dim("La cola de reproducción está vacía")}`));
			} else {
				const maxVisible = 12;
				const maxOffset = Math.max(0, queue.length - maxVisible);
				if (this.queueScrollOffset > maxOffset) {
					this.queueScrollOffset = maxOffset;
				}
				const visibleQueue = queue.slice(this.queueScrollOffset, this.queueScrollOffset + maxVisible);

				const curTitle = cleanTitle(state?.title);
				let playingIndex = -1;

				if (curTitle) {
					playingIndex = queue.findIndex((t: any) => {
						if (t?.isCurrent) return true;
						const thisTitle = cleanTitle(t?.title);
						return thisTitle && (curTitle === thisTitle || curTitle.startsWith(thisTitle) || thisTitle.startsWith(curTitle));
					});
				}

				for (let i = 0; i < visibleQueue.length; i++) {
					const track = visibleQueue[i];
					const realIndex = this.queueScrollOffset + i;
					const isTrackPlaying = realIndex === playingIndex;

					const qIndex = (realIndex + 1).toString().padStart(2, "0");
					const trackTitle = track?.title ?? "Desconocido";
					const artistClean = cleanArtist(track?.artist, trackTitle);
					const trackArtist = artistClean ? `  ${dim("·")}  ${cyan(artistClean)}` : "";

					let trackLeft = "";
					if (isTrackPlaying) {
						trackLeft = `  ${mint("🎙️")}  ${mint(bolden(this.theme, trackTitle))}${trackArtist}`;
					} else {
						trackLeft = `  ${gold(qIndex)}  ${textFg(trackTitle)}${trackArtist}`;
					}

					// Right side: duration únicamente (alineado al extremo derecho en lugar de [×])
					const durStr = track?.duration ? `${dim(track.duration)} ` : "";

					const trackRowIndex = lines.length;

					// Hitbox para reproducir el track (toda la fila completa interactiva)
					this.hitboxes.push({
						line: trackRowIndex,
						startX: 1,
						endX: width - 2,
						action: () => player?.playQueueIndex?.(track?.index ?? realIndex),
					});

					lines.push(boxLine(trackLeft, durStr));
				}

				// Indicador de scroll de cola si hay más elementos
				if (queue.length > maxVisible) {
					const remaining = queue.length - (this.queueScrollOffset + visibleQueue.length);
					const infoParts: string[] = [];
					if (this.queueScrollOffset > 0) infoParts.push(`▲ ${this.queueScrollOffset} arriba`);
					if (remaining > 0) infoParts.push(`▼ ${remaining} abajo`);
					const scrollInd = `  ${dim(`... ${infoParts.join(" · ")} (wheel scroll)`)}`;
					lines.push(boxLine(scrollInd));
				}
			}
		}

		// Borde inferior
		lines.push(`${border(g.bl)}${border(g.h.repeat(Math.max(0, width - 2)))}${border(g.br)}`);

		return lines;
	}
}
