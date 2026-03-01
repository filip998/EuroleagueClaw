# Arena Sport TV Schedule Integration — Strahinja (2026-07-18)

**Status:** IMPLEMENTED

**Decision:** Add TV channel info to `/games` output via Arena Sport schedule scraping.

## Architecture

Full hexagonal pattern:
- **Port:** `TvSchedulePort` — clean interface decoupled from Arena Sport specifics
- **Adapter:** `ArenaSportAdapter` — scrapes tvarenasport.com, filters EuroLeague, 1-hour cache
- **Integration:** `CommandRouter` enriches `RoundGame[]` before composing message

## Key Decisions

1. **No HTML parsing dependency** — Uses regex + `window.TV_SCHEMES` JSON extraction. No cheerio/jsdom needed.
2. **Completely optional** — If Arena Sport fails, `/games` works identically to before. Graceful degradation at every level.
3. **Fuzzy team matching** — Compares TV title against shortName, full name, and team code (all lowercase). Handles Serbian names (Barselona, Partizan, etc.).
4. **1-hour cache** — Arena Sport publishes a full week schedule. Stale cache returned on fetch failures.
5. **TV channel shown for upcoming games only** — Finished games don't need TV info.

## Files

| File | Action |
|------|--------|
| `src/ports/tv-schedule.port.ts` | CREATE — TvSchedulePort interface + TvScheduleEntry type |
| `src/adapters/tv-schedule/arena-sport.adapter.ts` | CREATE — Adapter with JSON + HTML parsing |
| `src/domain/types.ts` | MODIFY — Added `tvChannel?: string` to RoundGame |
| `src/domain/command-router.ts` | MODIFY — Added tvSchedule dep, enrichWithTvInfo(), matchTvEntry() |
| `src/domain/message-composer.ts` | MODIFY — Show 📺 tag for games with tvChannel |
| `src/container.ts` | MODIFY — Wire ArenaSportAdapter |
| `tests/unit/arena-sport-adapter.test.ts` | CREATE — 13 tests for parsing, filtering, caching, graceful degradation |
| `tests/unit/command-router.test.ts` | MODIFY — 1 new test for TV enrichment in /games |

## Test Results

175 tests passing (14 new), build clean.
