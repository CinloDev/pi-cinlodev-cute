import * as cp from "node:child_process";
import { truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderBoxCard, type CardTheme } from "../card-frame.ts";
import { openExternalFile } from "../editor-launcher.ts";

export interface GitFileChange {
	path: string;
	status: "modified" | "added" | "deleted" | "untracked" | "conflict";
	statusCode: string;
	linesAdded: number;
	linesDeleted: number;
}

export function fetchGitLogGraph(cwd: string, maxCommits = 30): string[] {
	try {
		const output = cp.execFileSync(
			"git",
			["log", "--graph", "--oneline", "--decorate", "-n", String(maxCommits)],
			{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
		);
		return output.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length > 0);
	} catch {
		return [];
	}
}

export function fetchGitBranches(cwd: string): string[] {
	try {
		const out = cp.execFileSync("git", ["branch", "-a"], {
			cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
		});
		return out.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
	} catch {
		return [];
	}
}

export function fetchGitFileChanges(cwd: string): GitFileChange[] {
	try {
		const statusOut = cp.execFileSync("git", ["status", "--porcelain=v1"], {
			cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
		});

		const numstatMap = new Map<string, { added: number; deleted: number }>();
		try {
			const numstatOut = cp.execFileSync("git", ["diff", "HEAD", "--numstat"], {
				cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
			});
			for (const line of numstatOut.split("\n")) {
				const parts = line.trim().split("\t");
				if (parts.length >= 3) {
					const a = parseInt(parts[0]!, 10) || 0;
					const d = parseInt(parts[1]!, 10) || 0;
					const filePath = parts.slice(2).join("\t").trim();
					numstatMap.set(filePath, { added: a, deleted: d });
				}
			}
		} catch {}

		const files: GitFileChange[] = [];
		for (const line of statusOut.split("\n")) {
			if (line.length < 3) continue;
			const statusCode = line.slice(0, 2);
			const filePath = line.slice(3).trim();
			const x = statusCode[0];
			const y = statusCode[1];

			let status: GitFileChange["status"] = "modified";
			if (x === "?" && y === "?") status = "untracked";
			else if (x === "A" || y === "A") status = "added";
			else if (x === "D" || y === "D") status = "deleted";
			else if (x === "U" || y === "U") status = "conflict";

			const num = numstatMap.get(filePath) ?? { added: 0, deleted: 0 };
			files.push({
				path: filePath,
				statusCode: statusCode.trim(),
				status,
				linesAdded: num.added,
				linesDeleted: num.deleted,
			});
		}
		return files;
	} catch {
		return [];
	}
}

export function colorizeGitGraphLine(line: string, theme?: CardTheme): string {
	if (!line.trim() || !theme?.fg) return line;

	if (/^[\\/|_\s]+$/.test(line)) {
		return line.replace(/([\\/|_]+)/g, (m) => theme.fg!("dim", m));
	}

	const m = /^([*\\/|_\s]*[*][*\\/|_\s]*)\s+([0-9a-f]{7,40})\s*(?:\(([^)]+)\))?\s*(.*)$/.exec(line);
	if (!m) {
		return line.replace(/^([*\\/|_\s]+)/, (graph) =>
			graph
				.replace(/(\*)/g, (s) => theme.fg!("accent", s))
				.replace(/([\\/|_]+)/g, (s) => theme.fg!("dim", s)),
		);
	}

	const graphPart = m[1]!;
	const hash = m[2]!;
	const refs = m[3];
	const subject = m[4]!;

	const coloredGraph = graphPart.replace(/(\*)|([\\/|_]+)/g, (_m, star, edge) => {
		if (star) return theme.fg!("accent", star);
		return theme.fg!("dim", edge);
	});

	const coloredHash = theme.fg("warning", hash);
	let coloredRefs = "";
	if (refs) {
		coloredRefs = ` ${theme.fg("muted", `(${refs})`)}`;
	}
	const coloredSubject = subject ? ` ${theme.fg("text", subject)}` : "";

	return `${coloredGraph} ${coloredHash}${coloredRefs}${coloredSubject}`;
}

export class GitGraphCard implements Component {
	private readonly cwd: string;
	private readonly theme?: CardTheme;
	private scrollOffset = 0;
	private viewMode: "graph" | "branches" = "graph";
	private selectedBranch?: string;
	private hitboxes: Array<{ lineIndex: number; branch?: string }> = [];

	constructor(cwd: string, theme?: CardTheme) {
		this.cwd = cwd;
		this.theme = theme;
		this.handleRailWheel = this.handleRailWheel.bind(this);
		this.handleRailClick = this.handleRailClick.bind(this);
		this.handleMouse = this.handleMouse.bind(this);
	}

	invalidate(): void {
		this.scrollOffset = 0;
	}

	digest(): string {
		return `${this.viewMode}:${this.selectedBranch ?? ""}:${this.scrollOffset}`;
	}

	handleRailClick(lineIndex: number, _button?: string): boolean {
		if (lineIndex === 0) {
			this.viewMode = this.viewMode === "graph" ? "branches" : "graph";
			this.scrollOffset = 0;
			return true;
		}
		if (this.viewMode === "branches") {
			const hit = this.hitboxes.find((h) => h.lineIndex === lineIndex);
			if (hit?.branch) {
				const cleanBranch = hit.branch.replace(/^\*\s*/, "").trim();
				this.selectedBranch = this.selectedBranch === cleanBranch ? undefined : cleanBranch;
				return true;
			}
		}
		return false;
	}

