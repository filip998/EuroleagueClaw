# Decision: Roster Matching Robustness — Lazy Loading Pattern

**Author:** Strahinja (Backend Dev)
**Date:** 2026-07-18
**Status:** IMPLEMENTED

## Context

Roster matching silently failed during live games when the startup Dunkest API fetch failed. The `onPlayByPlay` callback checked `isLoaded()` and returned immediately with zero logging. This caused Nadir Hifi's PBP events to be missed entirely during the PRS vs ASV game.

## Decision

1. **Lazy roster loading with cooldown** — When PBP events arrive and rosters aren't loaded, attempt a Dunkest API fetch. 5-minute cooldown prevents API hammering on repeated failures.

2. **Diagnostic command `/rostercheck`** — Exposes roster load status, player count, indexed names, and last-loaded timestamp for debugging name matching issues in production.

3. **Warning-level logging** — All silent failure points now log at WARN level. PBP roster matches log at DEBUG level.

## Pattern: Lazy Loading with Cooldown

This pattern (attempt load on first use, with cooldown on failure) can be reused for any external data source that:
- Is loaded at startup but may fail transiently
- Is needed during real-time event processing
- Should not block startup if unavailable

## Files Changed

- `src/container.ts` — `tryLazyRosterLoad()` with `lastRosterLoadAttempt` cooldown
- `src/domain/roster-tracker.ts` — `RosterStats`, `getStats()`, `needsReload()`, `lastLoadedAt`
- `src/domain/command-router.ts` — `/rostercheck` command
- `src/domain/message-composer.ts` — `composeRosterStatus()`

## Impact

- No breaking changes to existing APIs or tests
- All 223 unit tests passing
- Build clean
