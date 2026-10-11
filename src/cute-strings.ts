/**
 * Human-Readable Strings & Persona Configuration for pi-cinlodev-cute.
 * Facade module re-exporting from domain modules in src/strings/ for backwards compatibility.
 */

export {
	type CuteStrings,
	type CutePersonaMode,
	PERSONA_PRESETS,
	CUTE_STRINGS_FILENAME,
} from "./strings/strings-types.ts";

export {
	detectSystemUser,
} from "./strings/strings-user.ts";

export {
	formatProfileDisplay,
	matchBracketProfile,
} from "./strings/strings-formatters.ts";

export {
	loadCuteStrings,
	resetCuteStringsCache,
} from "./strings/strings-loader.ts";
