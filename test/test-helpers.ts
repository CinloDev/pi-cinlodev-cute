import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { resetCuteGlyphsCache } from "../src/cute-theme.ts";
import { resetCuteStringsCache } from "../src/cute-strings.ts";
import { resetCuteLayoutCache } from "../src/cute-layout.ts";
import { resetCutePathsCache, resetActiveProfileCache } from "../src/cute-paths.ts";
import { resetCuteColorsCache } from "../src/cute-colors.ts";
import {
	resetGitGraphCache,
	resetGitStatusCache,
	resetGitFileChangesCache,
	resetGitTabState,
} from "../src/cute-git-graph.ts";
import { resetUsageCache } from "../src/cute-usage.ts";
import { resetEngramCache } from "../src/cute-engram.ts";
import { resetMemoryGraphCache } from "../src/cute-memory-graph.ts";

// Isolated ephemeral test sandbox directory so tests NEVER mutate or unlink the real ~/.pi/agent/cute.json
export const testAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cute-test-agent-"));
process.env.PI_AGENT_DIR = testAgentDir;
export const userConfigFile = path.join(testAgentDir, "cute.json");

process.on("exit", () => {
	try {
		fs.rmSync(testAgentDir, { recursive: true, force: true });
	} catch {}
});

export function resetAll() {
	resetCuteGlyphsCache();
	resetCuteStringsCache();
	resetCuteLayoutCache();
	resetCutePathsCache();
	resetCuteColorsCache();
	resetActiveProfileCache();
	resetGitGraphCache();
	resetGitStatusCache();
	resetGitFileChangesCache();
	resetGitTabState();
	resetUsageCache();
	resetEngramCache();
	resetMemoryGraphCache();
}
