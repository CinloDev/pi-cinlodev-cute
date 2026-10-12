import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CinlodevYouTubeCard, YOUTUBE_PLAYER_SYMBOL, computeCoverColumns } from "../src/cute-youtube.ts";
import { resetAll } from "./test-helpers.ts";

test("CinlodevYouTubeCard - renders offline state cleanly with correct borders and visible width", () => {
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
	let rendersRequested = 0;
	const mockTui: any = {
		requestRender: () => {
			rendersRequested++;
		},
	};
	const card = new CinlodevYouTubeCard(mockTui);

	const width = 45;
	const lines = card.render(width, 20);
	assert.ok(lines.length >= 4, "Offline render debe devolver al menos 4 líneas");
	assert.ok(lines[0].includes("YouTube Music (Offline)"), "Debe indicar modo Offline");
	assert.ok(lines.some((l) => l.includes("Esperando conexión de Chrome")), "Debe mostrar aviso de espera");

	for (const line of lines) {
		assert.equal(visibleWidth(line), width, `Cada línea debe medir exactamente ${width} de ancho visible`);
	}
	card.dispose();
});

test("CinlodevYouTubeCard - renders connected state with music info, scrubber, controls and queue", () => {
	let playClicked = false;
	let prevClicked = false;
	let nextClicked = false;
	let volumeSet: number | undefined;
	let queueIndexPlayed: number | undefined;
	let queueIndexRemoved: number | undefined;
	let likesPlayed = false;
	let searchQuery: string | undefined;

	(globalThis as any)[YOUTUBE_PLAYER_SYMBOL] = {
		getState: () => ({
			status: "playing",
			connectedClients: 1,
			title: "Bohemian Rhapsody",
			artist: "Queen • Bohemian Rhapsody",
			currentTime: 120,
			duration: 354,
			volume: 0.8,
			queue: [
				{ title: "Don't Stop Me Now", artist: "Queen", duration: "03:29", index: 1 },
				{ title: "Radio Ga Ga", artist: "Queen", duration: "05:43", index: 2 },
			],
		}),
		on: () => () => {},
		togglePlay: () => {
			playClicked = true;
		},
		previous: () => {
			prevClicked = true;
		},
		next: () => {
			nextClicked = true;
		},
		setVolume: (v: number) => {
			volumeSet = v;
		},
		playQueueIndex: (i: number) => {
			queueIndexPlayed = i;
		},
		removeQueueIndex: (i: number) => {
			queueIndexRemoved = i;
		},
		playLikes: () => {
			likesPlayed = true;
		},
		search: (q: string) => {
			searchQuery = q;
		},
	};

	let rendersRequested = 0;
	const mockTui: any = {
		requestRender: () => {
			rendersRequested++;
		},
	};
	const card = new CinlodevYouTubeCard(mockTui);
	const width = 50;
	const lines = card.render(width, 30);

	assert.ok(lines.some((l) => l.includes("YouTube Music") && !l.includes("Offline")));
	assert.ok(lines.some((l) => l.includes("SONANDO")));
	assert.ok(lines.some((l) => l.includes("Bohemian Rhapsody")));
	assert.ok(lines.some((l) => l.includes("Queen")));
	assert.ok(lines.some((l) => l.includes("02:00") && l.includes("05:54")));
	assert.ok(lines.some((l) => l.includes("Radio Ga Ga")));
	assert.ok(lines.some((l) => l.includes("COLA")));
	assert.ok(lines.some((l) => l.includes("Don't Stop Me Now")));
	assert.ok(lines.some((l) => l.includes("03:29")), "Debe mostrar la duración en la cola");

	for (const line of lines) {
		assert.equal(visibleWidth(line), width, `Cada línea debe medir exactamente ${width} de ancho visible`);
	}

	// Click en Play/Pausa (fila 9)
	const clickPlay = card.handleRailClick(9, "left", 22);
	assert.ok(clickPlay, "Click en Play/Pausa debe manejarse");
	assert.ok(playClicked, "togglePlay del reproductor debe ejecutarse");

	// Click en Prev (fila 9)
	const clickPrev = card.handleRailClick(9, "left", 8);
	assert.ok(clickPrev, "Click en Prev debe manejarse");
	assert.ok(prevClicked, "previous del reproductor debe ejecutarse");

	// Click en Next (fila 9)
	const clickNext = card.handleRailClick(9, "left", 36);
	assert.ok(clickNext, "Click en Next debe manejarse");
	assert.ok(nextClicked, "next del reproductor debe ejecutarse");

	// Click en reproducir tema de la cola (fila 16)
	const clickQueue = card.handleRailClick(16, "left", 15);
	assert.ok(clickQueue, "Click en track de la cola debe manejarse");
	assert.equal(queueIndexPlayed, 1, "playQueueIndex debe recibir el índice 1");

	// Scroll con rueda
	assert.equal(card.handleRailWheel(0), false);

	card.dispose();
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
});

