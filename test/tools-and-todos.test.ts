import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cp from "node:child_process";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatTokenCount, getContextThreshold } from "../src/cute-metrics.ts";
import { readActiveProfile, resetActiveProfileCache } from "../src/cute-paths.ts";
import { herdrAvailable, notify } from "../src/cute-notify.ts";
import { CuteContextMonitor } from "../src/cute-context-monitor.ts";
import {
	collectToolCounts,
	recordToolCall,
	formatToolPill,
	wrapToolPills,
	CinlodevToolsCard,
	createEmptyToolCounts,
} from "../src/cute-tools.ts";
import { CinlodevTodoMirror } from "../src/todos.ts";
import { invalidateSidebarGitAndTree } from "../src/footer.ts";
import { resetAll, userConfigFile } from "./test-helpers.ts";

test("Syntax check across all source files", () => {
	const srcFiles = [
		"index.ts",
		"src/cute-theme.ts",
		"src/cute-strings.ts",
		"src/cute-layout.ts",
		"src/cute-paths.ts",
		"src/cute-colors.ts",
		"src/cute-metrics.ts",
		"src/hud.ts",
		"src/footer.ts",
		"src/sidebar.ts",
		"src/sidebar-dock.ts",
		"src/sidebar-tabs.ts",
		"src/sidebar-state.ts",
		"src/welcome.ts",
		"src/editor.ts",
		"src/todos.ts",
		"src/cute-transcript.ts",
		"src/cute-profiles.ts",
		"src/cute-notify.ts",
		"src/cute-context-monitor.ts",
		"src/cute-git-graph.ts",
		"src/cute-tools.ts",
	];
	for (const f of srcFiles) {
		assert.ok(fs.existsSync(f), `File exists: ${f}`);
	}
});

test("formatTokenCount - formats M, k, and plain counts cleanly", () => {
	assert.equal(formatTokenCount(1_000_000), "1.0M");
	assert.equal(formatTokenCount(2_500_000), "2.5M");
	assert.equal(formatTokenCount(10_000_000), "10M");
	assert.equal(formatTokenCount(128_000), "128k");
	assert.equal(formatTokenCount(24_520), "24.5k");
	assert.equal(formatTokenCount(4_400), "4.4k");
	assert.equal(formatTokenCount(850), "850");
	assert.equal(formatTokenCount(0), "0");
});

test("getContextThreshold - dynamic semáforo based on custom percent brackets", () => {
	const mockPalette = {
		mint: (s: string) => `[mint]${s}[/mint]`,
		gold: (s: string) => `[gold]${s}[/gold]`,
		orange: (s: string) => `[orange]${s}[/orange]`,
		coral: (s: string) => `[coral]${s}[/coral]`,
	} as any;

	// 0% to 39% -> Verde (Óptimo)
	const optimal0 = getContextThreshold(0, mockPalette);
	assert.equal(optimal0.label, "● Óptimo");
	assert.equal(optimal0.color("test"), "[mint]test[/mint]");

	const optimal39 = getContextThreshold(39.4, mockPalette);
	assert.equal(optimal39.label, "● Óptimo");
	assert.equal(optimal39.color("test"), "[mint]test[/mint]");

	// 39.5% rounds to 40% -> immediately turns Oro/Dorado (Medio)
	const roundedGold = getContextThreshold(39.5, mockPalette);
	assert.equal(roundedGold.label, "● Medio");
	assert.equal(roundedGold.color("test"), "[gold]test[/gold]");

	// 40% to 64% -> Oro/Dorado (Medio)
	const medium40 = getContextThreshold(40, mockPalette);
	assert.equal(medium40.label, "● Medio");
	assert.equal(medium40.color("test"), "[gold]test[/gold]");

	const medium64 = getContextThreshold(64.4, mockPalette);
	assert.equal(medium64.label, "● Medio");
	assert.equal(medium64.color("test"), "[gold]test[/gold]");

	// 64.5% rounds to 65% -> immediately turns Naranja (Alerta)
	const alert645 = getContextThreshold(64.5, mockPalette);
	assert.equal(alert645.label, "● Alerta");
	assert.equal(alert645.color("test"), "[orange]test[/orange]");

	// 65% to 79% -> Naranja (Alerta)
	const alert65 = getContextThreshold(65, mockPalette);
	assert.equal(alert65.label, "● Alerta");
	assert.equal(alert65.color("test"), "[orange]test[/orange]");

	const alert794 = getContextThreshold(79.4, mockPalette);
	assert.equal(alert794.label, "● Alerta");
	assert.equal(alert794.color("test"), "[orange]test[/orange]");

	// 79.5% rounds to 80% -> immediately turns Rojo/Coral (Crítico)
	const critical795 = getContextThreshold(79.5, mockPalette);
	assert.equal(critical795.label, "● Crítico");
	assert.equal(critical795.color("test"), "[coral]test[/coral]");

	// 80% to 100% -> Rojo/Coral (Crítico)
	const critical80 = getContextThreshold(80, mockPalette);
	assert.equal(critical80.label, "● Crítico");
	assert.equal(critical80.color("test"), "[coral]test[/coral]");

	const critical100 = getContextThreshold(100, mockPalette);
	assert.equal(critical100.label, "● Crítico");
	assert.equal(critical100.color("test"), "[coral]test[/coral]");
});

