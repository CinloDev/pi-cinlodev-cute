import { loadCuteStrings } from "../cute-strings.ts";
import { stripAnsi } from "../cute-theme.ts";

export const BG_ESCAPE_RE = /\x1b\[(?:48;[0-9;]*|49)m/g;
export const KEY_HINT_TRAILING_RE = /\s*(?:(?:ctrl|cmd|alt|opt|meta)\+[a-z0-9]+|\S+)?\s*to\s+(?:expand|collapse)\s*$/i;

const RAIL_CHARS = "▎▏▍▌▋▊▉█│║|";

// Cache to avoid repeatedly unwrapping immutable message lines on every render tick
const unwrapCache = new WeakMap<string[], string[]>();

/**
 * Strips background fill ANSI escapes (\x1b[48;...m and \x1b[49m) that leak from float cards.
 */
export function stripBackgroundAnsi(text: string): string {
	return text.replace(BG_ESCAPE_RE, "");
}

/**
 * Extracts the title / command from a native or quiet-tools card top border.
 * e.g. "╭─ ✿ $ npm test ───────────── ctrl+o to expand ╮" -> "$ npm test"
 *      "╭─ ✿ edit /path/to/file ───── ctrl+o to expand ╮" -> "edit /path/to/file"
 *      "╭─ ≡ read /path/to/file ───── ctrl+o to expand ╮" -> "read /path/to/file"
 */
export function extractCardHeaderTitle(headerLine: string): string {
	const plain = stripAnsi(headerLine).trim();
	let title = plain.replace(/^[╭┌][─═\s]*(?:[✿❀❁✾✣✎★≡⌕+☷⌖$]\s*)?/, "");
	title = title.replace(/\s*[─═]{2,}.*$/, "").replace(/[╮┐]$/, "").trim();
	title = title.replace(KEY_HINT_TRAILING_RE, "").trim();
	return title;
}

/**
 * Strips leading/trailing vertical card borders (│, ║, |) and surrounding ANSI escapes
 * from a card body line so inner content nests cleanly inside CUTE frames.
 */
export function stripCardLineBorders(line: string): string {
	let s = line.replace(BG_ESCAPE_RE, "");
	s = s.replace(/^((?:\x1b\[[0-9;]*m)*)\s*[│║|]((?:\x1b\[[0-9;]*m)*)\s?/, "");
	s = s.replace(/\s?((?:\x1b\[[0-9;]*m)*)[│║|]((?:\x1b\[[0-9;]*m)*)\s*$/, "");
	return s.trimEnd();
}

/**
 * Checks whether a line represents a tool call header line.
 */
export function isToolHeaderLine(line: string): boolean {
	const plain = stripAnsi(line).trim();
	if (!plain) return false;
	if (/^(?:\$\s*)?bash\s+\$/i.test(plain) || /^\$\s+\S/.test(plain)) return true;
	if (/(?:🌹\s*)?rdd\b/i.test(plain) || /^gentle_review(?:_|\b)/i.test(plain)) return true;
	if (/^(?:[≡⌕✎+⌖☷✿❀❁✾★✣\u270E$🌹*]\s*)?(?:read|write|edit|grep|find|ls|fetch|search|bash|rdd|gentle_review|agent)\b/i.test(plain)) return true;
	return false;
}

/**
 * Checks whether a line is a blank float card padding line
 * (e.g. contains only whitespace, block rails like ▎, or background escapes).
 */
export function isBlankFloatLine(line: string): boolean {
	const stripped = stripAnsi(line.replace(BG_ESCAPE_RE, "")).trim();
	return stripped === "" || /^[▎▏▍▌▋▊▉█│║|]$/.test(stripped);
}

/**
 * Checks whether an array of lines represents an ASCII art block, banner, or logo
 * rather than a tool float card or simple text.
 */
export function isAsciiArtOrBanner(lines: string[]): boolean {
	if (!lines || lines.length === 0) return false;

	// 1. Signature check: known banners, custom partner/brand banners, or explicit logo titles
	const combinedPlain = lines.map((l) => stripAnsi(l)).join("\n");
	const strings = loadCuteStrings();
	const partner = strings.sidebarBanner?.partner?.trim();
	const brand = strings.sidebarBanner?.brand?.trim();

	if (partner && partner.length > 2) {
		const escapedPartner = partner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (new RegExp(escapedPartner, "i").test(combinedPlain)) {
			return true;
		}
	}
	if (brand && brand.length > 2) {
		const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (new RegExp(escapedBrand, "i").test(combinedPlain)) {
			return true;
		}
	}

	if (
		/neko[-_]?banner|neko[-_]?pi/i.test(combinedPlain) ||
		/N\s*e\s*k\s*o\s*-\s*p\s*i/i.test(combinedPlain) ||
		/banner|ascii[-_]?art/i.test(combinedPlain)
	) {
		return true;
	}

	// 2. Structural graphic check:
	let denseArtLines = 0;
	for (const line of lines) {
		const plain = stripAnsi(line);
		const blockMatches = plain.match(/[▀▄█▌▐▘▝▖▗▚▞▛▜▙▟]/g);
		if (blockMatches && blockMatches.length >= 3) {
			denseArtLines++;
		}
	}

	return denseArtLines >= 3;
}

/**
 * Checks whether an array of lines carries gentle-shell float card chrome.
 */
export function hasFloatChrome(lines: string[]): boolean {
	if (isAsciiArtOrBanner(lines)) return false;
	return lines.some((line) => {
		const plain = stripAnsi(line).trim();
		return /^[▎▏▍▌▋▊▉█]/.test(plain) || /\x1b\[48;[0-9;]*m/.test(line);
	});
}

/**
 * Checks whether an array of lines carries outline card borders.
 */
export function hasOutlineChrome(lines: string[]): boolean {
	return lines.some((line) => {
		const plain = stripAnsi(line).trim();
		return /^[╭┌].*[╮┐]$/.test(plain) || /^[╰└].*[╯┘]$/.test(plain);
	});
}

/**
 * Strips leading rail (▎ or other block rail), trailing padding/rail, and leaking background ANSI
 * from a float card line.
 */
export function stripFloatLineChrome(line: string): string {
	let s = line.replace(BG_ESCAPE_RE, "");

	// Fast-path: only perform rail stripping if the line actually contains rail characters
	let hasRail = false;
	for (let i = 0; i < RAIL_CHARS.length; i++) {
		if (s.includes(RAIL_CHARS[i])) {
			hasRail = true;
			break;
		}
	}

	if (hasRail) {
		// Strip leading rail without nested quantifier explosion
		s = s.replace(/^\s*(?:\x1b\[[0-9;]*m)*\s*[▎▏▍▌▋▊▉█│║|](?:\x1b\[[0-9;]*m)*\s?/, "");

		// Strip trailing rail and padding linearly and deterministically (no ReDoS)
		s = s.trimEnd();
		s = s.replace(/[▎▏▍▌▋▊▉█│║|](?:\x1b\[[0-9;]*m)*$/, "");
		s = s.replace(/(?:\x1b\[[0-9;]*m|\s)+$/, "");
	}

	// Strip trailing key hint if present on a tool header
	if (isToolHeaderLine(s)) {
		s = s.replace(KEY_HINT_TRAILING_RE, "");
	}
	return s.trimEnd();
}

/**
 * Strips gentle-shell float card chrome and native outline card frames
 * (╭─ ..., │ ..., ╰─ ..., ▎ ...) and leaking background ANSI escapes
 * so inner content nests cleanly without double borders or color bleeds.
 */
export function unwrapNativeCard(lines: string[]): string[] {
	if (!lines || lines.length === 0) return [];

	const cached = unwrapCache.get(lines);
	if (cached) return cached;

	// Protect ASCII art, animations, and banner components from being stripped or deformed
	if (isAsciiArtOrBanner(lines)) {
		unwrapCache.set(lines, lines);
		return lines;
	}

	// Gentle AI notice / lifecycle cards (review start, consent, binary override)
	// are handled specifically by transformTranscriptLines and unifyCardFrame.
	if (lines.some((line) => {
		const plain = stripAnsi(line);
		const isRdd = /(?:🌹\s*)?rdd\b/i.test(plain) || /^gentle_review(?:_|\b)/i.test(plain);
		const hasGentleTitle = !isRdd && (plain.includes("Gentle AI") || plain.includes("🤖") || /[\u{1F339}\uFE0E🌹🌷]/u.test(plain));
		return (plain.includes("╭") || plain.includes("╔")) && hasGentleTitle;
	})) {
		unwrapCache.set(lines, lines);
		return lines;
	}

	// Step 1: Strip background fill ANSI escapes that leak from float cards
	const cleanedBg = lines.map((line) => line.replace(BG_ESCAPE_RE, ""));

	// Step 2: Unwrap outline card framing if present
	let workingLines = cleanedBg;
	if (hasOutlineChrome(cleanedBg)) {
		const outlineResult: string[] = [];
		let inCard = false;
		for (const line of cleanedBg) {
			const plain = stripAnsi(line).trim();
			if (/^[╭┌].*[╮┐]$/.test(plain)) {
				inCard = true;
				const title = extractCardHeaderTitle(line);
				if (title) outlineResult.push(title);
				continue;
			}
			if (/^[╰└].*[╯┘]$/.test(plain)) {
				inCard = false;
				continue;
			}
			if (inCard) {
				outlineResult.push(stripCardLineBorders(line));
			} else {
				outlineResult.push(line);
			}
		}
		workingLines = outlineResult;
	}

	// Step 3: Unwrap float card chrome (▎ rails, margins, blank float padding lines)
	if (hasFloatChrome(workingLines)) {
		const floatResult: string[] = [];
		for (const line of workingLines) {
			if (isBlankFloatLine(line)) {
				floatResult.push("");
			} else {
				floatResult.push(stripFloatLineChrome(line));
			}
		}

		// Drop leading blank float padding lines
		let start = 0;
		while (start < floatResult.length && floatResult[start].trim() === "") {
			start++;
		}
		// Drop trailing blank float padding lines
		let end = floatResult.length;
		while (end > start && floatResult[end - 1].trim() === "") {
			end--;
		}

		const trimmed = floatResult.slice(start, end);

		// Drop intermediate blank padding line between header and body if present
		if (trimmed.length > 1 && isToolHeaderLine(trimmed[0]) && trimmed[1].trim() === "") {
			trimmed.splice(1, 1);
		}

		unwrapCache.set(lines, trimmed);
		return trimmed;
	}

	unwrapCache.set(lines, workingLines);
	return workingLines;
}
