# Decisions

<!-- Append-only. Newest entries at the bottom. -->

## User Directive — Filip Tanic (2026-03-01)

**Status:** CAPTURED

**Decision:** Always use the best possible models. Unlimited budget. Optimize for precision, code quality, code structure, modern tools, modern languages, and expandability. Never optimize for cost.

---

## DevOps Hire Evaluation — Bogdan (2026-03-01)

**Status:** DECISION MADE

**Verdict:** Don't Hire

EuroleagueClaw does **not** need a dedicated DevOps team member. The deployment footprint is too small to justify a specialist.

### Analysis

| Asset | Status | Notes |
|-------|--------|-------|
| Dockerfile | ✅ Done | Multi-stage build, well-structured |
| docker-compose.yml | ✅ Done | Local dev only, simple single-service setup |
| GitHub Actions CI | ⚠️ Broken | `squad-ci.yml` runs `node --test test/*.test.js` — project uses **vitest**, not Node's built-in test runner |
| CD pipeline | ❌ Missing | No workflow to build image → push to ACR → deploy to Azure Container Apps |
| Infrastructure-as-Code | ❌ Missing | No Bicep/Terraform; README has manual `az` CLI instructions |
| Azure Files mount | ❌ Missing | Required for SQLite persistence, documented in README but not automated |

### Why Not Hire

1. **Single-container architecture.** One bot process, one SQLite file, one health endpoint. Azure Container Apps handles scaling, restarts, TLS, and health checks out of the box.

2. **The gap is one-time setup, not ongoing work.** What's missing is:
   - A CI workflow (~30 lines): lint + vitest
   - A CD workflow (~60 lines): docker build → ACR push → `az containerapp update`
   - Azure resource provisioning: Container App Environment + ACR + Azure Files share
   - Secrets wired in GitHub Actions + Azure
   
   This is a week of work, not a full-time role.

3. **No operational complexity.** SQLite prevents horizontal scaling (max-replicas=1 is already set). No database migrations. No multi-region. No blue-green needed for a Telegram bot that reconnects automatically.

4. **Well-documented territory.** GitHub Actions + Azure Container Apps is a standard pattern with official docs and examples.

### What To Do Instead

**Task Strahinja (Backend Dev)** with:

1. **Fix CI** — Replace `node --test test/*.test.js` with `npm ci && npm run lint && npm test` in `squad-ci.yml`
2. **Add CD workflow** — New `deploy.yml` that builds the Docker image, pushes to ACR, and runs `az containerapp update` on push to `main`
3. **One-time Azure setup** — Document or script (Bicep) the resource creation: Container App Environment, ACR, Azure Files share for `/app/data`
4. **Secrets** — `TELEGRAM_BOT_TOKEN` + `AZURE_CREDENTIALS` in GitHub Actions secrets; remaining env vars in Container App config

---

## Architecture Review — Bogdan (2025-03-01)

**Status:** REVIEW COMPLETE

**Verdict:** The hexagonal architecture is **solid in structure** but has **several violations and dead code** that should be cleaned up before the codebase grows further.

### Architectural Violations (Must Fix)
1. **`TriviaService` imports `readFileSync`** (`src/domain/trivia-service.ts:1`) — direct filesystem I/O in the domain layer. The `seedTrivia` method should accept data, not a file path.
2. **`onEvent` callback** (`src/container.ts:66-81`) is a 70-line inline closure containing orchestration logic (throttling → composing → dedup → sending → recording). Should be extracted to an `EventDispatcher` or `NotificationService`.
3. **`OutgoingMessage.parseMode`** (`src/domain/types.ts:174`) uses `'MarkdownV2' | 'HTML'` — Telegram-specific values leaked into the domain type.
4. **`SchedulerPort` orphaned** — fully implemented but **never wired** in the DI container. `GameTracker` uses raw `setInterval` instead of the port.

### Quality Issues (Should Fix)
5. **Dead error classes** — `ConfigError` (never thrown) and `StorageError` (never thrown) are misleading; use them or delete them.
6. **`sent_events` unbounded growth** — table has no TTL or periodic purge; grows indefinitely.
7. **`MessageComposer` mutable state** — `teamNames` Map has no cleanup mechanism; potential memory leak on long-running bot.

### Strengths
- 5 well-defined ports with clean interfaces
- Adapters correctly depend inward on port interfaces
- Domain services correctly depend on port interfaces, not concrete adapters
- 81 tests, all passing; excellent testability
- Clean separation of concerns across `ports/` → `domain/` → `adapters/` → `shared/`

### Recommendations
1. Extract event dispatch logic from `container.ts:66-81` into a `NotificationService` domain class
2. Remove `readFileSync` from `TriviaService` — pass data array or use a port
3. Wire `SchedulerPort` or delete it
4. Generalize `OutgoingMessage.parseMode` — remove Telegram-specific types from domain

---

## Fantasy Roster Tracking — Architecture Proposal — Bogdan (2026-03-01)

**Status:** ARCHITECTURE COMPLETE

**Verdict:** Feature architecture approved; ready for implementation.

### Summary

Design a feature where friends submit fantasy rosters (player picks), and during live EuroLeague games, the bot sends notifications when a rostered player makes a play (scores, assists, steals, etc.).

### Critical Finding: Play-by-Play API

The feature depends entirely on play-by-play data. Research revealed:
- `EuroLeagueAdapter.getPlayByPlay()` was returning `[]` (not available in v2 public API)
- New endpoint found: `https://live.euroleague.net/api` (separate service, legacy widget API)
- `StatsPort` interface and `PlayByPlayEvent` domain type already defined and ready

### Architecture Components

1. **Roster Input** — JSON file (`data/rosters.json`) with player picks per owner, round-based
2. **RosterTracker Service** — Loads rosters, normalizes player names (case-insensitive), matches PBP events
3. **GameTracker Extension** — Add `onPlayByPlay` callback for PBP polling
4. **MessageComposer** — New `composeRosterMatch()` method, `/roster` command
5. **Container Wiring** — Load rosters at startup, inject PBP callback into GameTracker

### Implementation Phases

- **Phase 0:** PBP API research (BLOCKER) ✅ Complete
- **Phase 1:** Roster Tracker core (types, service, unit tests)
- **Phase 2:** Integration (GameTracker, MessageComposer, CommandRouter, container)
- **Phase 3:** Polish (fuzzy matching, event filtering, dedup, throttling)

