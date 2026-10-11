import * as path from "node:path";
import * as os from "node:os";
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

export const userConfigFile = path.join(os.homedir(), ".pi", "agent", "cute.json");

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
