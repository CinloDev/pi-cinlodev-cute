/**
 * Module barrel for CUTE Transcript functionality.
 * Re-exports domain-specific modules from src/transcript/ to maintain backward compatibility.
 */

// 1. Terminal visible width & ANSI-safe slicing / framing
export * from "./transcript/transcript-ansi.ts";

// 2. Native float / outline card unwrappers and clean-up regexes
export * from "./transcript/transcript-unwrap.ts";

// 3. Dracula-style single-line code highlighting
export * from "./transcript/transcript-highlight.ts";

// 4. System tool formatters (bash, grep, read, write / diffs)
export * from "./transcript/transcript-tools-system.ts";

// 5. Specialized tool formatters (review, memory, subagent, fetch, search)
export * from "./transcript/transcript-tools-special.ts";

// 6. Assistant markdown prose & git fence styling
export * from "./transcript/transcript-prose.ts";

// 7. Component detection, mouse proxying & transcript child/children dispatcher
export * from "./transcript/transcript-dispatcher.ts";