### Key Decisions

1. **PBP API base URL hardcoded** — `https://live.euroleague.net/api` is a separate service. Added as module-level constant.
2. **RosterTracker uses readFileSync** — Same pattern as TriviaService. Flagged for refactor alongside TriviaService.
3. **GameTracker.onPlayByPlay optional** — Backward compatible; callback receives all PBP events, container wires roster matching.
4. **Name matching case-insensitive** — Normalize via lowercase + trim. API returns `"LASTNAME, FIRSTNAME"` format.
5. **Only notable events** — Filter to: made shots (2pt/3pt/FT), assists, steals, blocks. No spam from rebounds, fouls, subs.

### Files Changed (8 total)

| File | Action |
|------|--------|
| `data/rosters.json` | CREATE |
| `src/domain/types.ts` | MODIFY — Add FantasyRoster, RosteredPlayer, RosterRound, RosterMatchEvent |
| `src/domain/roster-tracker.ts` | CREATE — New domain service |
| `src/domain/game-tracker.ts` | MODIFY — Add PBP polling + onPlayByPlay callback |
| `src/domain/message-composer.ts` | MODIFY — Add composeRosterMatch(), update help |
| `src/domain/command-router.ts` | MODIFY — Add /roster command |
| `src/container.ts` | MODIFY — Wire RosterTracker + PBP callback |
| `src/adapters/euroleague/euroleague.adapter.ts` | MODIFY — Implement getPlayByPlay() |

---

## Fantasy Roster Tracking — Implementation — Strahinja (2026-03-01)

**Status:** IMPLEMENTATION COMPLETE

**Verdict:** Full end-to-end implementation done. 8 files modified, 81 tests passing, build passes.

### Implementation Summary

Implemented the complete fantasy roster tracking pipeline: PBP API → RosterTracker → GameTracker integration → MessageComposer → CommandRouter → container wiring.

### Key Decisions

1. **PBP API base URL hardcoded** — `https://live.euroleague.net/api` is a separate service from the v2 API. Added as module-level constant `PBP_API_BASE` rather than config-driven.

2. **RosterTracker uses readFileSync** — Same pattern as TriviaService. Flagged as architectural violation but accepted for v1. When refactoring TriviaService, refactor RosterTracker too.

3. **GameTracker.onPlayByPlay is optional 6th constructor param** — Keeps backward compatibility; existing tests pass unchanged. Callback receives all PBP events, container wires roster matching into it.

4. **RosterTracker normalizes names via lowercase+trim** — Player name matching between `rosters.json` and PBP API events uses case-insensitive comparison. API returns names like `"LESSORT, MATHIAS"` which matches directly.

5. **Only notable events trigger roster notifications** — Filtered to: made shots (2pt/3pt/FT), assists, steals, blocks. No spam from rebounds, fouls, subs, timeouts.

### Files Changed (8 total)

- `src/adapters/euroleague/euroleague.adapter.ts` — Real PBP implementation
- `src/domain/types.ts` — Added FantasyRoster, RosteredPlayer, RosterRound
- `src/domain/roster-tracker.ts` — NEW: RosterTracker service
- `src/domain/game-tracker.ts` — Added onPlayByPlay callback + PBP polling
- `src/domain/message-composer.ts` — Added composeRosterMatch + /roster in help
- `src/domain/command-router.ts` — Added /roster command
- `src/container.ts` — Wired RosterTracker + PBP callback
- `data/rosters.json` — Sample roster data

### Test Results

All 81 tests passing. Build passes.

---

## Dunkest Fantasy Roster API Verification — Strahinja (2026-03-01)

**Status:** API VERIFIED, IMPLEMENTATION COMPLETE

**Verdict:** Live API endpoint confirmed; response structure stable. Replaced defensive parsing with typed interfaces.

### Verification Results

Tested against real Dunkest API with bearer token:

1. **Endpoint confirmed:** `/fantasy-teams/{id}/matchdays/{matchdayId}/roster`
2. **Response structure verified:** `{ data: { players: [{ first_name, last_name, team: { abbreviation } }] } }`
3. **Public matchday endpoint:** `/leagues/10/config` (no auth required)

### Code Improvements

- Replaced all defensive guessing code with strict TypeScript interfaces
- Proper type guards for response parsing instead of fallback heuristics
- Improved error handling for malformed responses
- **Result:** Cleaner, safer, more maintainable code

### Test Results

- **100 tests passing** (all green)
- No regressions from type refactoring
- Build successful

### Files Changed

- `src/adapters/dunkest/dunkest.adapter.ts` — Typed interfaces + response parsing

### Key Takeaway

Previous defensive parsing logic was over-engineered. The Dunkest API response format is stable and consistent. Strict TypeScript typing provides better safety and readability than runtime heuristics.

---

## FantasyPort.getRosters — Return Type Refactor — Strahinja (2026-03-01)

**Status:** DECISION IMPLEMENTED

**Verdict:** `getRosters()` now returns `RosterFetchResult { matchdayNumber: number; rosters: FantasyRoster[] }` instead of `FantasyRoster[]`.

### Root Cause

The "Round 0" bug in `/roster` output occurred because `RosterTracker.loadRosters()` received rosters with no matchday context. The Dunkest adapter knew the matchday number but had no way to return it alongside the rosters.

### Solution

Introduced `RosterFetchResult` wrapper type that bundles:
- `matchdayNumber: number` — Current matchday from `/leagues/10/config`
- `rosters: FantasyRoster[]` — Fetched rosters

### Implementation Details

- **Matchday source:** `/leagues/10/config` (public, no auth required)
- **Team names:** Fetched from `/user/fantasy-teams` endpoint
- **Adapter responsibility:** Compose result atomically before returning

### Impact

- ✅ `FantasyPort` interface updated — clear contract for all adapters
- ✅ `RosteredPlayer` extended with `position`, `isCaptain`, `isOnFire`, `opponentCode`, `courtPosition`
- ✅ All tests updated and passing
- ✅ Round 0 bug resolved — output now shows correct matchday number

### Type Safety

The wrapper type enforces matchday presence at compile-time; no more defensive runtime checks for missing matchday.

---

## Premium Model Directive — Reinforced — Filip Tanic (2026-03-01)

**Status:** POLICY CLARIFIED

**Decision:** Always use premium/best models for all agents. Unlimited budget — price is irrelevant. Optimize exclusively for precision, code quality, and structure.

