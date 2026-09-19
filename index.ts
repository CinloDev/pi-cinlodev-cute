import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import welcome from "./src/welcome.js";
import hud from "./src/hud.js";
import { installCinlodevPrompt, setCinlodevPromptThinkingLevel, setCinlodevPromptWorking } from "./src/editor.js";
import { installCinlodevFooter, toggleUsageCard } from "./src/footer.js";
import { loadCuteStrings, resetCuteStringsCache } from "./src/cute-strings.ts";
import { loadCutePaths, resetCutePathsCache, resolveDevBinaryPath } from "./src/cute-paths.ts";
import { installWelcomeHeaderGuard, resetCuteGlyphsCache, transformTranscriptLines, installCuteMarkdownThemeHook } from "./src/cute-theme.ts";
import { resetCuteLayoutCache } from "./src/cute-layout.ts";
import { resetCuteColorsCache } from "./src/cute-colors.ts";
import { CuteContextMonitor } from "./src/cute-context-monitor.ts";
import * as fs from "node:fs";

export default function cinlodevCuteExtension(pi: ExtensionAPI): void {
	// 0. Context Threshold Notifications Monitor (Herdr + Pi toast)
	const contextMonitor = new CuteContextMonitor();

	// 1. Initialize Welcome Header (Gentlewoman)
	welcome(pi);

	// 2. Initialize HUD (Cinlodev CUTE)
	hud(pi);

	// 3. Hook into session_start to bind Prompt Editor & hygiene
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		// Install custom prompt editor with double violet frame & pink cursor
		installCinlodevPrompt(ctx);

		// Install Dracula-style Markdown emphasis hook on global theme
		installCuteMarkdownThemeHook(ctx.ui.theme);

		// Intercept ctx.ui.setHeader to protect la Gentlewoman Welcome Dashboard
		// from being overwritten by external extensions (e.g. gentle-pi startup-banner deferred timeout)
		installWelcomeHeaderGuard(ctx);

		// Intercept ctx.ui.setWidget so any widgets registered by other extensions
		// (such as gentle-shell-dev-binary warning cards) render with double line and themed tones.
		if (ctx.ui && typeof ctx.ui.setWidget === "function" && !(ctx.ui as any).__cuteSetWidgetWrapped) {
			(ctx.ui as any).__cuteSetWidgetWrapped = true;
			const origSetWidget = ctx.ui.setWidget.bind(ctx.ui);
			ctx.ui.setWidget = (key: string, content: any, options?: any) => {
				if (typeof content === "function") {
					const origFactory = content;
					content = (tui: any, theme: any) => {
						const comp = origFactory(tui, theme);
						if (!comp || typeof comp.render !== "function") return comp;
						const origRender = comp.render.bind(comp);
						return {
							...comp,
							render(width: number) {
								const rawLines = origRender(width);
								return transformTranscriptLines(rawLines, theme);
							},
							dispose() {
								comp.dispose?.();
							},
						};
					};
				}
				return origSetWidget(key, content, options);
			};
		}

		// Install custom CUTE statusline footer
		installCinlodevFooter(ctx, pi);

		// Initialize context threshold monitoring for active session
		contextMonitor.reset();
		contextMonitor.check(ctx);

		// Optional hygiene for the foreign gentle-ai dev-binary override file.
		// Disabled by default (devBinaryHygiene: false in
		// config/CinlodevCute.paths.json): this theme never deletes files it
		// does not own unless explicitly opted in.
		if (loadCutePaths().devBinaryHygiene) {
			try {
				const devBinaryPath = resolveDevBinaryPath();
				if (fs.existsSync(devBinaryPath)) {
					fs.unlinkSync(devBinaryPath);
				}
			} catch {}
		}
	});

	// 4. Hook into agent lifecycle to animate working petal & label in input
	pi.on("agent_start", () => {
		setCinlodevPromptWorking(true);
	});

	pi.on("agent_end", () => {
		setCinlodevPromptWorking(false);
	});

	// Monitor context threshold transitions on turn completion
	pi.on("turn_end", async (_event, ctx) => {
		if (ctx?.hasUI) {
			contextMonitor.check(ctx);
		}
	});

	// Reset / re-evaluate monitor on compaction
	pi.on("session_compact", async (_event, ctx) => {
		if (ctx?.hasUI) {
			contextMonitor.reset();
			contextMonitor.check(ctx);
		}
	});

	pi.on("session_shutdown", () => {
		contextMonitor.stop();
	});

	// 4b. Repintar el marco del input cuando cambia el esfuerzo (thinking level)
	pi.on("thinking_level_select", () => {
		try {
			setCinlodevPromptThinkingLevel(pi.getThinkingLevel());
		} catch {}
	});

	// 5. Command to inspect / reapply with hot-reload of configurations
	pi.registerCommand(loadCuteStrings().commandName, {
		description: loadCuteStrings().commandDescription,
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			// Clear in-memory caches so changes in ~/.pi/agent/cute.json or project configs load immediately
			resetCuteGlyphsCache();
			resetCuteStringsCache();
			resetCuteLayoutCache();
			resetCutePathsCache();
			resetCuteColorsCache();

			installCuteMarkdownThemeHook();
			installCinlodevPrompt(ctx);
			installCinlodevFooter(ctx, pi);
			ctx.ui.notify(loadCuteStrings().commandNotify, "info");
		},
	});

	// 6. Shortcut Alt+U to toggle Quotas & Usage card in the CUTE sidebar rail
	pi.registerShortcut("alt+u", {
		description: "Toggle Quotas & Usage card in the CUTE sidebar rail",
		handler: async (ctx) => {
			const visible = toggleUsageCard();
			if (ctx.hasUI) {
				ctx.ui.notify(visible ? "✿ Quotas abiertas en la sidebar" : "✿ Quotas ocultas", "info");
			}
		},
	});

	// 7. Command /usage-card to toggle or inspect Quotas card in sidebar
	pi.registerCommand("usage-card", {
		description: "Toggle Quotas & Usage card in the CUTE sidebar rail",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const visible = toggleUsageCard();
			if (ctx.hasUI) {
				ctx.ui.notify(visible ? "✿ Quotas abiertas en la sidebar" : "✿ Quotas ocultas", "info");
			}
		},
	});
}