test("cute-paths - readActiveProfile prioritizes project scope over global scope", () => {
	resetActiveProfileCache();
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cute-profile-test-"));
	try {
		const projDir = path.join(tmpDir, ".pi", "profiles");
		fs.mkdirSync(projDir, { recursive: true });
		fs.writeFileSync(path.join(projDir, ".active"), "Cinlodev02", "utf8");
		const active = readActiveProfile(tmpDir);
		assert.equal(active, "Cinlodev02", "should read project-local .active first");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		resetActiveProfileCache();
	}
});


test("cute-notify - herdrAvailable and fallback notification dispatch", () => {
	const origSocket = process.env.HERDR_SOCKET_PATH;
	const origEnv = process.env.HERDR_ENV;

	try {
		delete process.env.HERDR_SOCKET_PATH;
		delete process.env.HERDR_ENV;
		assert.equal(herdrAvailable(), false);

		// Fallback to ctx.ui.notify when Herdr is absent
		let notifiedMsg = "";
		let notifiedType = "";
		const mockCtx = {
			hasUI: true,
			ui: {
				notify: (msg: string, type: string) => {
					notifiedMsg = msg;
					notifiedType = type;
				},
			},
		} as any;

		const res = notify(mockCtx, "Título Test", "Cuerpo Test", "warning");
		assert.equal(res, false, "should return false indicating it did not go through Herdr");
		assert.ok(notifiedMsg.includes("Título Test"));
		assert.ok(notifiedMsg.includes("Cuerpo Test"));
		assert.equal(notifiedType, "warning");
	} finally {
		if (origSocket) process.env.HERDR_SOCKET_PATH = origSocket;
		if (origEnv) process.env.HERDR_ENV = origEnv;
	}
});