### Context

Earlier directive from session user. Reinforced via Copilot: Apply to ALL agent spawns, not just Scribe exceptions.

### Application

- **Strahinja (Backend Dev):** claude-opus-4.6 — ensures high-quality type design and API integration
- **All future work agents:** Use claude-opus-4.6 or better; never downgrade to cheaper models for cost reasons
- **Copilot consideration:** User budget is unlimited; quality is the only measure of success

---

## /games Repurposed — Round Schedule & Results — Strahinja (2026-07-18)

**Status:** IMPLEMENTED

**Decision:** `/games` now shows all games from the current EuroLeague round instead of listing tracked games.

### Rationale

Filip requested round-level visibility. The old `/games` (tracked games) was redundant with `/status` which shows tracking count. Round schedule is more useful — users see finished scores and upcoming kickoff times in one view.

---

## PBP API Capabilities Investigation — Nikola (2026-03-13)

**Status:** INVESTIGATION COMPLETE

**Findings:** The `live.euroleague.net/api/PlaybyPlay` endpoint has no incremental fetch support. All query parameters are ignored; the API always returns the full ~157 KB payload (gzipped to ~10.7 KB).

### What Was Tested

- Query parameters: `quarter`, `from`, `since`, `cursor`, `offset`, `lastEventId`, `startNumber` — all ignored
- `/api/PlaybyPlay/Period?period=4` — period param ignored, full payload returned
- Conditional requests: `If-Modified-Since`, `ETag`, `Last-Modified` — not supported
- gzip compression — **works well** (6.8% ratio, ~10.7 KB on wire)
- Alternative endpoints discovered:
  - `/api/Header`: 475 bytes gzipped (scores, clock, fouls)
  - `/api/Points`: 4.5 KB gzipped (scoring plays only)
  - `/api/Boxscore`: ~2 KB gzipped

### Recommendation

Full PBP fetch is acceptable at current polling. If bandwidth becomes critical, implement "poll Header first, fetch PBP only on score change" pattern. The adapter's existing `sinceEventId` client-side filtering is the optimal approach given API constraints.

---

## PBP Optimization Strategy — Bogdan (2026-03-13)

**Status:** ANALYSIS COMPLETE

**Decision:** Implement two low-effort, zero-risk optimizations immediately.

### Current Situation

PBP is used only for roster matching. Game-level events (score changes, quarters, lead changes) come from `getLiveScore()` only — PBP is secondary. Yet the full ~154 KB payload is fetched every 15 seconds, with 73% of events unused.

### Recommended Immediate Actions

1. **Skip PBP fetch when rosters not loaded** (trivial, no behavior change) — Currently, `getPlayByPlay()` is called even if the `onPlayByPlay` callback immediately returns due to missing rosters. Add a guard predicate to skip the fetch entirely.

2. **Reduce PBP poll frequency to 30–45s** (easy, minimal impact) — Roster notifications are less time-critical than score updates. Decouple the two polling cycles; LiveScore stays at 15s, PBP goes slower.

**Impact:** Combined changes achieve 90%+ reduction in PBP traffic with zero or near-zero behavior change.

### Future Optimizations (Post-API-Probe)

3. If API supports conditional requests → implement ETags
4. If API supports quarter filtering → fetch current quarter only
5. Ensure gzip is enabled (already is by default in Node.js fetch)

---

## Live Tracked-Player Updates — Data Strategy — Nikola (2026-03-13)

**Status:** RECOMMENDATION

**Decision:** Make PBP the primary event source for all tracked-player notifications.

### Latency Breakdown

| Stage | Current | Controllable |
|-------|---------|--------------|
| Upstream pub (stat crew) | 2–15s | ❌ No |
| Poll wait (15s default) | 0–15s (avg 7.5s) | ✅ Yes |
| Sequential API calls | 0.5–1.3s | ✅ Yes |
| Throttle | 0–120s | ✅ Yes |
| Telegram | 0.1–0.3s | — |
| **Total typical** | **~15–20s** | |

### Achievable Improvement: 5-Second PBP Polling

Reduce poll interval to 5 seconds (no rate limiting observed at 720 req/hour, gzipped transfer only ~10.7 KB):

- Poll wait drops from 7.5s → 2.5s average (saves ~5s per cycle)
- Sequential `getLiveScore()` → `getPlayByPlay()` can be decoupled; use PBP alone for all events
- Achievable latency: **avg 8–10s, worst ~21s** (vs current 15–20s)

**True instant (<2s) is impossible** — no push API exists upstream.

### Implementation Plan

1. Reduce `EUROLEAGUE_POLL_INTERVAL_MS` to 5000
2. Decouple LiveScore (30–60s fallback) from PBP (5s hot path)
3. Derive game-level events (score, quarters) from PBP data directly
4. Expand `NOTABLE_EVENT_TYPES` to include misses, turnovers, rebounds, fouls
5. Rethink throttling: batch events or use separate rate tier for PBP

### Throttling Implications

Default 5 msg/min will suppress most roster matches during active play. Options:
- **A) Batch per-cycle:** Combine all events into single message (recommended, Phase 1)
- **B) Separate throttle tier:** PBP notifications exempt, own limit (20 msg/min)
- **C) Per-chat preference:** Users choose "all events" vs "scoring only" vs "critical"

Start with (A), upgrade to (C) for user control.

---

## Live Tracked-Player Architecture — Bogdan (2026-03-13)

**Status:** RECOMMENDATION

**Decision:** Expand event classes, route through throttling, separate score from player updates.

### What's Already Working

- PBP polling infrastructure exists
- RosterTracker for player matching exists (filter too restrictive)
- MessageComposer formats matched events
- Container wiring complete
- Deduplication via `lastEventId` works

### Critical Gaps

| Gap | Issue | Severity |
|-----|-------|----------|
| Event filter | `NOTABLE_EVENT_TYPES` blocks misses, turnovers, rebounds, fouls | Critical |
| Throttling | PBP roster matches bypass `ThrottleManager` | Medium |
| Per-chat config | No way to toggle event types | High |
| Spam control | High-volume updates drown score messages | Medium |

### Recommended Architecture

**1. Event Classification (Configurable)**

```typescript
type PlayerEventClass = 'scoring' | 'playmaking' | 'defensive' | 'negative' | 'administrative';
```

Default: scoring, playmaking, defensive, negative. Exclude administrative spam.

