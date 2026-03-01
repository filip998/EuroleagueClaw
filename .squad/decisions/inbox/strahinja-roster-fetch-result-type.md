# Decision: FantasyPort.getRosters returns RosterFetchResult

**Author:** Strahinja (Backend Dev)
**Date:** 2026-03-05
**Status:** IMPLEMENTED

## Context

The `FantasyPort.getRosters()` method previously returned `FantasyRoster[]`, losing matchday context. This caused the "Round 0" bug in `/roster` output because `RosterTracker.loadRosters()` had no way to know the current matchday number.

## Decision

Changed `getRosters()` return type from `FantasyRoster[]` to `RosterFetchResult { matchdayNumber: number; rosters: FantasyRoster[] }`. The adapter now fetches matchday number from the public `/leagues/10/config` endpoint and team names from the authenticated `/user/fantasy-teams` endpoint.

## Impact

- `FantasyPort` interface changed — any new adapter implementing this port must return `RosterFetchResult`
- `RosteredPlayer` type extended with optional fields: `position`, `isCaptain`, `isOnFire`, `opponentCode`, `courtPosition`
- Test mocks updated accordingly