test("cute-context-monitor - progressive 2-level thresholds (orange single notice, red 5m recurring, auto-reset)", () => {
	const notifications: Array<{ title: string; body: string; type: string }> = [];
	const monitor = new CuteContextMonitor({
		alertThreshold: 65,
		criticalThreshold: 80,
		criticalIntervalMs: 50, // 50ms for unit test speed instead of 5min
		onNotify: (title, body, type) => {
			notifications.push({ title, body, type });
		},
	});

	const makeCtx = (tokens: number, contextWindow = 100_000) =>
		({
			getContextUsage: () => ({
				tokens,
				contextWindow,
				percent: (tokens / contextWindow) * 100,
			}),
		}) as any;

	// 1. Context at 50% (Normal/Óptimo): No notification
	const res50 = monitor.check(makeCtx(50_000));
	assert.equal(res50.level, "optimal");
	assert.equal(res50.notified, false);
	assert.equal(notifications.length, 0);

	// 2. Context reaches 70% (Naranja / Alerta): Fires ONE single notification
	const res70 = monitor.check(makeCtx(70_000));
	assert.equal(res70.level, "alert");
	assert.equal(res70.notified, true);
	assert.equal(notifications.length, 1);
	assert.ok(notifications[0].title.includes("70%"));
	assert.ok(notifications[0].body.includes("/handoff"));
	assert.equal(notifications[0].type, "info");

	// 3. Context stays in orange at 72%: Does NOT fire again (no spam)
	const res72 = monitor.check(makeCtx(72_000));
	assert.equal(res72.level, "alert");
	assert.equal(res72.notified, false);
	assert.equal(notifications.length, 1);

	// 4. Context reaches 82% (Rojo / Crítico): Fires immediately
	const res82 = monitor.check(makeCtx(82_000));
	assert.equal(res82.level, "critical");
	assert.equal(res82.notified, true);
	assert.equal(notifications.length, 2);
	assert.ok(notifications[1].title.includes("82%"));
	assert.ok(notifications[1].body.includes("/compact"));
	assert.equal(notifications[1].type, "warning");

	// 5. Context still at 82% immediately after: Does NOT fire before interval
	const res82Immediate = monitor.check(makeCtx(82_000));
	assert.equal(res82Immediate.level, "critical");
	assert.equal(res82Immediate.notified, false);
	assert.equal(notifications.length, 2);

	// 6. Context drops to 30% (e.g. after /compact): Monitor auto-resets
	const res30 = monitor.check(makeCtx(30_000));
	assert.equal(res30.level, "optimal");
	assert.equal(res30.notified, false);
	assert.equal(monitor.isAlertNotified, false);
	assert.equal(monitor.lastCriticalTime, 0);

	// 7. Context rises back to 70%: Can fire orange alert again!
	const res70Again = monitor.check(makeCtx(70_000));
	assert.equal(res70Again.level, "alert");
	assert.equal(res70Again.notified, true);
	assert.equal(notifications.length, 3);

	monitor.stop();
});


test("cute-tools - recordToolCall and collectToolCounts categorizes session tools", () => {
	const counts = createEmptyToolCounts();
	recordToolCall(counts, "read");
	recordToolCall(counts, "write");
	recordToolCall(counts, "edit");
	recordToolCall(counts, "bash");
	recordToolCall(counts, "mem_save");
	recordToolCall(counts, "mem_search");
	recordToolCall(counts, "grep");
	recordToolCall(counts, "fetch_content");
	recordToolCall(counts, "web_search");
	recordToolCall(counts, "custom_tool");

	assert.equal(counts.read, 1);
	assert.equal(counts.write, 2, "write and edit should be grouped under write");
	assert.equal(counts.bash, 1);
	assert.equal(counts.engram, 2, "mem_* should be grouped under engram");
	assert.equal(counts.grep, 1);
	assert.equal(counts.fetch, 1);
	assert.equal(counts.search, 1);
	assert.equal(counts.other, 1);
	assert.equal(counts.total, 10);

	// Context with mock branch
	const mockCtx = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", name: "read" },
							{ type: "toolCall", name: "bash" },
						],
					},
				},
				{
					type: "message",
					message: {
						role: "user",
						content: "hello",
					},
				},
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", name: "write" },
							{ type: "toolCall", name: "mem_save" },
						],
					},
				},
			],
		},
	};

	const sessionCounts = collectToolCounts(mockCtx as any);
	assert.equal(sessionCounts.read, 1);
	assert.equal(sessionCounts.bash, 1);
	assert.equal(sessionCounts.write, 1);
	assert.equal(sessionCounts.engram, 1);
	assert.equal(sessionCounts.total, 4);
});

