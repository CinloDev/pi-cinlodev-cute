import cp from "node:child_process";

/**
 * Safely launches an external file in the user's preferred editor ($VISUAL, $EDITOR, or code).
 * Traps errors to prevent uncaught exceptions on missing executables, and supports Windows batch resolution.
 */
export function openExternalFile(filePath: string, cwd?: string): void {
	try {
		const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "code.cmd" : "code");
		const child = cp.spawn(editor, [filePath], {
			cwd: cwd ?? process.cwd(),
			detached: true,
			stdio: "ignore",
			shell: process.platform === "win32",
		});
		child.on("error", () => {
			if (process.platform === "win32") {
				try {
					const fallback = cp.spawn("notepad.exe", [filePath], {
						detached: true,
						stdio: "ignore",
					});
					fallback.on("error", () => {});
					fallback.unref();
				} catch {}
			}
		});
		child.unref();
	} catch {}
}

export function openExternalUrl(url: string): void {
	try {
		const openCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
		const child = cp.spawn(openCmd, [url], {
			detached: true,
			stdio: "ignore",
			shell: true,
		});
		child.on("error", () => {});
		child.unref();
	} catch {}
}