**2. Phase 1 Build Order (1–2 days)**

1. Add `PlayerEventClass` type + `EVENT_CLASS_MAP` to `types.ts`
2. Expand `NOTABLE_EVENT_TYPES` (misses, turnovers, rebounds, fouls)
3. Wire PBP callback through `ThrottleManager` with priority tiers
4. Update `composeRosterMatch()` to show event type
5. Unit + integration tests

**Result:** Users see all tracked-player actions with basic rate limiting.

**3. Phase 2 — Batched Digests (3–5 days)**

Batch 20–30s worth of events:
```
🏀 Q2 7:42 — Player Updates
├ HEZONJA: 🏀 2pt Made (8pts) → 🎯 Assist
├ LESSORT: ❌ 2pt Miss → 🏀 2pt Made (12pts)
└ VESELY: 🛡 Block
```

Drastically reduces chat spam.

**4. Phase 3 — If Demanded**

- `/trackconfig` for per-chat event toggles
- Per-player subscriptions
- Telegram topic threading

### What NOT to Do

- **No per-player subscriptions in Phase 1.** Roster-based covers the use case.
- **Don't skip Phase 2 batching.** Phase 1 throttling alone insufficient for spam control.

### Key Risks

1. **API reliability.** `live.euroleague.net` is legacy/undocumented. Graceful degradation in place.
2. **Chat spam.** 4+ tracked players = 15–25 msg/min without batching. Phase 2 is the real fix.
3. **Name matching gaps.** PBP uses "LASTNAME, FIRSTNAME". `normalizeName()` handles case but not variants.

---

## Code Review — Uncommitted src/ Changes — Bogdan (2026-03-13)

**Status:** APPROVED

**Scope:** 5 modified files from previous sessions (never committed)

**Verdict:** All changes approved. No regressions. Two non-blocking follow-up items flagged.

### Approved Changes

1. **Dunkest `/roster/preview` endpoint** — Fixed `/roster` to work for any team
2. **Container roster file fallback removed** — API-only approach with graceful degradation
3. **`/trackall` command** — Tracks all today's games in one shot; per-game error handling
4. **Help text updated** — `/trackall` added to help

### Follow-up Items (Non-Blocking)

1. **Dead code in `roster-tracker.ts`** — `loadFromFile()`, `loadFromFileAndMerge()`, `mergeRosters()`, and `readFileSync` import unused; should be cleaned up
2. **No tests for `/trackall`** — Command has zero test coverage; should add to `command-router.test.ts`

### Test Results

- 206/222 tests pass (all unit + EuroLeague integration)
- 16 SQLite failures (pre-existing, better-sqlite3 Node version mismatch)

---

## `/roster` Live Fetch — Strahinja (2026-03-13)

**Status:** IMPLEMENTED

**Decision:** `/roster` command now fetches live Dunkest API data instead of showing bot-startup cached rosters.

### Root Cause

Rosters were loaded once at boot and cached. Users saw stale data that didn't reflect roster changes made after startup.

### Solution

- Added `FantasyPort` to `/roster` handler
- Calls `fantasyPort.getRosters()` for fresh data on every invocation
- Falls back to cached data if live fetch fails
- Startup pre-load preserved for `onRosterEvent` PBP callback

### Dead Code Removed

- `RosterTracker.loadFromFile()` — filesystem import, architectural violation
- `RosterTracker.loadFromFileAndMerge()` — never called
- `RosterTracker.mergeRosters()` — never called
- Old tests removed, new tests use `loadRosters()` directly

### Impact

- 4 files modified
- All 209 unit tests pass
- Partially addresses domain-layer filesystem import violation

---

## Roster Matching Robustness — Lazy Loading Pattern — Strahinja (2026-03-13)

**Status:** IMPLEMENTED

**Decision:** Implement lazy roster loading with 5-minute cooldown to handle startup fetch failures gracefully.

### Problem

Roster matching silently failed when Dunkest API fetch failed at startup. Missing events went unnoticed.

### Solution

1. **Lazy roster loading** — When PBP events arrive and rosters aren't loaded, attempt fetch. 5-minute cooldown prevents API hammering on repeated failures.
2. **`/rostercheck` diagnostic command** — Shows roster load status, player count, indexed names, last-loaded timestamp for debugging.
3. **Warning-level logging** — All silent failure points now logged at WARN; PBP roster matches at DEBUG.

### Pattern: Lazy Loading with Cooldown

This pattern reusable for any external data source that:
- Loads at startup but may fail transiently
- Is needed during real-time processing
- Should not block startup

### Impact

- No breaking changes
- All 223 unit tests passing
- Graceful production resilience

---

## Arena Sport TV Schedule Integration — Strahinja (2026-03-13)

**Status:** IMPLEMENTED

**Decision:** Add TV channel info to `/games` via Arena Sport scraping.

### Architecture

Full hexagonal pattern:
- **Port:** `TvSchedulePort` — clean interface
- **Adapter:** `ArenaSportAdapter` — scrapes tvarenasport.com, filters EuroLeague, 1-hour cache
- **Integration:** `CommandRouter` enriches `RoundGame[]` with TV info before composing message

### Key Decisions

1. **No HTML parsing dependency** — Uses regex + `window.TV_SCHEMES` JSON extraction
2. **Completely optional** — If Arena Sport fails, `/games` works identically
3. **Fuzzy team matching** — Compares against shortName, full name, and team code (lowercase)
4. **1-hour cache** — Arena Sport publishes full week schedule; stale returned on failures
5. **TV info shown for upcoming games only** — Finished games don't need broadcast times

### Files Modified

| File | Action |
|------|--------|
| `src/ports/tv-schedule.port.ts` | CREATE |
| `src/adapters/tv-schedule/arena-sport.adapter.ts` | CREATE |
| `src/domain/types.ts` | MODIFY — Added `tvChannel?: string` to RoundGame |
| `src/domain/command-router.ts` | MODIFY — TV enrichment |
| `src/domain/message-composer.ts` | MODIFY — 📺 tag for games with TV |
| `src/container.ts` | MODIFY — Wire adapter |
| `tests/unit/arena-sport-adapter.test.ts` | CREATE — 13 tests |
| `tests/unit/command-router.test.ts` | MODIFY — 1 new TV enrichment test |

### Test Results

175 tests passing (14 new), build clean.

---

## Roster Robustness Test Coverage — Tihomir (2026-03-13)