test("CinlodevYouTubeCard - handles invalid or NaN player states gracefully without throwing", () => {
	(globalThis as any)[YOUTUBE_PLAYER_SYMBOL] = {
		getState: () => ({
			status: "playing",
			connectedClients: 1,
			title: undefined,
			artist: undefined,
			currentTime: NaN,
			duration: NaN,
			volume: NaN,
			queue: null,
		}),
	};

	const mockTui: any = { requestRender: () => {} };
	const card = new CinlodevYouTubeCard(mockTui);
	const width = 45;
	assert.doesNotThrow(() => {
		const lines = card.render(width, 20);
		for (const line of lines) {
			assert.equal(visibleWidth(line), width);
		}
	});

	card.dispose();
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
});

test("CinlodevYouTubeCard - section SONANDO accordion toggle and Kitty cover rendering", () => {
	const samplePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
	let clearCalled = false;

	(globalThis as any)[YOUTUBE_PLAYER_SYMBOL] = {
		getState: () => ({
			status: "playing",
			connectedClients: 1,
			title: "Prófugos",
			artist: "Soda Stereo",
			currentTime: 45,
			duration: 300,
			volume: 0.7,
			thumbnailBase64: samplePngBase64,
			queue: [
				{ title: "Prófugos", artist: "Soda Stereo", index: 0, isCurrent: true },
				{ title: "Cuando Pase el Temblor", artist: "Soda Stereo", index: 1 },
			],
		}),
		clearQueue: () => {
			clearCalled = true;
		},
	};

	const mockTui: any = { requestRender: () => {} };
	const card = new CinlodevYouTubeCard(mockTui);
	const width = 50;

	// 1. Initial render has SONANDO expanded
	assert.equal(card.sections.nowPlaying, true);
	const expandedLines = card.render(width);
	assert.ok(expandedLines.some((l) => l.includes("Prófugos")));
	assert.ok(expandedLines.some((l) => l.includes("Cuando Pase el Temblor")));

	// 2. Click on line 1 (header of SONANDO) collapses it
	card.handleRailClick(1, "left", 10);
	assert.equal(card.sections.nowPlaying, false);
	const collapsedLines = card.render(width);
	assert.ok(!collapsedLines.some((l) => l.includes("05:00")));
	assert.ok(collapsedLines.length < expandedLines.length);

	// 3. Click again re-expands SONANDO
	card.handleRailClick(1, "left", 10);
	assert.equal(card.sections.nowPlaying, true);
	const reExpandedLines = card.render(width);
	assert.ok(reExpandedLines.some((l) => l.includes("05:00")));

	card.dispose();
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
});


test("CinlodevYouTubeCard - clearCover and dispose emit deleteKittyImage to terminal", () => {
	let writes: string[] = [];
	const mockTerminal: any = {
		write: (data: string) => writes.push(data),
	};
	const mockTui: any = {
		terminal: mockTerminal,
		requestRender: () => {},
	};

	const card = new CinlodevYouTubeCard(mockTui);
	(card as any).activeCoverImageId = 4242;

	card.clearCover();
	assert.ok(writes.some((w) => w.includes("i=4242")), "clearCover debe emitir deleteKittyImage con el ID activo");
	assert.equal((card as any).activeCoverImageId, undefined);

	// dispose también debe ser idempotente
	writes = [];
	(card as any).activeCoverImageId = 9999;
	card.dispose();
	assert.ok(writes.some((w) => w.includes("i=9999")), "dispose debe emitir deleteKittyImage");
});

