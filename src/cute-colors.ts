import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface CuteColors {
	userMessage: string;
	bashMessage: string;
	bashOutput: string;
	readMessage: string;
	writeMessage: string;
	errorMessage: string;
	gentleCardSuccess: string;
	gentleCardWarning: string;
	gentleCardError: string;
	sidebarBorder: string;
}

export const CUTE_COLORS_FILENAME = "CinlodevCute.colors.json";

export const DEFAULT_CUTE_COLORS: CuteColors = {
	userMessage: "heading",
	bashMessage: "bash",
	bashOutput: "bashOutput",
	readMessage: "read",
	writeMessage: "write",
	errorMessage: "error",
	gentleCardSuccess: "gentle",
	gentleCardWarning: "warning",
	gentleCardError: "error",
	sidebarBorder: "border",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPackageClone(dir: string): boolean {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		return pkg?.name === "pi-cinlodev-cute";
	} catch {
		return false;
	}
}

function candidateColorsFiles(): string[] {
	const candidates: string[] = [];

	const add = (candidate: string) => {
		if (candidates.indexOf(candidate) === -1) candidates.push(candidate);
	};

	// 1. Package defaults (repo clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
		add(path.join(packageDir, "config", CUTE_COLORS_FILENAME));
		add(path.join(packageDir, "themes", CUTE_COLORS_FILENAME));
	} catch {}

	// 2. User-level global overrides (~/.pi/agent, outside git, persistent across updates)
	try {
		const agentDir = path.join(os.homedir(), ".pi", "agent");
		add(path.join(agentDir, "cute.json"));
		add(path.join(agentDir, "cinlodev-cute.json"));
		add(path.join(agentDir, "cute", CUTE_COLORS_FILENAME));
		add(path.join(agentDir, "cinlodev-cute", CUTE_COLORS_FILENAME));
	} catch {}

	// 3. Workspace / Project-level overrides (.pi/ in cwd, only when outside package clone)
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const packageDir = path.resolve(here, "..");
		const cwd = path.resolve(process.cwd());
		if (cwd !== packageDir && !isPackageClone(cwd)) {
			add(path.join(cwd, ".pi", "cute.json"));
			add(path.join(cwd, ".pi", "cinlodev-cute.json"));
		}
	} catch {}

	return candidates;
}

function mergeColors(raw: unknown, current: CuteColors): CuteColors {
	if (!isRecord(raw)) return current;
	const source = isRecord(raw.colors) ? raw.colors : raw;
	return {
		userMessage: typeof source.userMessage === "string" ? source.userMessage : current.userMessage,
		bashMessage: typeof source.bashMessage === "string" ? source.bashMessage : current.bashMessage,
		bashOutput: typeof source.bashOutput === "string" ? source.bashOutput : current.bashOutput,
		readMessage: typeof source.readMessage === "string" ? source.readMessage : current.readMessage,
		writeMessage: typeof source.writeMessage === "string" ? source.writeMessage : current.writeMessage,
		errorMessage: typeof source.errorMessage === "string" ? source.errorMessage : current.errorMessage,
		gentleCardSuccess: typeof source.gentleCardSuccess === "string" ? source.gentleCardSuccess : current.gentleCardSuccess,
		gentleCardWarning: typeof source.gentleCardWarning === "string" ? source.gentleCardWarning : current.gentleCardWarning,
		gentleCardError: typeof source.gentleCardError === "string" ? source.gentleCardError : current.gentleCardError,
		sidebarBorder: typeof source.sidebarBorder === "string" ? source.sidebarBorder : current.sidebarBorder,
	};
}

let cachedColors: CuteColors | null = null;

export function loadCuteColors(): CuteColors {
	if (cachedColors) return cachedColors;
	let current: CuteColors = { ...DEFAULT_CUTE_COLORS };
	for (const file of candidateColorsFiles()) {
		try {
			if (!fs.existsSync(file)) continue;
			const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
			current = mergeColors(parsed, current);
		} catch {}
	}
	cachedColors = current;
	return cachedColors;
}

export function resetCuteColorsCache(): void {
	cachedColors = null;
}