**Status:** IMPLEMENTED

**Coverage Summary**

- **`getStats()`**: 5 tests — zero state, correct counts, normalized names, unique teams, empty load
- **`needsReload()`**: 5 tests — never-loaded, recently-loaded, stale (>1hr), boundary (59min), empty-load
- **`lastLoadedAt`**: 4 tests — null initial, set on load, null on empty, updates on reload
- **Total new**: 14 tests added to `tests/unit/roster-tracker.test.ts`
- **Suite total**: 223 passing tests

### Gap: `/rostercheck` Command

The command does not exist in production code. Strahinja needs to implement it before tests can be written.

---

## User Directives — Recent Captures — Filip Tanic (2026-03-13)

**Status:** CAPTURED (Policy)

### Directive 1: Scribe + Git (2026-03-13T13:09:18Z)

**Decision:** Always spawn Scribe after every agent batch completes. Always push `.squad/` changes to git. No exceptions.

**Rationale:** User request — ensures orchestration logs and decisions are captured, deduped, and committed.

### Directive 2: Premium Model Default (2026-03-13T14:16:58Z)

**Decision:** Default squad model is Claude Opus 4.6 for all non-trivial work. Smaller tasks may use Claude Sonnet 4.5 as medium-reasoning fallback. Prefer premium models for all squad members.

**Rationale:** Budget unlimited. Quality is the only measure. Always optimize for precision and code quality.

### Directive 3: Tracked-Player Live Updates Priority (2026-03-13T14:34:39Z)

**Decision:** Bot should prioritize live updates for tracked-player actions in chat, including missed shots, as close to instant as upstream data allows.

**Rationale:** User request — Filip wants to see every action by his fantasy players in near real-time.

### Implementation Details

- **Rounds API:** EuroLeague `/v2/.../rounds` endpoint discovered and integrated
- **Round Detection:** Date-range matching determines current active round
- **Games Display:** 
  - Finished games show final score with ✅ winner badge
  - Upcoming games show start time in Europe/Belgrade timezone via `Intl.DateTimeFormat`
- **New Types:** `RoundSchedule { id, number, name, games }`, `RoundGame { ... }`
- **New Port Method:** `StatsPort.getCurrentRoundGames()`
- **Command Router:** `/games` handler refactored to call `stats.getCurrentRoundGames()`

### Impact

- `/games` handler no longer calls `gameTracker.getTrackedGames()` — calls `stats.getCurrentRoundGames()` instead
- `composeTrackedGames()` in `MessageComposer` is now unused (kept for potential future use)
- Serbian time (Europe/Belgrade) used for upcoming game times — no new dependencies
- EuroLeague rounds API is stable and public; no authentication required
- All 100 tests passing, build successful

### Key Decisions

1. **No new dependencies** — Native `Intl.DateTimeFormat` for timezone conversion
2. **Round detection via date ranges** — Avoids hardcoding round IDs; automatically adapts to season schedule
3. **StatsPort boundary** — Rounds + games logic in adapter; domain only knows composed messages

---

## PBP Raw Payload Capture — PAO vs Zalgiris — Nikola (2026-07-18)

**Status:** COMPLETE

**Decision:** Captured the full raw play-by-play JSON from the EuroLeague live API for the Panathinaikos vs Zalgiris game (E2025, game code 305).

### Context

User requested full PAO–Zalgiris raw play-by-play API payload saved as JSON for reference and integration testing.

### Key Findings

1. **Endpoint:** `https://live.euroleague.net/api/PlaybyPlay?gamecode=305&seasoncode=E2025`
2. **Response is available post-game.** The API still returns complete PBP data for finished games — no live-only restriction.
3. **Schema:** Top-level object with metadata fields (`Live`, `TeamA`, `TeamB`, `CodeTeamA`, `CodeTeamB`, `ActualQuarter`) and quarter arrays (`FirstQuarter` through `ForthQuarter` plus `ExtraTime`).
4. **Note:** The API uses `ForthQuarter` (not `FourthQuarter`) — this is a known upstream typo that must be respected in all parsing code.

### Artifacts

- Minified: `session-state/0a0abdd4.../pao-zalgiris-pbp-raw-opus.json` (157 KB)
- Pretty: `session-state/0a0abdd4.../pao-zalgiris-pbp-pretty-opus.json` (237 KB)

### Team Relevance

- **Strahinja:** PBP parsing in `GameTracker` and `RosterTracker` should reference these raw samples when debugging field mappings.
- **Tihomir:** Integration tests can use this payload as fixture data for PBP event parsing.

---

## PBP API Incremental Fetch Investigation — Nikola (2026-03-13)

**Status:** INVESTIGATION COMPLETE

**Verdict:** No API-level incremental support. Gzip compression already optimized. Alternative endpoints discovered.

### Key Findings

1. **Zero Incremental Support**
   - Tested 8 query parameter styles, conditional headers, and `/Period` endpoint variant
   - All returned identical full 157 KB payload
   - No server-side filtering, ETags, or `since` parameter support

2. **Gzip Compression Active** ✅
   - Wire transfer: ~10.7 KB (6.8% of uncompressed)
   - Already highly optimized at transport layer
   - Node.js `fetch()` handles automatically

3. **Lightweight Alternative Endpoints Discovered**
   - `/api/Header`: 475 bytes gzipped (has live scores, clock, fouls, timeouts)
   - `/api/Points`: 4.5 KB gzipped (scoring plays only, 166 events)
   - `/api/Boxscore`: ~2 KB gzipped (player stats per team)

### Assessment

**Current state is acceptable.** Gzip brings 157 KB down to 10.7 KB (~11 KB per poll). For a Telegram bot at 15-second polling, this is manageable.

**For future optimization:** Use `/api/Header` for lightweight preliminary checks before fetching full PBP.

### Recommendations

- No code changes required now
- If bandwidth becomes critical, implement "poll Header first, fetch PBP on score change" pattern
- Avoid per-quarter fetching (not supported by API)

---

## PBP Optimization Strategy — Bogdan (2026-03-13)

**Status:** RANKED RECOMMENDATIONS COMPLETE

**Verdict:** PBP is only used for roster matching. Quick wins available with minimal behavior impact.

### Critical Finding

**PBP only used for roster matching.** Score detection, quarter transitions, lead changes, and big runs all use `getLiveScore()`, not PBP.

### Data Volume

