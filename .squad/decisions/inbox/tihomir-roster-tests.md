# Roster Robustness — Test Coverage Decision

**Author:** Tihomir (Tester)
**Date:** 2025-07-18
**Status:** IMPLEMENTED

## Summary

Added 14 tests for Strahinja's new roster robustness features (`getStats`, `needsReload`, `lastLoadedAt`) in `tests/unit/roster-tracker.test.ts`. Total roster-tracker tests: 42 (up from 28). All pass.

## Test Cases

| # | Area | Test | Status |
|---|------|------|--------|
| 1 | getStats | Returns zeros and loaded=false when not loaded | ✅ |
| 2 | getStats | Returns correct player/team/round counts after loading | ✅ |
| 3 | getStats | Returns normalized (lowercase) player names | ✅ |
| 4 | getStats | Counts unique teams across all rosters | ✅ |
| 5 | getStats | Returns zeros after loading empty rosters | ✅ |
| 6 | needsReload | True when rosters have never been loaded | ✅ |
| 7 | needsReload | False when rosters were recently loaded | ✅ |
| 8 | needsReload | True when stale (>1 hour, via fake timers) | ✅ |
| 9 | needsReload | False at 59-minute boundary | ✅ |
| 10 | needsReload | True after loading empty rosters | ✅ |
| 11 | lastLoadedAt | Null before any loading | ✅ |
| 12 | lastLoadedAt | Set to valid Date after non-empty load | ✅ |
| 13 | lastLoadedAt | Remains null after empty rosters load | ✅ |
| 14 | lastLoadedAt | Updates on subsequent loads (5s gap) | ✅ |

## Gap: `/rostercheck` Command Missing

The task requested tests for a `/rostercheck` command that would show roster status (loaded/not, player count, team count, last loaded time). **Strahinja did not implement this command.** The `RosterTracker.getStats()` method exists and is fully tested, but no command exposes it to users.

**Action for Strahinja:** Implement `/rostercheck` command in `command-router.ts` that calls `rosterTracker.getStats()` and formats the output. Tests will be added once the command exists.

## Previous Decision Superseded

This replaces the earlier `tihomir-roster-tests.md` — the old `loadFromFile` test failures noted there are now resolved (Strahinja cleaned up those methods and tests use `loadRosters()` directly).
