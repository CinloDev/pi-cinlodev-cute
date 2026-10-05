import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";

const HERDR_BIN = process.env.HERDR_BIN_PATH ?? "herdr";

/** Check whether we are currently running inside a Herdr environment. */
export function herdrAvailable(): boolean {
	return Boolean(process.env.HERDR_SOCKET_PATH || process.env.HERDR_ENV);
}

/** Dispatch a desktop notification through Herdr non-blockingly. */
export function notifyHerdr(message: string, body?: string): boolean {
	if (!herdrAvailable()) return false;
	const args = ["notification", "show", message];
	if (body) args.push("--body", body);
	try {
		const child = spawn(HERDR_BIN, args, { stdio: "ignore", detached: true });
		child.unref?.();
		return true;
	} catch {
		try {
			execFileSync(HERDR_BIN, args, { stdio: "ignore", timeout: 1000 });
			return true;
		} catch {
			return false;
		}
	}
}

/** Check whether we are running inside an automated test suite. */
export function isTestEnvironment(): boolean {
	return Boolean(
		process.env.NODE_ENV === "test" ||
		process.env.CUTE_TEST_MODE === "1" ||
		process.argv.some((arg) => arg.includes("--test") || arg.includes(".test.ts")),
	);
}

/**
 * Launches an interactive command inside a new focused Herdr tab.
 */
export function launchInHerdrTab(command: string, label: string, cwd?: string): boolean {
	if (isTestEnvironment()) return true;
	if (!herdrAvailable()) return false;
	try {
		const workingDir = cwd || process.cwd();
		const out = execFileSync(
			HERDR_BIN,
			["tab", "create", "--cwd", workingDir, "--label", label, "--focus"],
			{ encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
		);
		const parsed = JSON.parse(out);
		const paneId = parsed?.result?.root_pane?.pane_id;
		if (paneId) {
			execFileSync(HERDR_BIN, ["pane", "run", paneId, command], {
				encoding: "utf8",
				timeout: 2000,
				stdio: ["ignore", "pipe", "ignore"],
			});
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

export type NotificationType = "info" | "warning" | "error";

/**
 * Send notification through Herdr if available; otherwise falls back to Pi TUI toast.
 */
export function notify(
	ctx?: ExtensionContext,
	message = "",
	bodyOrType?: string,
	type: NotificationType = "info",
): boolean {
	let body: string | undefined;
	let resolvedType: NotificationType = type;

	if (bodyOrType === "info" || bodyOrType === "warning" || bodyOrType === "error") {
		resolvedType = bodyOrType as NotificationType;
	} else if (typeof bodyOrType === "string") {
		body = bodyOrType;
	}

	if (notifyHerdr(message, body)) return true;
	if (ctx?.hasUI && typeof ctx.ui?.notify === "function") {
		try {
			const text = body ? `${message}: ${body}` : message;
			ctx.ui.notify(text, resolvedType);
		} catch {}
	}
	return false;
}