- Full game PBP: ~154 KB / 578 events
- Notable events (27%): ~156 events
- Wasted non-notable events (73%): 422 events
- At 15s polling over 2-hour game: ~45 MB transfer per tracked game

### Hidden Waste

Current implementation fetches full PBP every 15 seconds **even when rosters aren't loaded**. If `rosters.json` is empty, we fetch 154 KB and return early with no roster match.

### Ranked Optimization Alternatives

**Tier 1: Free Wins (No API Probing)**

1. **Skip PBP fetch when rosters not loaded** (3 lines)
   - Impact: 100% traffic reduction when no rosters configured
   - Change: Guard `onPlayByPlay` callback with roster presence check
   - Risk: Zero (roster matching is optional feature)

2. **Reduce PBP poll frequency to 30–45s** (1 number change)
   - Impact: 50–67% traffic reduction
   - Change: `const PBP_POLL_INTERVAL_MS = 30000;` instead of 15000
   - Risk: Minimal (roster notifications arrive 15–30s later; unnoticed by users)
   - Rationale: Roster notifications less time-critical than live scores

**Tier 2: API-Dependent (After Nikola's Probe)**

3. **Lightweight polling pattern** (if `/api/Header` stable)
   - Impact: 60–70% reduction
   - Pattern: Poll Header every 30s, fetch full PBP on score change only

4. **Points-only polling** (if `/api/Points` includes player names)
   - Impact: 70% reduction
   - Trade-off: Loses rebound/foul/sub events (acceptable for roster tracking)

**Tier 3: Avoid**

- Per-quarter filtering (not supported)
- Client-side dedup + cache (redundant with server-side filtering)

### Combined Impact

Implementing Tier 1 (guard + reduce interval): **90%+ reduction** with 5 lines of code.

### Implementation Order

1. **Immediate:** Guard on roster presence + reduce interval to 30s
2. **Monitor:** Track bandwidth; if <1MB/game, declare success
3. **Future:** Evaluate Tier 2 alternatives if needed

### Owner

Strahinja (Backend Dev) — High priority, quick ROI, low risk

---

## PBP Incremental Fetch Investigation — Nikola (2026-03-13)

**Status:** INVESTIGATION COMPLETE — No action required, mitigations optional

**Question:** Can we avoid fetching the full PlayByPlay payload (~157 KB, 578 events) on every poll cycle?

### Findings Summary

| Test | Result |
|------|--------|
| Server-side filtering params (quarter, from, since, etc.) | All ignored — full payload returned |
| Conditional requests (If-Modified-Since, ETag) | Not supported — always 200 |
| gzip compression | **Works: 157 KB → 10.7 KB (6.8%)** |
| Alternative endpoints (Header, Points, Boxscore) | Discovered and documented |

### Current State

The adapter already does client-side filtering via sinceEventId. The full payload is fetched but only new events are processed. This is optimal given the API design.

### Mitigation Options (if bandwidth becomes critical)

1. **Ensure gzip is active** (near-free win) — already default in Node.js fetch()
2. **Use /api/Header for score-only polling** — 475 bytes gzipped, 22× cheaper than PBP
3. **Use /api/Points for roster tracking** — 4.5 KB gzipped, smaller than full PBP
4. **Adaptive polling during dead time** — reduce poll frequency during timeouts/halftime
5. **Client-side response caching (5–10s TTL)** — avoids redundant parsing for multi-chat scenarios

### Recommendation

**No code changes needed now.** The gzip compression reduces real transfer to ~11 KB per poll, which is acceptable for a polling bot. If further optimization is required, option #2 (Header-first gating) gives the best cost/complexity tradeoff.

### Related Decisions

- Bogdan's PBP Optimization Strategy (ranked tier 1–3 alternatives)
- Nikola's Live Player Notification Latency Investigation (polling interval impact)

---

## PBP Optimization Strategy — Bogdan (2026-03-13)

**Status:** RANKED RECOMMENDATIONS COMPLETE

**Trigger:** Investigate reducing PBP data volume for cost optimization.

### Critical Finding

PBP is **only used for roster matching**. Score detection, quarter transitions, lead changes, and big runs all use getLiveScore(), not PBP.

### Data Volume Analysis

| Metric | Value |
|--------|-------|
| Full game PBP | ~154 KB / 578 events |
| Notable events (27%) | ~156 events |
| Wasted non-notable (73%) | 422 events |
| Per 2-hour game (15s polling) | ~45 MB transfer |

### Hidden Waste

Current implementation fetches full PBP every 15 seconds **even when rosters aren't loaded**. If osters.json is empty, we fetch 154 KB and return early with no roster match.

### Ranked Optimization Alternatives

**Tier 1: Free Wins (No API Probing)**

1. **Skip PBP fetch when rosters not loaded** (3 lines)
   - Impact: 100% traffic reduction when no rosters configured
   - Change: Guard onPlayByPlay callback with roster presence check
   - Risk: Zero

2. **Reduce PBP poll frequency to 30–45s** (1 number change)
   - Impact: 50–67% traffic reduction
   - Change: const PBP_POLL_INTERVAL_MS = 30000;
   - Risk: Minimal (roster notifications arrive 15–30s later; acceptable)

**Tier 2: API-Dependent (After Nikola's Probe)**

3. **Lightweight polling pattern** (if /api/Header stable)
   - Impact: 60–70% reduction
   - Pattern: Poll Header every 30s, fetch full PBP on score change only

4. **Points-only polling** (if /api/Points includes player names)
   - Impact: 70% reduction
   - Trade-off: Loses rebound/foul/sub events

### Combined Impact

Implementing Tier 1 (guard + reduce interval): **90%+ reduction** with 5 lines of code.

### Implementation Priority

1. **Immediate:** Guard on roster presence + reduce interval to 30s
2. **Monitor:** Track bandwidth; if <1MB/game, declare success
3. **Future:** Evaluate Tier 2 alternatives if needed

### Owner

Strahinja (Backend Dev) — High priority, quick ROI, low risk

---

## Raw PBP API Capture Approach — Nikola (2026-03-13)

**Status:** IMPLEMENTED

**Context:** Filip requested a full raw EuroLeague play-by-play API response for PAO vs Zalgiris game in JSON format for inspection.

### Decision

**Preserve the raw API response without transformation.** Fetch from the live PBP endpoint and save both minified and pretty-printed JSON, exactly as returned by the API.

### Rationale

1. Raw inspection value — Filip audits the upstream schema directly
2. No downstream impact — raw payload serves analysis only
3. Audit trail — ensures we can trace API schema changes over time
4. Storage efficiency — Both minified (~157 KB) and pretty (~237 KB) are acceptable

### Implementation Details

- **Endpoint:** https://live.euroleague.net/api/PlaybyPlay?gamecode={gameCode}&seasoncode={seasonCode}
- **Game:** Panathinaikos AKTOR Athens vs Zalgiris Kaunas (Game Code 305, Season E2025)
- **Payload:** 578 play-by-play events across 4 quarters
- **Location:** Session state files directory (raw and pretty-printed JSON)

### Follow-up

No follow-up changes required. The EuroLeagueAdapter.getPlayByPlay() method already maps raw PBP events correctly.

---

## Live Tracked-Player Notifications — Architecture Recommendation — Bogdan (2026-07-18)

**Status:** RECOMMENDATION

**Requested by:** Filip Tanic

**Product Goal:** Whenever a tracked player does something notable during a live game — including missed shots — post an update to chat as fast as realistically possible.

### Current State

The system has 80% of the plumbing:
- PBP polling exists (every 15s)
- RosterTracker matches events by normalized name
- MessageComposer formats matched events for chat
- Container wiring complete
- Deduplication via lastEventId

### What's Missing (Severity)

| Gap | Severity |
|-----|----------|
| Event filter too restrictive (only made shots, assists, steals, blocks) | Critical |
| No per-player subscription model | High |
| Score updates and player updates share same message flow | Medium |
| PBP throttling absent | Medium |
| Full PBP payload fetched every cycle | Low |

### Recommended Architecture

#### 1. Polling Strategy — Keep 15s Interval

No change to polling frequency. 15-second intervals are the sweet spot:
- The API returns the entire game's PBP (no server-side since filter)
- 15s is fast enough that users perceive updates as "live"
- Going faster (5–10s) doubles/triples API load with marginal UX benefit
- sinceEventId client-side filter already avoids re-processing

#### 2. Event Classification — Configurable Event Classes

Don't send literally everything. Introduce event classes:

`	ypescript
type PlayerEventClass = 'scoring' | 'playmaking' | 'defensive' | 'negative' | 'administrative';
`

Default subscription: scoring + playmaking + defensive + 
egative. A /trackconfig command deferred to Phase 2 could let users toggle.

#### 3. Per-Player Subscriptions — Defer

The current roster-based model (track all fantasy players) already covers the use case. Defer explicit per-player subscriptions unless demand emerges.

#### 4. Deduplication Strategy — Already Solved

lastEventId persisted per tracked game, sinceEventId filter in PBP fetch. Sufficient — no change needed.

#### 5. Message Throttling — Critical Piece

**Recommended approach: Batched Player Digests**

Instead of one message per event, batch events into 20–30s digest windows:

`
🏀 Q2 7:42 — Player Updates
├ HEZONJA: 🏀 2pt Made (8pts) → 🎯 Assist
├ LESSORT: ❌ 2pt Miss → �� 2pt Made (12pts)
└ VESELY: 🛡 Block
`

**Implementation:**
1. New domain service: PlayerEventBatcher collects events per chat in a buffer, flushes every N seconds
2. Wire into onPlayByPlay callback
3. Groups events by player, composes single digest message
4. Respects ThrottleManager rate limits

**Alternative (Phase 1, simpler):** Wire PBP messages through ThrottleManager like score events. Add PBP event priority: scoring = normal, misses = low. This is 10 lines of code.

#### 6. Separating Score Updates from Player Updates — Visual Distinction

Score updates and player updates interleave in the same chat. Users need to tell them apart:

- **Score updates:** Plain text, score-focused
- **Player updates:** MarkdownV2, player-focused, prefixed with roster emoji (📋)

Existing composeRosterMatch() format already uses 📋 prefix — no change needed.

### Build Order

**Phase 1 — Ship First (1–2 days)**
1. Expand NOTABLE_EVENT_TYPES in oster-tracker.ts to include misses, turnovers, rebounds, fouls
2. Wire PBP messages through ThrottleManager with priority (made shots/assists/steals/blocks = normal, misses = low)
3. Add PBP event type to composeRosterMatch()
4. Unit tests for expanded event matching, throttle integration

**Phase 2 — Polish (3–5 days)**
5. PlayerEventBatcher service with configurable flush interval
6. /trackconfig command to toggle event classes per chat
7. Event class persistence in SQLite

**Phase 3 — If Demanded**
8. Per-player subscriptions (/trackplayer, /untrackplayer)
9. Telegram topic threading for player updates
10. PBP API optimization (conditional requests, reduced payload)

### Key Risks

1. **PBP API reliability** — Undocumented legacy service. Graceful degradation already in place.
2. **Chat spam** — Even with throttling, 4+ tracked players could generate 20+ messages per quarter. Phase 2 batching is the real fix.
3. **Name matching gaps** — 
ormalizeName() handles case but not variants (e.g., "De Colo" vs "DE COLO, NANDO").

### Decision

**Build Phase 1 immediately.** Expand event filter and wire throttling — 50–80 lines of code, 90% of what Filip wants. Batching (Phase 2) is the right long-term answer but doesn't block Phase 1 ship.

**Do not build per-player subscriptions.** The roster-based model already covers the use case.

---

## Near-Instant Tracked-Player Notifications — Data Strategy — Nikola (2026-07-18)

**Status:** RECOMMENDATION — Requires team discussion before implementation

**Goal:** Filip wants every tracked-player action pushed to chat as fast as possible. Currently ~15–20s average latency.

### Where Latency Comes From

| Stage | Current Latency | Controllable? |
|-------|---------|---|
| Upstream publication (EuroLeague stat crew enters event) | 2–15s | ❌ No |
| Poll interval wait (15s default, avg half-cycle) | 0–15s (avg 7.5s) | ✅ Yes |
| Sequential getLiveScore() + getPlayByPlay() fetch | 0.5–1.3s | ✅ Yes |
| Client-side PBP parsing + roster match | <10ms | — |
| Throttle check (5 msg/min, 120s window) | 0–120s | ✅ Yes |
| Telegram API send | 0.1–0.3s | — |
| **Total (typical)** | **~15–20s** | |

### Recommended Strategy: PBP-Primary Polling

#### Core Idea

Make the PBP endpoint the single source of truth. It already contains everything: player actions, running scores, clock, quarter. The separate getLiveScore() call is redundant — remove it from the hot path and derive game-level events from PBP data directly.

#### 1. Reduce PBP Poll Interval to 5 Seconds

Set EUROLEAGUE_POLL_INTERVAL_MS=5000. No observed rate limiting. With gzip: ~7.7 MB/hour/game.

**Impact:** Average poll-wait drops from 7.5s → 2.5s. Single biggest latency win.

#### 2. Decouple LiveScore from PBP Polling

Currently pollGame() does getLiveScore() then getPlayByPlay() in series.

**Instead:**
- **PBP poll (5s):** Fetch full PBP, extract new events via sinceEventId, derive score/quarter/clock from the latest event. Use for BOTH game-level events AND player-action notifications.
- **LiveScore poll (30–60s):** Separate slower cadence. Used only as fallback/sanity-check and for detecting game status transitions.

**Impact:** Eliminates ~200–500ms serial dependency per poll.

#### 3. Expand NOTABLE_EVENT_TYPES

Add misses and turnovers to roughly double notification volume.

`	ypescript
const NOTABLE_EVENT_TYPES: ReadonlySet<PlayByPlayEventType> = new Set([
  'two_pointer_made', 'two_pointer_missed',
  'three_pointer_made', 'three_pointer_missed',
  'free_throw_made', 'free_throw_missed',
  'assist', 'steal', 'block', 'turnover',
]);
`

#### 4. Rethink Throttle for Player Notifications

Current config (5 msg/min, 120s window) will suppress most player events. Options:

- **A) Batch per-cycle:** Combine all roster-matched events from one poll into a single message
- **B) Separate throttle tier:** PBP roster notifications exempt, with their own higher limit (20 msg/min)
- **C) Configurable per-chat:** Let chat admins choose "all events" vs "scoring only" vs "critical only"

