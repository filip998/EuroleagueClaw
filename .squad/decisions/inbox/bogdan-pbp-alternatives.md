# PBP Fetch Optimization — Architecture Analysis — Bogdan (2026-07-18)

**Status:** ANALYSIS COMPLETE — Awaiting API probe results from Nikola

**Trigger:** Filip asked to investigate reducing PBP data volume.

## Current Situation

### How PBP is consumed

PBP data is used for **one purpose only**: roster matching. When a tracked player makes a notable play (made shot, assist, steal, block), the bot sends a notification to the chat.

- `GameTracker.pollGame()` calls `stats.getPlayByPlay()` every poll cycle (default **15 seconds**)
- Only when `liveScore.status === 'live'` AND `onPlayByPlay` callback exists
- `sinceEventId` filtering is **client-side** — adapter fetches the full response, then filters in JS
- The `detectEvents()` function (score changes, quarter transitions, lead changes, big runs) uses **`getLiveScore()` only** — it does NOT use PBP at all

### Data volume (PAO vs Zalgiris reference game)

| Metric | Value |
|--------|-------|
| Full game PBP payload | **~154 KB** (minified JSON) |
| Total events per game | **578** |
| Notable events (what we actually use) | **156** (27%) |
| Non-notable events (wasted parsing) | **422** (73%) |
| Events per quarter | ~140 |
| Avg bytes per event | ~273 bytes |

### Waste estimate (single game, full duration ~2 hours)

- Poll cycle: 15s → **~480 polls** per game
- Early Q1: payload ~35KB (141 events), growing to ~154KB by end
- Rough total transfer: **~45 MB per tracked game** (mostly redundant re-fetches)
- With `sinceEventId` filter: typically 0-5 new events per poll, but we fetch 140-578 events to find them

### Hidden waste: PBP fetched even when rosters aren't loaded

The `onPlayByPlay` callback is ALWAYS wired in `container.ts` (line 144). Inside the callback, if rosters aren't loaded, it attempts lazy load and returns. But by that point, `getPlayByPlay()` has already completed — the 154KB fetch already happened. The early return only saves roster matching, not the network call.

## Alternatives (ranked by safety × effort)

### 1. Skip PBP fetch when rosters not loaded — TRIVIAL, NO BEHAVIOR CHANGE ✅

Pass a predicate (e.g., `() => rosterTracker.isLoaded()`) into GameTracker. Check it before calling `getPlayByPlay()`. Zero PBP traffic when nobody has loaded rosters.

**Preserves:** All current behavior. When rosters ARE loaded, everything works identically.

### 2. Reduce PBP poll frequency — LOW EFFORT, MINOR BEHAVIOR CHANGE ⚠️

Decouple PBP polling from LiveScore polling. LiveScore stays at 15s (score detection needs it). PBP polls at 30s, 45s, or 60s.

Implementation: counter or separate timer. `if (pollCount % 2 === 0) fetchPBP()` for 30s, `% 4` for 60s.

**Preserves:** All events still detected. **Changes:** Roster notifications delayed by up to N seconds.

### 3. Conditional PBP on score change — LOW EFFORT, MODERATE BEHAVIOR CHANGE ⚠️

Only fetch PBP when `detectEvents()` produces a `score_change` event. Score changes imply new shots (the main PBP event type). Skip PBP when nothing scores.

**Preserves:** Made shots always captured (they're what changes the score). **Changes:** Steals, blocks, and assists that don't immediately produce a score change might be delayed until the next scoring play. Acceptable tradeoff for most use cases.

### 4. HTTP conditional requests (ETag / If-Modified-Since) — LOW EFFORT IF API SUPPORTS IT, NO BEHAVIOR CHANGE ✅

**Requires API probe.** Send `If-None-Match` or `If-Modified-Since` headers. If API returns 304 Not Modified, skip parsing. Still fetches full payload on change, but eliminates redundant parsing when no new events exist.

**Preserves:** All behavior. **Depends on:** API supporting these headers (many sports APIs don't).

### 5. Quarter-scoped fetch — MEDIUM EFFORT IF API SUPPORTS IT, NO BEHAVIOR CHANGE ✅

**Requires API probe.** If the API accepts a `quarter` parameter, fetch only the current quarter. Reduces payload by ~75% in Q4 (fetch 1 quarter instead of 4).

**Preserves:** All behavior — we only care about the current quarter's new events anyway (tracked via `sinceEventId` which is monotonically increasing).

### 6. Content-Length / hash-based skip — MEDIUM EFFORT, NO BEHAVIOR CHANGE ✅

Cache the previous response's `Content-Length` header or compute a hash. If identical on next fetch, skip parsing entirely. Cheap to implement if the API returns consistent Content-Length.

**Preserves:** All behavior. Saves CPU (parsing), not bandwidth.

## What Nikola Should Probe

1. **Response headers:** Does `PlaybyPlay?gamecode=X&seasoncode=Y` return `ETag`, `Last-Modified`, or consistent `Content-Length`?
2. **Quarter parameter:** Does `PlaybyPlay?gamecode=X&seasoncode=Y&quarter=3` work? (Or `period`, `q`, etc.)
3. **Since parameter:** Does `PlaybyPlay?gamecode=X&seasoncode=Y&since=400` (by NUMBEROFPLAY) filter server-side?
4. **Compression:** Does the API support `Accept-Encoding: gzip`? (Would reduce 154KB → ~20KB on wire)

## Recommendation

**Immediate (no API probe needed):**
1. Implement option #1 (skip PBP when rosters not loaded) — trivial, zero risk
2. Implement option #2 (poll PBP every 30-45s instead of 15s) — easy, minimal impact

**After API probe:**
3. If ETag/conditional supported → implement option #4
4. If quarter filter exists → implement option #5
5. If gzip supported but not currently used → add `Accept-Encoding: gzip` header

These changes combined could reduce PBP traffic by **90%+** with zero or near-zero behavior impact.