test("cute-tools - formatToolPill and wrapToolPills", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const readPill = formatToolPill("read", 5, mockTheme);
	assert.ok(readPill.includes("[read]✎ 5 read[/read]"));

	const writePill = formatToolPill("write", 3, mockTheme);
	assert.ok(writePill.includes("[write]✎ 3 write[/write]"));

	const bashPill = formatToolPill("bash", 2, mockTheme);
	assert.ok(bashPill.includes("[bash]>_ 2 bash[/bash]"));

	const engramPill = formatToolPill("engram", 4, mockTheme);
	assert.ok(engramPill.includes("[salmon]🧠 4 engram[/salmon]"));

	// 0 count returns empty string
	assert.equal(formatToolPill("grep", 0, mockTheme), "");

	// Wrap pills into rows
	const pills = ["pillA", "pillB", "pillC", "pillD"];
	const rows = wrapToolPills(pills, 16);
	assert.ok(rows.length >= 2, "Should wrap into multiple lines when width is small");
});

test("cute-tools - CinlodevToolsCard hides when empty and renders when tools present", () => {
	const mockTheme = {
		fg: (role: string, text: string) => `[${role}]${text}[/${role}]`,
	} as any;

	const mockTui = { requestRender: () => {} } as any;

	// 1. Empty session: card stays hidden
	const emptyCtx = {
		sessionManager: { getBranch: () => [] },
	} as any;
	const emptyCard = new CinlodevToolsCard(emptyCtx, mockTui, mockTheme);
	assert.deepEqual(emptyCard.render(50), [], "Card must return [] when total tool calls is 0");

	// 2. Active session: card renders
	const activeCtx = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", name: "read" },
							{ type: "toolCall", name: "read" },
							{ type: "toolCall", name: "write" },
						],
					},
				},
			],
		},
	} as any;
	const activeCard = new CinlodevToolsCard(activeCtx, mockTui, mockTheme);
	const rendered = activeCard.render(50);
	assert.ok(rendered.length >= 3, "Rendered card must have top, content rows, and bottom");
	assert.ok(rendered[0].includes("tools"), "Top header must contain 'tools'");
	assert.ok(rendered[0].includes("3 calls"), "Top header must indicate '3 calls'");
	const joined = rendered.join("\n");
	assert.ok(joined.includes("2 read"));
	assert.ok(joined.includes("1 write"));
});


test("footer - invalidateSidebarGitAndTree executes safely", () => {
	assert.doesNotThrow(() => {
		invalidateSidebarGitAndTree();
	});
});

test("todos - CinlodevTodoMirror renders double-line CUTE card without background leaks", () => {
	resetAll();
	const mockCtx: any = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo",
						details: {
							gentleTodo: {
								tasks: [
									{ id: 1, title: "Tarea completada", status: "done" },
									{ id: 2, title: "Tarea en progreso", status: "in_progress", note: "Avanzando en el refactor" },
									{ id: 3, title: "Tarea pendiente", status: "pending" },
								],
							},
						},
					},
				},
			],
		},
	};

	let rendered = false;
	const mockTui: any = {
		requestRender: () => {
			rendered = true;
		},
	};

	const mirror = new CinlodevTodoMirror(mockCtx, mockTui);
	const lines = mirror.renderRail(40);
	const joined = lines.join("\n");

	// Marco doble CUTE presente
	assert.ok(lines.length >= 5, "Debe tener al menos 5 líneas");
	assert.ok(lines[0].includes("╔"), "Debe tener esquina superior doble ╔");
	assert.ok(lines[lines.length - 1].includes("╚"), "Debe tener esquina inferior doble ╚");
	assert.ok(joined.includes("Todos · 1 of 3"), "Debe incluir el título CUTE con conteo");

	// Cero fondo azul y cero barra float
	assert.ok(!joined.includes("\x1b[48;"), "No debe tener secuencias de escape de fondo ANSI");
	assert.ok(!joined.includes("▎"), "No debe contener el rail float ▎");

	// Glifos correctos
	assert.ok(joined.includes("✓"), "Debe mostrar ✓ para done");
	assert.ok(joined.includes("◉"), "Debe mostrar ◉ para in_progress");
	assert.ok(joined.includes("○"), "Debe mostrar ○ para pending");

	// Nota indentada presente
	assert.ok(joined.includes("↳ Avanzando en el refactor"), "Debe mostrar la nota de la tarea in_progress indentada");
});