**Recommendation:** Start with (A) batching — simplest, reduces spam.

#### 5. Add PBP Response Cache (5s TTL)

If multiple chats track the same game, cache the parsed PBP response for the current poll cycle. Avoids redundant fetches and parsing.

### Achievable Latency

| Stage | After Changes |
|-------|--------------|
| Upstream publication | 2–15s (unchanged) |
| Poll interval wait (5s, avg half-cycle) | 0–5s (avg 2.5s) |
| PBP fetch (single call) | 0.3–0.8s |
| Processing + match | <10ms |
| Telegram send | 0.1–0.3s |
| **Total (typical)** | **~5–12s (avg ~8s)** |

### What "Instant" Really Means

- **True instant (<2s):** Impossible without push/WebSocket API
- **Near-instant (3–8s):** Achievable for scoring plays (stat crew enters fastest)
- **Fast (5–15s):** Achievable for non-scoring plays (lower priority, appear later)
- **The 5s poll interval is the sweet spot.** Going to 3s saves only ~1s average but doubles API load.

### What NOT to Do

- **Don't use /api/Header as PBP gate.** Header only shows score changes; misses don't change score.
- **Don't use /api/Points.** Scoring events only — no misses, turnovers, or other actions.
- **Don't scrape EuroLeague website.** HTML rendering lags API + fragile dependencies.

