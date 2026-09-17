import test from "node:test";
import assert from "node:assert/strict";
import {
	isCuteLiveBashActive,
	setCuteLiveBashActive,
	renderCuteBashBox,
	CuteBashCardComponent,
	isBashExecutionError,
	type BashRenderState,
} from "../src/cute-live-bash.ts";
import { formatTranscriptChildren, isBashComponent } from "../src/cute-transcript.ts";
import { stripAnsi } from "../src/cute-theme.ts";

test("CuteLiveBash - isBashExecutionError detects errors", () => {
	assert.equal(isBashExecutionError(true, "some text"), true);
	assert.equal(isBashExecutionError(false, "Command exited with code 1"), true);
	assert.equal(isBashExecutionError(false, "Command was aborted"), true);
	assert.equal(isBashExecutionError(false, "Command timed out"), true);
	assert.equal(isBashExecutionError(false, "timed out after 120000ms"), true);
	assert.equal(isBashExecutionError(false, "everything went fine"), false);
});

test("CuteLiveBash - renderCuteBashBox retains full CUTE frame intact", () => {
	const state: BashRenderState = {
		startedAt: Date.now() - 3000,
		endedAt: Date.now(),
		hasResult: true,
		isPartial: false,
		isError: false,
	};

	const lines = renderCuteBashBox(
		"echo 'hello world'",
		"hello world\nline 2\nline 3",
		state,
		false,
		60,
	);

	assert.ok(lines.length >= 3, "Debe tener al menos top, body y bottom");
	const top = stripAnsi(lines[0]);
	const bottom = stripAnsi(lines[lines.length - 1]);

	// Top frame: ╔═ >_ bash ═...═╗
	assert.ok(top.startsWith("╔═"), "El borde superior debe empezar con ╔═");
	assert.ok(top.includes(">_ bash"), "El marco debe contener el título >_ bash");
	assert.ok(top.endsWith("╗"), "El borde superior debe terminar con ╗");

	// Body lines: ║ ... ║
	for (let i = 1; i < lines.length - 1; i++) {
		const line = stripAnsi(lines[i]);
		assert.ok(line.startsWith("║"), `Línea ${i} debe empezar con ║`);
		assert.ok(line.endsWith("║"), `Línea ${i} debe terminar con ║`);
	}

	// Bottom frame: ╚═...═╝
	assert.ok(bottom.startsWith("╚═"), "El borde inferior debe empezar con ╚═");
	assert.ok(bottom.endsWith("╝"), "El borde inferior debe terminar con ╝");
});

test("CuteLiveBash - collapsed preview limits to 5 lines + status, expanded shows all", () => {
	const output10Lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n");
	const state: BashRenderState = {
		startedAt: Date.now() - 2000,
		endedAt: Date.now(),
		hasResult: true,
		isPartial: false,
		isError: false,
	};

	// 1. Colapsado (expanded: false)
	const collapsedLines = renderCuteBashBox("generate-data", output10Lines, state, false, 70);
	// Content lines adentro: cmdHeader (1) + preview (5) + status (1) = 7 + top + bottom = 9 líneas
	assert.equal(collapsedLines.length, 9);
	const joinedCollapsed = collapsedLines.map((l) => stripAnsi(l)).join("\n");
	assert.ok(!joinedCollapsed.includes("line-1\n"), "line-1 no debe aparecer en colapsado de 10 líneas");
	assert.ok(!joinedCollapsed.includes("line-5\n"), "line-5 no debe aparecer");
	assert.ok(joinedCollapsed.includes("line-6"), "line-6 debe aparecer");
	assert.ok(joinedCollapsed.includes("line-10"), "line-10 debe aparecer");
	assert.ok(joinedCollapsed.includes("Took 2s · Ctrl+O to expand"), "Debe incluir el estado colapsado");

	// 2. Expandido (expanded: true)
	const expandedLines = renderCuteBashBox("generate-data", output10Lines, state, true, 70);
	// Content lines adentro: cmdHeader (1) + all (10) + status (1) = 12 + top + bottom = 14 líneas
	assert.equal(expandedLines.length, 14);
	const joinedExpanded = expandedLines.map((l) => stripAnsi(l)).join("\n");
	assert.ok(joinedExpanded.includes("line-1"), "line-1 debe aparecer en expandido");
	assert.ok(joinedExpanded.includes("line-10"), "line-10 debe aparecer en expandido");
	assert.ok(joinedExpanded.includes("Took 2s · Ctrl+O to collapse"), "Debe incluir el estado expandido");
});

test("CuteLiveBash - running status shows Running... (Xs)", () => {
	const state: BashRenderState = {
		startedAt: Date.now() - 4000,
		isPartial: true,
		hasResult: false,
	};

	const runningLines = renderCuteBashBox("sleep 5", "processing...", state, false, 70);
	const joined = runningLines.map((l) => stripAnsi(l)).join("\n");
	assert.ok(joined.includes("● Running... (4s)"), "Debe mostrar el contador de ejecución vivo");
});

test("CuteLiveBash - CuteBashCardComponent caches output when finished and cleans timer on dispose", () => {
	let timerCalled = 0;
	const interval = setInterval(() => {
		timerCalled++;
	}, 100);

	const state: BashRenderState = {
		startedAt: Date.now() - 1000,
		endedAt: Date.now(),
		hasResult: true,
		isPartial: false,
		interval,
	};

	const comp = new CuteBashCardComponent("pwd", "/home/cinlodev", state, false);

	// First render fills cache
	const r1 = comp.render(60);
	assert.ok(state.cachedLines, "cachedLines debe estar poblado tras el primer render final");
	const r2 = comp.render(60);
	assert.equal(r1, r2, "Debe devolver la misma referencia de caché");

	// Dispose clears timer
	comp.dispose();
	assert.equal(state.interval, undefined, "Interval debe quedar undefined tras dispose");
});

test("CuteLiveBash - formatTranscriptChildren passthrough when live bash is active", () => {
	const originalFlag = isCuteLiveBashActive();
	try {
		setCuteLiveBashActive(true);

		const fakeLiveBashComponent = {
			toolName: "bash",
			render(w: number) {
				return [
					"╔═ >_ bash ══════════════════════════════════════════╗",
					"║ $ echo live                                        ║",
					"║ live                                               ║",
					"╚════════════════════════════════════════════════════╝",
				];
			},
		};

		const { lines } = formatTranscriptChildren([fakeLiveBashComponent as any], 60);

		// Con passthrough activo, NO debe haber doble marco (no ╔═ anidado dos veces)
		const frameTops = lines.filter((l) => stripAnsi(l).startsWith("╔═"));
		assert.equal(frameTops.length, 1, "Debe haber exactamente un marco ╔═ (sin doble card)");
		assert.ok(stripAnsi(lines[0]).includes(">_ bash"));
	} finally {
		setCuteLiveBashActive(originalFlag);
	}
});
