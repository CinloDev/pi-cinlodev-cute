import { transformTranscriptLines } from "./theme-adapter.ts";

export function installWelcomeHeaderGuard(
	ctx: { ui?: { setHeader?: (content: any) => void } },
	isWelcomeActive: () => boolean,
): void {
	if (!ctx.ui || typeof ctx.ui.setHeader !== "function" || (ctx.ui as any).__cuteSetHeaderWrapped) {
		return;
	}
	(ctx.ui as any).__cuteSetHeaderWrapped = true;
	const origSetHeader = ctx.ui.setHeader.bind(ctx.ui);

	ctx.ui.setHeader = (content: any) => {
		// 1. If it's our own Welcome Dashboard, install it directly
		if (content && (content as any).__isCuteWelcome) {
			return origSetHeader(content);
		}

		// 2. If the user explicitly disabled welcome (/welcome off) and passed undefined
		if (!isWelcomeActive() && content === undefined) {
			return origSetHeader(undefined);
		}

		// 3. If our Welcome Dashboard is active, protect it from being overwritten
		// by foreign extensions (e.g. gentle-pi startup-banner.ts deferred setTimeout)
		if (isWelcomeActive()) {
			return;
		}

		// 4. If welcome is disabled, wrap external content to apply CUTE frames and theme tones
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

		return origSetHeader(content);
	};
}
