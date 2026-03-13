# Decisions

<!-- Append-only. Newest entries at the bottom. -->

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

The adapter already does client-side filtering via `sinceEventId`. The full payload is fetched but only new events are processed. This is optimal given the API design.

### Mitigation Options (if bandwidth becomes critical)

1. **Ensure gzip is active** (near-free win) — already default in Node.js fetch()
2. **Use `/api/Header` for score-only polling** — 475 bytes gzipped, 22× cheaper than PBP
3. **Use `/api/Points` for roster tracking** — 4.5 KB gzipped, smaller than full PBP
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

PBP is **only used for roster matching**. Score detection, quarter transitions, lead changes, and big runs all use `getLiveScore()`, not PBP.

### Data Volume Analysis

| Metric | Value |
|--------|-------|
| Full game PBP | ~154 KB / 578 events |
| Notable events (27%) | ~156 events |
| Wasted non-notable (73%) | 422 events |
| Per 2-hour game (15s polling) | ~45 MB transfer |

### Hidden Waste

Current implementation fetches full PBP every 15 seconds **even when rosters aren't loaded**. If `rosters.json` is empty, we fetch 154 KB and return early with no roster match.

### Ranked Optimization Alternatives

**Tier 1: Free Wins (No API Probing)**

1. **Skip PBP fetch when rosters not loaded** (3 lines)
   - Impact: 100% traffic reduction when no rosters configured
   - Change: Guard `onPlayByPlay` callback with roster presence check
   - Risk: Zero

2. **Reduce PBP poll frequency to 30–45s** (1 number change)
   - Impact: 50–67% traffic reduction
   - Change: `const PBP_POLL_INTERVAL_MS = 30000;`
   - Risk: Minimal (roster notifications arrive 15–30s later; acceptable)

