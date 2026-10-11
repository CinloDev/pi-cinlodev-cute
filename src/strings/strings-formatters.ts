import { DEFAULTS } from "./strings-types.ts";

/**
 * Render the active profile as icon plus name without brackets, e.g. "👤 cinlodev".
 * "{icon}" and "{name}" placeholders come from config/CinlodevCute.strings.json
 * profileFormat; empty inputs fall back to the compiled defaults.
 */
export function formatProfileDisplay(icon: string, format: string, name: string): string {
	const safeIcon = icon.length > 0 ? icon : "👤";
	const safeFormat = format.length > 0 ? format : DEFAULTS.profileFormat;
	return safeFormat.split("{icon}").join(safeIcon).split("{name}").join(name);
}

/** Match a host "[name]" status; other statuses pass through untouched. */
export function matchBracketProfile(text: string): string | null {
	const match = /^\[(.+?)\]$/.exec(text.trim());
	return match ? match[1] : null;
}
