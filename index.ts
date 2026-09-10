import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import welcome from "./src/welcome.js";
import hud from "./src/hud.js";
import { installCinlodevPrompt, setCinlodevPromptThinkingLevel, setCinlodevPromptWorking } from "./src/editor.js";
import { installCinlodevFooter } from "./src/footer.js";
import { loadCuteStrings } from "./src/cute-strings.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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

		// Ensure dev-binary override warning doesn't spam
		try {
			const devBinaryPath = path.join(os.homedir(), ".pi", "gentle-ai", "dev-binary.json");
			if (fs.existsSync(devBinaryPath)) {
				fs.unlinkSync(devBinaryPath);
			}
		} catch {}
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

	// 5. Command to inspect / reapply
	pi.registerCommand(loadCuteStrings().commandName, {
		description: loadCuteStrings().commandDescription,
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			installCinlodevPrompt(ctx);
			installCinlodevFooter(ctx, pi);
			ctx.ui.notify(loadCuteStrings().commandNotify, "info");
		},
	});
}
