/**
 * Theme & Styling Engine for pi-cinlodev-cute.
 * Facade module re-exporting from domain modules in src/theme/ for backwards compatibility.
 */

export {
	safeFg,
	frameFg,
	bolden,
	installCuteMarkdownThemeHook,
	cursorStyle,
	cutePalette,
	stripAnsi,
	type CutePalette,
} from "./theme/theme-color.ts";

export {
	type CuteFrameStyle,
	type CuteGlyphs,
	type CutePetalPreset,
	PETAL_PRESETS,
	cuteGlyphs,
	resetCuteGlyphsCache,
} from "./theme/theme-glyphs.ts";

export {
	type CuteCardTone,
	unifySidebarCardFrame,
	formatGentleAiCardLine,
	transformTranscriptLines,
	unifyCardFrame,
} from "./theme/theme-adapter.ts";

export {
	installWelcomeHeaderGuard,
} from "./theme/theme-header-guard.ts";
