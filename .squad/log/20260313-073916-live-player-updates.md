# 📋 Session Log: Live Tracked-Player Updates — 20260313-073916Z

**Session Duration:** ~90 minutes  
**Participants:** Nikola (Data), Bogdan (Lead)  
**Topic:** Strategy for real-time tracked-player event notifications in chat

---

## Problem Statement

Filip wants every action by tracked fantasy players (makes, misses, assists, steals, blocks, turnovers) posted to chat as fast as possible. Current system only notifies made shots/assists for rostered players with ~15–20s average latency.

---

## Nikola's Investigation: Latency Breakdown

### Upstream (Uncontrollable)

- **Stat crew entry to API:** 2–15s (scoring plays faster than misses)
- **No public WebSocket/push:** EuroLeague offers only polling APIs

### Polling Path (Controllable)

1. **Poll interval:** 15s default (can reduce to 5s)
   - Currently bottleneck: Avg 7.5s wait per cycle
   - 5s interval → 2.5s average wait
2. **API fetch:** `getLiveScore()` + `getPlayByPlay()` in series
   - Sequential round-trips: 0.5–1.3s total
   - `getPlayByPlay()` alone sufficient for all event detection
3. **PBP client-side filtering:** <10ms (already efficient)
4. **Throttle:** Default 5 msg/min blocks player notifications during active play
5. **Telegram send:** 0.1–0.3s

### Realistic Achievable Latency

With 5s PBP polling + optimized flow:
- **Average:** 8–10s (from action to chat)
- **Worst case:** ~21s
- **True instant (<2s):** Impossible without push API

### PBP API Findings

- **No server-side filtering:** Always returns full 157 KB payload (~10.7 KB gzipped)
- **No rate limits observed** during extensive testing (720 req/hour is acceptable)
- **Alternative lightweight endpoints exist:**
  - `/api/Header` (475B gzipped): scores, clock, fouls
  - `/api/Points` (4.5 KB gzipped): scoring plays only
  - Could enable "Header-first, PBP-on-change" if bandwidth becomes critical

### Recommendation: PBP-Primary Polling

Make PBP endpoint the single source of truth:

1. Reduce poll interval to 5s
2. Decouple `getLiveScore()` from hot path (move to 30–60s fallback)
3. Derive all game-level events (score changes, quarter transitions) from PBP data
4. Expand `NOTABLE_EVENT_TYPES` to include misses, turnovers
5. Rethink throttling: batch events or use separate tier for PBP

**Benefits:** Saves ~7.5s poll wait + ~200–500ms serial fetch dependency.

---

## Bogdan's Architecture Recommendation

### What's Already Working

1. PBP polling infrastructure exists (`GameTracker.pollGame()`)
2. RosterTracker for player matching exists but filter too restrictive
3. MessageComposer can format matched events
4. Container wiring complete
5. Deduplication via `lastEventId` already implemented

### Critical Gaps

| Gap | Issue |
|-----|-------|
| Event filter | `NOTABLE_EVENT_TYPES` blocks misses, turnovers, rebounds, fouls |
| Throttling | PBP roster matches bypass `ThrottleManager` → no rate limiting |
| Per-chat preferences | No way to toggle event types per chat |
| Spam control | High-volume player updates will drown score updates |

### Recommended Solution: Event Classes + Smart Throttling

**1. Event Classification (Configurable)**
- `scoring`: made shots
- `playmaking`: assists, rebounds
- `defensive`: steals, blocks
- `negative`: misses, turnovers, fouls
- `administrative`: subs, timeouts, quarters

Default: Include scoring, playmaking, defensive, negative. Exclude admin spam.

**2. Phase 1 Build Order (1–2 days)**

1. Add `PlayerEventClass` type + `EVENT_CLASS_MAP` to `types.ts`
2. Expand `NOTABLE_EVENT_TYPES` (misses, turnovers, rebounds, fouls)
3. Wire PBP callback through `ThrottleManager` with priority tiers
4. Update `composeRosterMatch()` to show event type
5. Unit + integration tests

**3. Phase 2 (3–5 days)** — Batched Digests

Batch 20–30s worth of events per chat:
```
🏀 Q2 7:42 — Player Updates
├ HEZONJA: 🏀 2pt Made (8pts) → 🎯 Assist
├ LESSORT: ❌ 2pt Miss → 🏀 2pt Made (12pts)
└ VESELY: 🛡 Block
```

Drastically reduces message count while keeping live feel.

**4. Phase 3 (If Demanded)**

- `/trackconfig` command for per-chat event class toggles
- Per-player subscriptions (lower priority)
- Telegram topic threading

### What NOT to Do

- **No per-player subscriptions in Phase 1.** Roster-based model already works. Adds UI/schema complexity without clear ROI.
- **Don't skip Phase 2 batching.** Phase 1 throttling alone can't handle the volume — chat will be unreadable during active play.

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| 5s poll interval | Saves 7.5s avg wait; no rate limits observed at 720 req/hr |
| PBP-primary polling | Decouple `getLiveScore()`; PBP alone covers all events |
| Expand NOTABLE_EVENT_TYPES | Include misses + turnovers per user request |
| Phase 1: Throttle, Phase 2: Batch | Get fast iteration; real spam fix comes with batching |
| Defer per-player subs | Roster-based covers the use case; revisit if user demand |

---

## Implementation Scope

| Task | Owner | Effort | Phase |
|------|-------|--------|-------|
| PBP-primary refactor in GameTracker | Strahinja | Medium | 1 |
| Expand NOTABLE_EVENT_TYPES | Strahinja | Trivial | 1 |
| Throttle integration for PBP | Strahinja | Small | 1 |
| `PlayerEventBatcher` service | Strahinja | Medium | 2 |
| `/trackconfig` command | Strahinja | Small | 2 |
| Tests (event matching + throttle) | Tihomir | Medium | 1 |
| Tests (batching, persistence) | Tihomir | Medium | 2 |
| Config: separate PBP interval | Nikola | Trivial | 1 |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| API rate limiting (undocumented) | Medium | Implement exponential backoff on 429; log request counts |
| Message flood (15–25 msg/min) | High | Batching (Phase 2) is critical; throttle alone insufficient |
| PBP API downtime | Medium | Graceful degradation already in place; fail-fast at 2 attempts |
| Name matching gaps | Medium | `normalizeName()` handles case; monitor for variant issues |
| Upstream latency floor (2–15s) | Low | Accepted constraint; no technical solution exists |

---

## Output Artifacts

- `.squad/orchestration-log/20260313-073916-nikola.md` — Nikola's summary
- `.squad/orchestration-log/20260313-073916-bogdan.md` — Bogdan's summary  
- `.squad/decisions/inbox/nikola-live-player-updates.md` — Full spec (latency analysis, strategy)
- `.squad/decisions/inbox/bogdan-live-player-architecture.md` — Full spec (build order, Phase breakdown, risks)

---

**Decision Status:** READY FOR TEAM REVIEW

Nikola + Bogdan recommend simultaneous Phase 1 work: Strahinja on code, Tihomir on tests. Ship in 1–2 days.
