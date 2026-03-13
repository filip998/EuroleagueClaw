# PBP API Incremental Fetch Investigation

**Author:** Nikola (Data / Integrations)
**Date:** 2026-03-13
**Status:** INVESTIGATION COMPLETE — No action required, mitigations optional

## Question

Can we avoid fetching the full PlayByPlay payload (~157 KB, 578 events) on every poll cycle?

## Findings

### What was tested

| Test | Result |
|------|--------|
| Query params (`quarter`, `from`, `since`, `cursor`, `offset`, `lastEventId`, `startNumber`) | All ignored — full payload returned |
| `/api/PlaybyPlay/Period?period=4` | Period param ignored — full payload returned |
| `If-Modified-Since` conditional request | Ignored — always 200 |
| `ETag` / `Last-Modified` response headers | Not present |
| gzip compression (`Accept-Encoding: gzip`) | **Works: 157 KB → 10.7 KB (6.8%)** |
| Alternative endpoints (Plays, Events, LiveUpdates, Actions, Timeline, GameUpdate) | All return 406 Not Acceptable |

### Useful alternative endpoints discovered

| Endpoint | Size (raw) | Size (gzip) | Content |
|----------|-----------|-------------|---------|
| `/api/Header` | 929 B | 475 B | Scores, quarter scores, clock, fouls, timeouts, live status |
| `/api/Points` | 54 KB | 4.5 KB | Scoring plays only (166 events), with coordinates |
| `/api/Boxscore` | 13.7 KB | ~2 KB | Full player stats per team |

### Confidence

**High.** The API is an ASP.NET MVC 5.2 legacy service behind Cloudflare. It serves static-shaped responses with no pagination, filtering, or conditional support. The `Cache-Control: no-store` header confirms the server design is "always return everything fresh."

## Current State

The adapter already does client-side filtering via `sinceEventId` (adapter lines 158-161). GameTracker stores the last event ID and passes it on subsequent polls. The full payload is fetched but only new events are processed.

## Mitigation Options (if bandwidth becomes a concern)

1. **Ensure gzip is active** (near-free win). Node.js `fetch()` handles this by default. Effective payload is ~10.7 KB, not 157 KB. Verify with a debug log of `content-encoding` header on responses.

2. **Use `/api/Header` for score-only polling.** At 475 bytes gzipped, this is 22× cheaper than PBP. GameTracker could poll Header first and only fetch full PBP when the score changes. This would avoid PBP fetches during dead-ball periods, timeouts, and halftime.

3. **Use `/api/Points` instead of full PBP for roster tracking.** If the only consumer of PBP is fantasy roster notifications (scoring plays), Points gives us the same data at 4.5 KB gzipped vs 10.7 KB. Trade-off: loses non-scoring events (assists, steals, blocks tracked separately in PBP).

4. **Client-side response caching with short TTL.** If multiple chats track the same game, cache the parsed PBP response for 5-10 seconds. Already partially handled by the games cache pattern — could extend to PBP.

5. **Adaptive polling interval.** During timeouts/halftime (detectable from Header's `RemainingPartialTime` and `Quarter`), reduce PBP poll frequency from every 10s to every 30-60s.

## Recommendation

No code changes needed now. The gzip compression already reduces the real transfer to ~11 KB which is acceptable for a polling bot. If we want to optimize further, option #2 (Header-first gating) gives the best cost/complexity trade-off.
