/**
 * Module barrel for CUTE Profiles functionality.
 * Re-exports domain-specific modules from src/profiles/ to maintain backward compatibility.
 */

// 1. Core SDD profiles service, accounts, and effort toggling
export * from "./profiles/profiles-service.ts";

// 2. Task Manager telemetry sync
export * from "./profiles/profiles-task-sync.ts";

// 3. Quota accounts resolution re-export
export { fetchUsageAccounts as fetchQuotaAccounts } from "./cute-usage.ts";

// 4. Visual Card
export { CinlodevProfilesExtendedCard } from "./profiles/profiles-card.ts";