test("computeCoverColumns - adapts dynamically for 1:1, widescreen 16:9 and invalid dimensions", () => {
	// 1:1 portada cuadrada tradicional de álbum
	assert.equal(computeCoverColumns({ widthPx: 500, heightPx: 500 }), 7);
	assert.equal(computeCoverColumns({ widthPx: 128, heightPx: 128 }), 7);

	// 16:9 widescreen miniatura de video musical en YouTube
	const cols169 = computeCoverColumns({ widthPx: 1280, heightPx: 720 });
	assert.equal(cols169, 12, "Debe calcular 12 columnas para aspect ratio 16:9");

	// 4:3 formato estándar intermedio
	const cols43 = computeCoverColumns({ widthPx: 640, heightPx: 480 });
	assert.equal(cols43, 9, "Debe calcular 9 columnas para aspect ratio 4:3");

	// Fallback para dimensiones ausentes o anómalas
	assert.equal(computeCoverColumns(undefined), 7);
	assert.equal(computeCoverColumns({ widthPx: 0, heightPx: 100 }), 7);
	assert.equal(computeCoverColumns({ widthPx: 100, heightPx: 0 }), 7);
});

test("CinlodevYouTubeCard - widescreen cover expands placeholder so song title is never obscured", () => {
	// Generar un PNG mínimo válido con dimensiones 16:9 (160x90) para el test
	// Header PNG: 8 bytes + IHDR chunk (13 bytes: w=160, h=90, bitDepth=8, colorType=2...)
	const ihdrBuf = Buffer.alloc(33);
	ihdrBuf.write("\x89PNG\r\n\x1a\n", 0, "binary");
	ihdrBuf.writeUInt32BE(13, 8); // chunk length
	ihdrBuf.write("IHDR", 12);
	ihdrBuf.writeUInt32BE(160, 16); // width = 160
	ihdrBuf.writeUInt32BE(90, 20);  // height = 90
	ihdrBuf.writeUInt8(8, 24);      // bit depth
	ihdrBuf.writeUInt8(2, 25);      // color type (truecolor)

	(globalThis as any)[YOUTUBE_PLAYER_SYMBOL] = {
		getState: () => ({
			status: "playing",
			connectedClients: 1,
			title: "Jamás abandoné",
			artist: "Laura Pausini",
			currentTime: 164,
			duration: 210,
			volume: 0.8,
			thumbnailBase64: ihdrBuf.toString("base64"),
		}),
	};

	const mockTui: any = { requestRender: () => {} };
	const card = new CinlodevYouTubeCard(mockTui);
	const lines = card.render(50);

	// Comprobar que en la línea donde está el título, la secuencia Kitty tiene c=12 y el placeholder tiene 12 espacios
	const titleLine = lines.find((l) => l.includes("Jamás abandoné"));
	assert.ok(titleLine, "Debe renderizar la línea con el título");
	assert.ok(titleLine.includes("c=12"), "Debe emitir c=12 para la imagen widescreen");
	assert.ok(titleLine.includes("r=3"), "Debe emitir r=3");
	assert.ok(titleLine.includes(" ".repeat(12)), "El placeholder debe tener 12 espacios de resguardo");

	card.dispose();
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
});

test("CinlodevYouTubeCard - pause status icon includes extra spacing so title never sticks to icon", () => {
	(globalThis as any)[YOUTUBE_PLAYER_SYMBOL] = {
		getState: () => ({
			status: "paused",
			connectedClients: 1,
			title: "Sólo para ti",
			artist: "Camila",
			currentTime: 180,
			duration: 188,
			volume: 0.8,
		}),
	};

	const mockTui: any = { requestRender: () => {} };
	const card = new CinlodevYouTubeCard(mockTui);
	const lines = card.render(50);

	const titleLine = lines.find((l) => l.includes("Sólo para ti"));
	assert.ok(titleLine, "Debe renderizar la línea con el título");
	assert.ok(titleLine.includes("⏸  "), "El ícono de pausa debe incluir 2 espacios para no pegarse al título en terminales");

	card.dispose();
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
});
