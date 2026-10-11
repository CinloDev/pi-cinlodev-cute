import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { herdrAvailable, launchInHerdrTab, isTestEnvironment } from "../cute-notify.ts";

export function isExecutableInPath(name: string): boolean {
	const pathEnv = process.env.PATH || "";
	for (const dir of pathEnv.split(":")) {
		try {
			const full = path.join(dir, name);
			if (fs.existsSync(full) && (fs.statSync(full).mode & 0o111)) {
				return true;
			}
		} catch {}
	}
	return false;
}

export function detectTerminal(): string {
	if (process.env.TERMINAL && isExecutableInPath(process.env.TERMINAL)) {
		return process.env.TERMINAL;
	}
	for (const term of ["foot", "alacritty", "ghostty", "kitty"]) {
		if (isExecutableInPath(term)) {
			return term;
		}
	}
	return process.env.TERMINAL || "foot";
}

/**
 * Non-blocking editor launcher for project tree explorer.
 * Resolves $VISUAL / $EDITOR / nvim and spawns detached terminal window.
 */
export function launchEditor(targetPath?: string, cwd?: string): boolean {
	if (isTestEnvironment()) return true;
	const editor = process.env.VISUAL || process.env.EDITOR || "nvim";
	const workingDir = cwd || process.cwd();
	const filePath = targetPath
		? (path.isAbsolute(targetPath) ? targetPath : path.resolve(workingDir, targetPath))
		: workingDir;
	const title = `nvim: ${path.basename(filePath)}`;

	// 1. If running inside Herdr, open as a focused full-screen tab
	if (herdrAvailable()) {
		if (launchInHerdrTab(`${editor} "${filePath}"`, title, workingDir)) {
			return true;
		}
	}

	// 2. Fallback to external terminal (foot, alacritty, kitty, ghostty)
	try {
		const terminal = detectTerminal();
		const termBin = path.basename(terminal).toLowerCase();
		const winTitle = `CUTE: ${path.basename(filePath)}`;

		let args: string[];
		switch (termBin) {
			case "foot":
				args = ["--app-id=cute-editor", "-T", winTitle, editor, filePath];
				break;
			case "alacritty":
				args = ["--class", "cute-editor,cute-editor", "-t", winTitle, "-e", editor, filePath];
				break;
			case "kitty":
				args = ["--class=cute-editor", "-T", winTitle, editor, filePath];
				break;
			case "ghostty":
				args = ["--class=cute-editor", "-e", editor, filePath];
				break;
			default:
				args = ["-e", editor, filePath];
				break;
		}

		// Spawn terminal with editor directly detached so it works in any Wayland/X11 environment
		const child = spawn(terminal, args, {
			detached: true,
			stdio: "ignore",
			cwd: workingDir,
		});

		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		return false;
	}
}
