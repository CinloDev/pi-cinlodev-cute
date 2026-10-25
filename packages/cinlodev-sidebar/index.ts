import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { attachMultitabSidebar } from "./src/sidebar-mount.ts";

export default function cinlodevSidebarExtension(pi: ExtensionAPI): void {
	const attach = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const cwd = ctx.cwd ?? process.cwd();
		const theme = ctx.ui?.theme;

		ctx.ui.setWidget(
			"cinlodev-sidebar-mount",
			(tui: TUI, widgetTheme: any) => {
				attachMultitabSidebar(tui, cwd, widgetTheme ?? theme, () => ctx);
				return {
					render: () => [],
					invalidate: () => {},
				};
			},
			{ placement: "belowEditor" },
		);
	};

	pi.on("session_start", async (_event, ctx: ExtensionContext) => attach(ctx));
	pi.on("turn_start", async (_event, ctx: ExtensionContext) => attach(ctx));
}
