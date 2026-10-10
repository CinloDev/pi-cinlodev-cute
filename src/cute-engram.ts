/**
 * Module barrel for CUTE Engram functionality.
 * Re-exports domain-specific modules from src/engram/ to maintain backward compatibility.
 */

// 1. Core Engram daemon client, Cloud replication, and search parsers
export * from "./engram/engram-client.ts";

// 2. Interactive Engram Daemon & Cloud Health Card
export { CinlodevEngramCard, getLastRenderedSnapshot } from "./engram/engram-card.ts";

// 3. Interactive Engram Handoff & Session Summary Card
export { CinlodevEngramHandoffCard } from "./engram/engram-handoff-card.ts";
