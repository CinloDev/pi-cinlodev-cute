import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import welcome from "./src/welcome.js";
import hud from "./src/hud.js";
import { installCinlodevPrompt, setCinlodevPromptThinkingLevel, setCinlodevPromptWorking } from "./src/editor.js";
import { installCinlodevFooter } from "./src/footer.js";
import { loadCuteStrings, resetCuteStringsCache } from "./src/cute-strings.ts";
import { loadCutePaths, resetCutePathsCache, resolveDevBinaryPath } from "./src/cute-paths.ts";
import { resetCuteGlyphsCache } from "./src/cute-theme.ts";
import { resetCuteLayoutCache } from "./src/cute-layout.ts";
import * as fs from "node:fs";

export default function cinlodevCuteExtension(pi: ExtensionAPI): void {
	// 1. Initialize Welcome Header (Gentlewoman)
	welcome(pi);

	// 2. Initialize HUD (Cinlodev CUTE)
	hud(pi);

	// 3. Hook into session_start to bind Prompt Editor & hygiene
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		// Install custom prompt editor with double violet frame & pink cursor
		installCinlodevPrompt(ctx);

		// Install custom CUTE statusline footer
		installCinlodevFooter(ctx, pi);

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

			installCinlodevPrompt(ctx);
			installCinlodevFooter(ctx, pi);
			ctx.ui.notify(loadCuteStrings().commandNotify, "info");
		},
	});
}
