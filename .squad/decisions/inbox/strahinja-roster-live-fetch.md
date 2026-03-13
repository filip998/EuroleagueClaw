# /roster Live Fetch — Strahinja (2025-07-18)

**Status:** IMPLEMENTED

**Decision:** `/roster` command now always fetches live roster data from the Dunkest API instead of showing stale startup-cached data.

## Root Cause

Rosters were fetched once at boot in `container.ts` and stored in `RosterTracker`. The `/roster` handler just read that cached state — never calling the API again. Users saw stale data that didn't reflect roster changes made after bot startup.

## Solution

- Added `FantasyPort` and `fantasyTeamIds` to `CommandRouterDeps`
- `/roster` handler calls `fantasyPort.getRosters(fantasyTeamIds)` for fresh data on every invocation
- Falls back gracefully to cached data if the live fetch fails
- Startup pre-load in `container.ts` preserved — still needed for the `onRosterEvent` PBP callback in `GameTracker`

## Dead Code Removed

- `RosterTracker.loadFromFile()` — was reading `data/rosters.json` via `readFileSync` (domain-layer fs import, architectural violation flagged by Bogdan)
- `RosterTracker.loadFromFileAndMerge()` — never called
- `RosterTracker.mergeRosters()` — never called
- `import { readFileSync } from 'node:fs'` — no longer needed

## Impact

- 4 files modified: `command-router.ts`, `container.ts`, `roster-tracker.ts`, `roster-tracker.test.ts`
- 3 stale `loadFromFile` tests removed, remaining tests updated to use `loadRosters()` directly
- All 209 unit tests pass, TypeScript build clean
- Partially addresses Bogdan's architecture review finding #1 (domain importing `readFileSync`) — removed from `roster-tracker.ts`, still exists in `trivia-service.ts`