### Implementation Scope

| Change | Owner | Effort |
|--------|-------|--------|
| PBP-primary polling refactor in GameTracker | Strahinja | Medium |
| Expand NOTABLE_EVENT_TYPES | Strahinja | Trivial |
| Batch roster notifications in MessageComposer | Strahinja | Small |
| PBP response cache in EuroLeagueAdapter | Nikola | Small |
| Throttle tier for PBP notifications | Strahinja | Small |
| Config: PBP_POLL_INTERVAL_MS separate from main poll | Nikola/Strahinja | Trivial |
| Tests for new notification flow | Tihomir | Medium |

### Risks

1. **Upstream rate limiting.** No observed limits, but 720 requests/hour/game is aggressive. Mitigate: exponential backoff on 429, log request counts.
2. **Message flood.** Adding misses + turnovers can produce 15–25 messages/minute. Batching is critical.
3. **PBP API downtime.** Service occasionally returns empty responses mid-game. Existing retry logic handles, but 5s intervals burn attempts faster. Keep maxAttempts: 2 to fail fast.

---

## Code Review — Uncommitted src/ Changes — Bogdan (2026-07-18)

**Status:** APPROVED

**Scope:** 5 modified files never committed:
- src/adapters/dunkest/dunkest.adapter.ts
- src/container.ts
- src/domain/command-router.ts
- src/domain/message-composer.ts
- src/domain/roster-tracker.ts

### Verdict: APPROVE

All changes are architecturally consistent, correct, and introduce no regressions.

### Approved Changes

1. **Dunkest /roster/preview endpoint** — Fixes API access for non-authenticated users. Correct fix.
2. **Container roster file fallback removed** — API is now the single source. Graceful degradation with warning log. Clean simplification.
3. **/trackall command** — Tracks all today's games in one shot. Plain text output (not in MARKDOWN_COMMANDS). Per-game error handling. Follows patterns.
4. **Help text updated** — /trackall added to help message.

### Follow-up Items (Non-Blocking)

1. **Dead code in oster-tracker.ts** — loadFromFile(), loadFromFileAndMerge(), mergeRosters(), eadFileSync import unused now. Should be cleaned up in follow-up commit.

2. **No tests for /trackall** — New command has zero test coverage. Should add to 	ests/unit/command-router.test.ts.

### Test Results

- **206/222 tests pass** — All unit + EuroLeague integration green
- **16 SQLite failures** — Pre-existing environment issue (better-sqlite3 Node 23 vs Node 22). Unrelated to these changes.

---

## User Directives — Filip Tanic

### 2026-03-13T13:09:18Z

**What:** Always spawn Scribe after every agent batch completes. Always push .squad/ changes to git. No exceptions.

**Why:** User request — captured for team memory

---

### 2026-03-13T14:16:58Z

**What:** Default squad model policy is Claude Opus 4.6 for all non-trivial work; smaller tasks may use Claude Sonnet 4.5 as the medium-reasoning fallback. Prefer premium models for squad members and high reasoning mode by default.

**Why:** User request — captured for team memory

---

### 2026-03-13T14:34:39Z

**What:** The bot should prioritize live updates for tracked player actions in chat, including missed shots, as close to instant as the upstream data allows.

**Why:** User request — captured for team memory
