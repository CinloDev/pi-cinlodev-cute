/**
 * Backward compatibility facade for pi-persistent-memory.
 * Re-exports from src/memory/ so that existing imports, tests and configs continue working seamlessly.
 */

export {
	DEFAULT_PERSISTENT_MEMORY_URL as DEFAULT_MEMORY_GRAPH_URL,
	DEFAULT_PERSISTENT_MEMORY_URL,
	DEFAULT_PERSISTENT_MEMORY_DB_PATH,
	type PersistentMemoryStats,
	type MemoryGraphStats,
	type RetainMemoryOptions,
	normalizeGitRemoteUrl,
	resolvePersistentMemoryScope,
	resolvePersistentMemoryDbCandidate as resolveMemoryGraphDbCandidate,
	resolvePersistentMemoryDbCandidate,
	checkPersistentMemoryServerHealth,
	openPersistentMemoryExplorer as openMemoryGraphExplorer,
	openPersistentMemoryExplorer,
	extractSessionTakeaways,
	queryPersistentMemoryStats as queryMemoryGraphStats,
	queryPersistentMemoryStats,
	retainPersistentMemory,
	retainMemoryRecord,
	resetPersistentMemoryCache as resetMemoryGraphCache,
	resetPersistentMemoryCache,
} from "./memory/memory-client.ts";

export {
	CinlodevPersistentMemoryCard as CinlodevMemoryGraphCard,
	CinlodevPersistentMemoryCard,
} from "./memory/memory-card.ts";