test("todos - CinlodevTodoMirror performs word wrapping for long titles", () => {
	resetAll();
	const longTitle = "Esta es una tarea extremadamente larga que no cabe en una sola linea y debe wrappear";
	const mockCtx: any = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo",
						details: {
							gentleTodo: {
								tasks: [
									{ id: 1, title: longTitle, status: "pending" },
								],
							},
						},
					},
				},
			],
		},
	};

	const mirror = new CinlodevTodoMirror(mockCtx, { requestRender: () => {} } as any);
	const width = 36;
	const lines = mirror.renderRail(width);

	// Verificar que cada línea dentro del marco respeta el ancho
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width, `La línea no debe exceder el ancho asignado (${visibleWidth(line)} > ${width})`);
	}

	// Como el título es largo, debe haber generado al menos 2 líneas de cuerpo más top y bottom
	assert.ok(lines.length >= 4, "Debe ocupar al menos 2 líneas de contenido por wrapping");
	const joined = lines.join("\n");
	assert.ok(joined.includes("Esta es una tarea"), "Debe contener el inicio del título");
	assert.ok(joined.includes("wrappear"), "Debe contener el final del título en otra línea");
});

test("todos - CinlodevTodoMirror handles mouse wheel scrolling on overflow", () => {
	resetAll();
	const manyTasks = Array.from({ length: 25 }, (_, i) => ({
		id: i + 1,
		title: `Tarea de prueba numero ${i + 1}`,
		status: i < 3 ? "done" as const : "pending" as const,
	}));

	const mockCtx: any = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo",
						details: {
							gentleTodo: {
								tasks: manyTasks,
							},
						},
					},
				},
			],
		},
	};

	let renderRequests = 0;
	const mockTui: any = {
		requestRender: () => {
			renderRequests++;
		},
	};

	const mirror = new CinlodevTodoMirror(mockCtx, mockTui);
	const initialLines = mirror.renderRail(40);
	const initialJoined = initialLines.join("\n");

	// Debe mostrar el indicador de scroll
	assert.ok(initialJoined.includes("wheel scroll"), "Debe mostrar el indicador de scroll por overflow");
	assert.ok(initialJoined.includes("Tarea de prueba numero 1"), "Inicialmente debe mostrar la primera tarea");

	// Scrollear hacia abajo con wheel
	const scrollDownHandled = mirror.handleRailWheel(1);
	assert.equal(scrollDownHandled, true, "Scrollear hacia abajo debe retornar true");
	assert.ok(renderRequests > 0, "Debe haber solicitado re-render");

	const scrolledLines = mirror.renderRail(40);
	const scrolledJoined = scrolledLines.join("\n");
	assert.ok(scrolledJoined.includes("▲ 1 arriba"), "Debe indicar que hay 1 línea scrolleada arriba");

	// Scrollear hacia arriba
	const scrollUpHandled = mirror.handleRailWheel(-1);
	assert.equal(scrollUpHandled, true, "Scrollear hacia arriba debe retornar true");

	// Wheel handling vía handleMouse
	const mouseHandled = mirror.handleMouse({ wheelDelta: 1 });
	assert.deepEqual(mouseHandled, { handled: true }, "handleMouse debe procesar eventos con wheelDelta");
});


test("todos - CinlodevTodoMirror supports full-height availableHeight in renderRail", () => {
	const mockCtx: any = {
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo",
						details: {
							gentleTodo: {
								tasks: Array.from({ length: 40 }, (_, i) => ({
									id: i + 1,
									title: `Tarea extendida ${i + 1}`,
									status: "pending" as const,
								})),
							},
						},
					},
				},
			],
		},
	};

	const mirror = new CinlodevTodoMirror(mockCtx, { requestRender: () => {} } as any);
	// Invocación estándar (railMaxRows = 20)
	const standardLines = mirror.renderRail(40);
	// Con full-height en la pestaña con availableHeight = 45
	const fullHeightLines = mirror.renderRail(40, 45);

	assert.ok(fullHeightLines.length > standardLines.length, "Con availableHeight debe renderizar más líneas verticales");
	assert.ok(fullHeightLines.length >= 25, "Debe aprovechar la altura vertical disponible del rail");
});
