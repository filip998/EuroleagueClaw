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