**Tier 2: API-Dependent (After Nikola's Probe)**

3. **Lightweight polling pattern** (if `/api/Header` stable)
   - Impact: 60–70% reduction
   - Pattern: Poll Header every 30s, fetch full PBP on score change only

4. **Points-only polling** (if `/api/Points` includes player names)
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

- **Endpoint:** `https://live.euroleague.net/api/PlaybyPlay?gamecode={gameCode}&seasoncode={seasonCode}`
- **Game:** Panathinaikos AKTOR Athens vs Zalgiris Kaunas (Game Code `305`, Season `E2025`)
- **Payload:** 578 play-by-play events across 4 quarters
- **Location:** Session state files directory (raw and pretty-printed JSON)

### Follow-up

No follow-up changes required. The `EuroLeagueAdapter.getPlayByPlay()` method already maps raw PBP events correctly.

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
- Deduplication via `lastEventId`

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
- The API returns the entire game's PBP (no server-side `since` filter)
- 15s is fast enough that users perceive updates as "live"
- Going faster (5–10s) doubles/triples API load with marginal UX benefit
- `sinceEventId` client-side filter already avoids re-processing

#### 2. Event Classification — Configurable Event Classes

Don't send literally everything. Introduce event classes:

```typescript
type PlayerEventClass = 'scoring' | 'playmaking' | 'defensive' | 'negative' | 'administrative';
```

Default subscription: `scoring` + `playmaking` + `defensive` + `negative`. A `/trackconfig` command deferred to Phase 2 could let users toggle.

#### 3. Per-Player Subscriptions — Defer

The current roster-based model (track all fantasy players) already covers the use case. Defer explicit per-player subscriptions unless demand emerges.

#### 4. Deduplication Strategy — Already Solved

`lastEventId` persisted per tracked game, `sinceEventId` filter in PBP fetch. Sufficient — no change needed.

#### 5. Message Throttling — Critical Piece

**Recommended approach: Batched Player Digests**

Instead of one message per event, batch events into 20–30s digest windows:

```
🏀 Q2 7:42 — Player Updates
├ HEZONJA: 🏀 2pt Made (8pts) → 🎯 Assist
├ LESSORT: ❌ 2pt Miss → 🏀 2pt Made (12pts)
└ VESELY: 🛡 Block
```

**Implementation:**
1. New domain service: `PlayerEventBatcher` collects events per chat in a buffer, flushes every N seconds
2. Wire into `onPlayByPlay` callback
3. Groups events by player, composes single digest message
4. Respects `ThrottleManager` rate limits

**Alternative (Phase 1, simpler):** Wire PBP messages through `ThrottleManager` like score events. Add PBP event priority: scoring = normal, misses = low. This is 10 lines of code.

#### 6. Separating Score Updates from Player Updates — Visual Distinction

Score updates and player updates interleave in the same chat. Users need to tell them apart:

- **Score updates:** Plain text, score-focused
- **Player updates:** MarkdownV2, player-focused, prefixed with roster emoji (📋)

Existing `composeRosterMatch()` format already uses 📋 prefix — no change needed.

### Build Order

**Phase 1 — Ship First (1–2 days)**
1. Expand `NOTABLE_EVENT_TYPES` in `roster-tracker.ts` to include misses, turnovers, rebounds, fouls
2. Wire PBP messages through ThrottleManager with priority (made shots/assists/steals/blocks = normal, misses = low)
3. Add PBP event type to `composeRosterMatch()`
4. Unit tests for expanded event matching, throttle integration

**Phase 2 — Polish (3–5 days)**
5. `PlayerEventBatcher` service with configurable flush interval
6. `/trackconfig` command to toggle event classes per chat
7. Event class persistence in SQLite

**Phase 3 — If Demanded**
8. Per-player subscriptions (`/trackplayer`, `/untrackplayer`)
9. Telegram topic threading for player updates
10. PBP API optimization (conditional requests, reduced payload)

### Key Risks

1. **PBP API reliability** — Undocumented legacy service. Graceful degradation already in place.
2. **Chat spam** — Even with throttling, 4+ tracked players could generate 20+ messages per quarter. Phase 2 batching is the real fix.
3. **Name matching gaps** — `normalizeName()` handles case but not variants (e.g., "De Colo" vs "DE COLO, NANDO").

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

Make the PBP endpoint the single source of truth. It already contains everything: player actions, running scores, clock, quarter. The separate `getLiveScore()` call is redundant — remove it from the hot path and derive game-level events from PBP data directly.

#### 1. Reduce PBP Poll Interval to 5 Seconds

Set `EUROLEAGUE_POLL_INTERVAL_MS=5000`. No observed rate limiting. With gzip: ~7.7 MB/hour/game.

**Impact:** Average poll-wait drops from 7.5s → 2.5s. Single biggest latency win.

#### 2. Decouple LiveScore from PBP Polling

Currently `pollGame()` does `getLiveScore()` then `getPlayByPlay()` in series.

**Instead:**
- **PBP poll (5s):** Fetch full PBP, extract new events via `sinceEventId`, derive score/quarter/clock from the latest event. Use for BOTH game-level events AND player-action notifications.
- **LiveScore poll (30–60s):** Separate slower cadence. Used only as fallback/sanity-check and for detecting game status transitions.

**Impact:** Eliminates ~200–500ms serial dependency per poll.

#### 3. Expand NOTABLE_EVENT_TYPES

Add misses and turnovers to roughly double notification volume.

```typescript
const NOTABLE_EVENT_TYPES: ReadonlySet<PlayByPlayEventType> = new Set([
  'two_pointer_made', 'two_pointer_missed',
  'three_pointer_made', 'three_pointer_missed',
  'free_throw_made', 'free_throw_missed',
  'assist', 'steal', 'block', 'turnover',
]);
```

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

- **Don't use `/api/Header` as PBP gate.** Header only shows score changes; misses don't change score.
- **Don't use `/api/Points`.** Scoring events only — no misses, turnovers, or other actions.
- **Don't scrape EuroLeague website.** HTML rendering lags API + fragile dependencies.

### Implementation Scope

| Change | Owner | Effort |
|--------|-------|--------|
| PBP-primary polling refactor in GameTracker | Strahinja | Medium |
| Expand NOTABLE_EVENT_TYPES | Strahinja | Trivial |
| Batch roster notifications in MessageComposer | Strahinja | Small |
| PBP response cache in EuroLeagueAdapter | Nikola | Small |
| Throttle tier for PBP notifications | Strahinja | Small |
| Config: `PBP_POLL_INTERVAL_MS` separate from main poll | Nikola/Strahinja | Trivial |
| Tests for new notification flow | Tihomir | Medium |

### Risks

1. **Upstream rate limiting.** No observed limits, but 720 requests/hour/game is aggressive. Mitigate: exponential backoff on 429, log request counts.
2. **Message flood.** Adding misses + turnovers can produce 15–25 messages/minute. Batching is critical.
3. **PBP API downtime.** Service occasionally returns empty responses mid-game. Existing retry logic handles, but 5s intervals burn attempts faster. Keep `maxAttempts: 2` to fail fast.

---

## Code Review — Uncommitted src/ Changes — Bogdan (2026-07-18)

**Status:** APPROVED

**Scope:** 5 modified files never committed:
- `src/adapters/dunkest/dunkest.adapter.ts`
- `src/container.ts`
- `src/domain/command-router.ts`
- `src/domain/message-composer.ts`
- `src/domain/roster-tracker.ts`

### Verdict: APPROVE

All changes are architecturally consistent, correct, and introduce no regressions.

### Approved Changes

1. **Dunkest `/roster/preview` endpoint** — Fixes API access for non-authenticated users. Correct fix.
2. **Container roster file fallback removed** — API is now the single source. Graceful degradation with warning log. Clean simplification.
3. **`/trackall` command** — Tracks all today's games in one shot. Plain text output (not in `MARKDOWN_COMMANDS`). Per-game error handling. Follows patterns.
4. **Help text updated** — `/trackall` added to help message.

### Follow-up Items (Non-Blocking)

1. **Dead code in `roster-tracker.ts`** — `loadFromFile()`, `loadFromFileAndMerge()`, `mergeRosters()`, `readFileSync` import unused now. Should be cleaned up in follow-up commit.

2. **No tests for `/trackall`** — New command has zero test coverage. Should add to `tests/unit/command-router.test.ts`.

### Test Results

- **206/222 tests pass** — All unit + EuroLeague integration green
- **16 SQLite failures** — Pre-existing environment issue (better-sqlite3 Node 23 vs Node 22). Unrelated to these changes.

---

## User Directives — Filip Tanic

### 2026-03-13T13:09:18Z

**What:** Always spawn Scribe after every agent batch completes. Always push `.squad/` changes to git. No exceptions.

**Why:** User request — captured for team memory

---

### 2026-03-13T14:16:58Z

**What:** Default squad model policy is Claude Opus 4.6 for all non-trivial work; smaller tasks may use Claude Sonnet 4.5 as the medium-reasoning fallback. Prefer premium models for squad members and high reasoning mode by default.

**Why:** User request — captured for team memory

---

### 2026-03-13T14:34:39Z

**What:** The bot should prioritize live updates for tracked player actions in chat, including missed shots, as close to instant as the upstream data allows.

**Why:** User request — captured for team memory
