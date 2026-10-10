/**
 * Module barrel for CUTE Git functionality.
 * Re-exports domain-specific modules from src/git/ to maintain backward compatibility.
 */

// 1. Pure Git CLI commands, porcelain parsers, and TTL caches
export * from "./git/git-cli.ts";

// 2. Shared interactive state (selected branch, view mode)
export * from "./git/git-state.ts";

// 3. Dracula syntax styling and Git status badge formatters
export * from "./git/git-styles.ts";

// 4. Detached terminal and Herdr diff launchers
export * from "./git/git-launchers.ts";

// 5. Visual cards
export { CinlodevGitGraphCard } from "./git/git-graph-card.ts";
export { CinlodevWorkingTreeCard } from "./git/git-working-tree-card.ts";
