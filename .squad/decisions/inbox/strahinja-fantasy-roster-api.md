# Fantasy Roster API — Implementation Decision

**Author:** Strahinja (Backend Dev)
**Date:** 2025-07-18
**Status:** IMPLEMENTED

---

## Decision

Implemented automatic roster fetching from the Dunkest API with JSON file fallback. The API is preferred when `DUNKEST_BEARER_TOKEN` and `DUNKEST_FANTASY_TEAM_IDS` are both configured; otherwise `data/rosters.json` is used.

## Key Design Choices

1. **`createContainer` is now async** — Required because roster fetching hits the network. `index.ts` already runs inside an async `main()`, so this is a clean change.

2. **Defensive API parsing** — The roster endpoint response format is unverified. The adapter tries multiple plausible field names for players, team codes, and owner names. It logs raw response structure at debug level for first-time debugging.

3. **Public matchday endpoint** — Current matchday ID is fetched from `/leagues/10/config` (no auth needed) before fetching rosters. This avoids needing a hardcoded matchday ID.

4. **`normalizeName` is now public static** — Changed from private instance method to `RosterTracker.normalizeName()` for reuse in name matching across components.

5. **Shared `buildIndex` method** — Both `loadFromFile` and `loadRosters` use the same internal `buildIndex()` to avoid duplicated indexing logic.

## Files Changed

| File | Change |
|------|--------|
| `src/config.ts` | Added `fantasyTeamIds` to dunkest config |
| `src/ports/fantasy.port.ts` | Added `getRosters` method |
| `src/adapters/dunkest/dunkest.adapter.ts` | Implemented `getRosters` with defensive parsing |
| `src/domain/roster-tracker.ts` | Added `loadRosters`, public static `normalizeName`, `buildIndex` |
| `src/container.ts` | Async, API-first roster loading with file fallback |
| `src/index.ts` | Await `createContainer` |
| `tests/unit/fantasy-tracker.test.ts` | Added `getRosters` to mock |

## Next Steps

- Once Filip provides his bearer token and team IDs, set `DUNKEST_BEARER_TOKEN` and `DUNKEST_FANTASY_TEAM_IDS` in `.env` and test live.
- Check debug logs for the raw response structure to tighten up the defensive parsing.
- Consider the batch endpoint (`/fantasy-leagues/{leagueId}/rosters`) if a private league ID is available.
