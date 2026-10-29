import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface CardTheme {
	fg?(color: string, text: string): string;
	bold?(text: string): string;
}

export interface CardOptions {
	hint?: string;
	expanded?: boolean;
}

export function renderBoxCard(
	title: string,
	bodyLines: string[],
	width: number,
	theme?: CardTheme,
	options?: CardOptions,
): string[] {
	const safeWidth = Math.max(16, width);
	const innerWidth = Math.max(1, safeWidth - 4); // │ + space + content + space + │

	const fg = (color: string, text: string) => (theme?.fg ? theme.fg(color, text) : text);
	const bold = (text: string) => (theme?.bold ? theme.bold(text) : text);

	const border = (char: string) => fg("border", char);
	const hintRaw = options?.hint ? options.hint.trim() : "";
	const hintLen = hintRaw ? visibleWidth(hintRaw) : 0;

	// Max title length so title + hint fit within innerWidth
	const maxTitleLen = Math.max(1, innerWidth - (hintLen > 0 ? hintLen + 2 : 0));
	const titleTrunc = truncateToWidth(title, maxTitleLen, "");
	const titleStyled = bold(fg("accent", titleTrunc));
	const titleLen = visibleWidth(titleTrunc);

	const hintTrunc = hintLen > 0 ? truncateToWidth(hintRaw, Math.max(0, innerWidth - titleLen - 1), "") : "";
	const hintStyled = hintTrunc ? fg("muted", ` ${hintTrunc}`) : "";
	const finalHintLen = hintTrunc ? visibleWidth(hintTrunc) + 1 : 0;

	const fillLen = Math.max(0, innerWidth - titleLen - finalHintLen);
	const top = `${border("┌─ ")}${titleStyled}${fillLen > 0 ? border(` ${"─".repeat(fillLen - 1)}`) : ""}${hintStyled}${border("─┐")}`;
	const bottom = border(`└${"─".repeat(safeWidth - 2)}┘`);

	const contentRows = bodyLines.length > 0 ? bodyLines : [fg("muted", "(vacío)")];
	const rows: string[] = [top];

	for (const line of contentRows) {
		const clipped = truncateToWidth(line, innerWidth, "…");
		const len = visibleWidth(clipped);
		const pad = " ".repeat(Math.max(0, innerWidth - len));
		rows.push(`${border("│ ")}${clipped}${pad}${border(" │")}`);
	}

	rows.push(bottom);
	return rows.map((r) => truncateToWidth(r, safeWidth, ""));
}