	handleRailWheel(delta: number): boolean {
		const newOffset = Math.max(0, this.scrollOffset + delta);
		if (newOffset !== this.scrollOffset) {
			this.scrollOffset = newOffset;
			return true;
		}
		return false;
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean; render?: boolean } | undefined {
		if (event.type === "click") {
			const handled = this.handleRailClick(event.y, event.button);
			if (handled) return { handled: true, render: true };
		} else if (event.type === "wheel") {
			const handled = this.handleRailWheel(event.wheelDelta ?? 0);
			if (handled) return { handled: true, render: true };
		}
		return undefined;
	}

	render(width: number, availableHeight?: number): string[] {
		const maxViewLines = typeof availableHeight === "number" ? Math.max(4, availableHeight - 4) : 10;
		this.hitboxes = [{ lineIndex: 0 }];

		if (this.viewMode === "branches") {
			const branches = fetchGitBranches(this.cwd);
			const maxScroll = Math.max(0, branches.length - maxViewLines);
			if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

			const slice = branches.slice(this.scrollOffset, this.scrollOffset + maxViewLines);
			const body: string[] = [];
			for (const branch of slice) {
				const isCurrent = branch.startsWith("*");
				const cleanName = branch.replace(/^\*\s*/, "").trim();
				const isSelected = this.selectedBranch === cleanName;
				const icon = isCurrent ? "● " : "○ ";
				const nameStyled = isSelected && this.theme?.bold ? this.theme.bold(cleanName) : cleanName;
				body.push(`${icon}${nameStyled}`);
			}

			const hint = `[Grafo] · Ramas (${branches.length})`;
			const cardLines = renderBoxCard("Git Branches", body, width, this.theme, { hint });

			let searchFrom = 1;
			for (const branch of slice) {
				const cleanName = branch.replace(/^\*\s*/, "").trim();
				for (let idx = searchFrom; idx < cardLines.length - 1; idx++) {
					if (cardLines[idx]?.includes(cleanName)) {
						this.hitboxes.push({ lineIndex: idx, branch });
						searchFrom = idx + 1;
						break;
					}
				}
			}
			return cardLines;
		}

		const rawLines = fetchGitLogGraph(this.cwd);
		const maxScroll = Math.max(0, rawLines.length - maxViewLines);
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		const slice = rawLines.slice(this.scrollOffset, this.scrollOffset + maxViewLines);
		const body = slice.length > 0
			? slice.map((line) => colorizeGitGraphLine(line, this.theme))
			: ["(sin historial)"];

		const hint = rawLines.length > maxViewLines
			? `${this.scrollOffset + 1}-${Math.min(rawLines.length, this.scrollOffset + maxViewLines)}/${rawLines.length} · [Ramas]`
			: "Grafo · [Ramas]";

		return renderBoxCard("Git Graph", body, width, this.theme, { hint });
	}
}

export class WorkingTreeCard implements Component {
	private readonly cwd: string;
	private readonly theme?: CardTheme;
	private scrollOffset = 0;
	private hitboxes: Array<{ lineIndex: number; filePath: string }> = [];

	constructor(cwd: string, theme?: CardTheme) {
		this.cwd = cwd;
		this.theme = theme;
		this.handleRailWheel = this.handleRailWheel.bind(this);
		this.handleRailClick = this.handleRailClick.bind(this);
		this.handleMouse = this.handleMouse.bind(this);
	}

	invalidate(): void {
		this.scrollOffset = 0;
	}

	digest(): string {
		return `${this.scrollOffset}`;
	}

	handleRailClick(lineIndex: number): boolean {
		const hit = this.hitboxes.find((h) => h.lineIndex === lineIndex);
		if (hit) {
			openExternalFile(hit.filePath, this.cwd);
			return true;
		}
		return false;
	}

	handleRailWheel(delta: number): boolean {
		const newOffset = Math.max(0, this.scrollOffset + delta);
		if (newOffset !== this.scrollOffset) {
			this.scrollOffset = newOffset;
			return true;
		}
		return false;
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean; render?: boolean } | undefined {
		if (event.type === "click") {
			const handled = this.handleRailClick(event.y);
			if (handled) return { handled: true, render: true };
		} else if (event.type === "wheel") {
			const handled = this.handleRailWheel(event.wheelDelta ?? 0);
			if (handled) return { handled: true, render: true };
		}
		return undefined;
	}

	render(width: number, availableHeight?: number): string[] {
		const files = fetchGitFileChanges(this.cwd);
		const maxViewLines = typeof availableHeight === "number" ? Math.max(4, availableHeight - 4) : 8;

		const maxScroll = Math.max(0, files.length - maxViewLines);
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		const slice = files.slice(this.scrollOffset, this.scrollOffset + maxViewLines);
		const body: string[] = [];

		if (files.length === 0) {
			body.push("Working tree limpio");
		} else {
			for (const file of slice) {
				const badge = file.status === "added" ? "+" :
					file.status === "deleted" ? "−" :
					file.status === "untracked" ? "?" : "M";

				const diffInfo = (file.linesAdded > 0 || file.linesDeleted > 0)
					? ` +${file.linesAdded} −${file.linesDeleted}`
					: "";

				body.push(`${badge} ${file.path}${diffInfo}`);
			}
		}

		const hint = files.length > maxViewLines
			? `${this.scrollOffset + 1}-${Math.min(files.length, this.scrollOffset + maxViewLines)}/${files.length}`
			: files.length > 0 ? `${files.length} modificados` : undefined;

		const cardLines = renderBoxCard("Working Tree", body, width, this.theme, { hint });

		this.hitboxes = [];
		let searchFrom = 1;
		for (const file of slice) {
			for (let idx = searchFrom; idx < cardLines.length - 1; idx++) {
				if (cardLines[idx]?.includes(file.path)) {
					this.hitboxes.push({ lineIndex: idx, filePath: file.path });
					searchFrom = idx + 1;
					break;
				}
			}
		}

		return cardLines;
	}
}
