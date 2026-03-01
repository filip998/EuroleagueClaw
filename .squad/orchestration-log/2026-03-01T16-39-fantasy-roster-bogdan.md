# Orchestration — Bogdan Fantasy Roster Architecture

**Agent:** Bogdan (Lead)  
**Mode:** sync  
**Model:** claude-sonnet-4.6  
**Timestamp:** 2026-03-01T16:39:00Z  

## Task
Architect fantasy roster tracking feature.

## Outcome
**Status:** ARCHITECTURE PROPOSAL COMPLETE

**Deliverable:** `.squad/decisions/inbox/bogdan-fantasy-roster-tracking.md`

### Architecture Summary
- **Feature:** Friends submit fantasy rosters (player picks); bot sends notifications when rostered players make plays during live games.
- **Critical Blocker:** Play-by-play API not available in v2 public API. Recommend research spike on `live.euroleague.net/api/PlayByPlay`.

### Core Components Designed
1. **Domain Types** — `FantasyRoster`, `RosteredPlayer`, `RosterRound`, `RosterMatchEvent`
2. **RosterTracker Service** — Loads rosters from JSON, normalizes player names, matches PBP events
3. **GameTracker Extension** — Add `onPlayByPlay` callback for PBP polling
4. **MessageComposer** — New `composeRosterMatch()` and `/roster` command
5. **Container Wiring** — Load rosters at startup, wire PBP callback

### Implementation Phases
- **Phase 0:** PBP API research (BLOCKER — find endpoint, validate format)
- **Phase 1:** Roster Tracker core (types, service, unit tests)
- **Phase 2:** Integration (GameTracker, MessageComposer, CommandRouter, container)
- **Phase 3:** Polish (fuzzy matching, event filtering, dedup, throttling)

### Files Changed (8 total)
- CREATE: `src/domain/roster-tracker.ts`, `tests/unit/roster-tracker.test.ts`, `data/rosters.json`
- MODIFY: `src/domain/types.ts`, `src/domain/game-tracker.ts`, `src/domain/message-composer.ts`, `src/domain/command-router.ts`, `src/container.ts`, `src/adapters/euroleague/euroleague.adapter.ts`

## Next Steps
**Task Strahinja** with Phase 0 + Phase 1 implementation.
