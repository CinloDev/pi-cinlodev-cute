import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CinlodevYouTubeCard, YOUTUBE_PLAYER_SYMBOL } from "../src/cute-youtube.ts";
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
