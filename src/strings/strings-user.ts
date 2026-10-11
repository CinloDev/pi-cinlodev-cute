import { execSync } from "node:child_process";
import * as os from "node:os";

let detectedUser: string | null = null;

export function resetDetectedUser(): void {
	detectedUser = null;
}

/**
 * Auto-detect user name from git config (user.name) or operating system / env,
 * falling back to "Developer" if unavailable.
 */
export function detectSystemUser(): string {
	if (detectedUser !== null) return detectedUser;
	try {
		const gitName = execSync("git config user.name", {
			encoding: "utf8",
			timeout: 500,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (gitName.length > 0) {
			detectedUser = gitName;
			return detectedUser;
		}
	} catch {}
	try {
		const osUser = os.userInfo()?.username || process.env.USER || process.env.USERNAME;
		if (osUser && osUser.trim().length > 0) {
			detectedUser = osUser.trim();
			return detectedUser;
		}
	} catch {}
	detectedUser = "Developer";
	return detectedUser;
}
