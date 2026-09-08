import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import welcome from "./src/welcome.js";
import hud from "./src/hud.js";
import { installCinlodevPrompt } from "./src/editor.js";
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

		// Ensure dev-binary override warning doesn't spam
		try {
			const devBinaryPath = path.join(os.homedir(), ".pi", "gentle-ai", "dev-binary.json");
			if (fs.existsSync(devBinaryPath)) {
				fs.unlinkSync(devBinaryPath);
			}
		} catch {}
	});

	// 4. Command to inspect / reapply
	pi.registerCommand("cinlodev", {
		description: "Check or reapply Cinlodev CUTE aesthetics and widgets (/cinlodev)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			installCinlodevPrompt(ctx);
			ctx.ui.notify("🌸 Cinlodev CUTE: Header, HUD y Editor con doble línea violeta aplicados.", "info");
		},
	});
}
