---
name: "euroleague-api-latency"
description: "Latency characteristics and optimization strategies for EuroLeague live data endpoints"
domain: "data-integration"
confidence: "high"
source: "empirical testing + production observation"
---

## Context

EuroLeague's live data API (live.euroleague.net/api) is a legacy ASP.NET MVC 5.2 service behind Cloudflare. It has no push/WebSocket support, no incremental fetch, no conditional requests, and no server-side filtering. All optimization must happen client-side.

## Endpoint Latency Profiles

| Endpoint | Gzipped Size | Content | Best For |
|----------|-------------|---------|----------|
| `/api/Header?gamecode=X&seasoncode=Y` | ~475 B | Score, clock, quarter, fouls, timeouts | Lightweight "anything changed?" check |
| `/api/Points?gamecode=X&seasoncode=Y` | ~4.5 KB | Scoring plays only with coordinates | Score-only notifications |
| `/api/PlaybyPlay?gamecode=X&seasoncode=Y` | ~10.7 KB | ALL events (makes, misses, rebounds, fouls, subs) | Full player-action tracking |
| `/api/Boxscore?gamecode=X&seasoncode=Y` | ~2 KB | Cumulative player stats | Post-game or periodic stat checks |
| v2 API `/v2/competitions/E/seasons/X/games/Y` | ~1-2 KB | Game metadata, scores, partials | Game status detection |

## Upstream Publication Cadence

Events appear in the PBP endpoint after the arena stat crew enters them:
- **Scoring plays (makes):** 2–5 seconds after the actual play
- **Non-scoring plays (misses, turnovers, fouls):** 5–15 seconds
- **Administrative events (subs, timeouts):** 3–10 seconds
- **This is the hard latency floor** — nothing client-side can beat it

## Polling Sweet Spots

| Interval | Avg Wait | Hourly Requests | Hourly Transfer | Risk |
|----------|----------|-----------------|-----------------|------|
| 15s (current default) | 7.5s | 240 | ~2.6 MB | None |
| 10s | 5.0s | 360 | ~3.9 MB | None |
| 5s (recommended for live player tracking) | 2.5s | 720 | ~7.7 MB | Low — no rate limits observed |
| 3s | 1.5s | 1200 | ~12.8 MB | Medium — undocumented limits possible |
| 2s | 1.0s | 1800 | ~19.3 MB | High — may trigger Cloudflare |

## Key Patterns

### PBP as single source of truth
PBP events carry `POINTS_A`/`POINTS_B` (running scores), `MARKERTIME` (clock), and quarter info. A separate LiveScore call is redundant if PBP is already being fetched. Derive game-level events from PBP to eliminate the serial API dependency.

### Client-side sinceEventId filtering
The adapter fetches the full PBP payload every time. Filter by `NUMBEROFPLAY > lastSeenId`. Event IDs are mostly monotonic but can have gaps (e.g., 626 → 641 → 628 observed in real data). Always use `>` comparison, never `=== lastId + 1`.

### Header-gating is NOT useful for miss detection
`/api/Header` only changes when the score, clock, or quarter changes. Missed shots don't change the score. Don't use Header as a gate if the goal is to detect all player actions including misses.

## Per-Poll Cost (Benchmarked 2026-07-18)

| Metric | Value |
|--------|-------|
| Wire transfer (gzip) | ~10.5 KB |
| Raw payload | ~154 KB |
| Network fetch (cold/TLS) | ~960ms |
| Network fetch (warm) | 50–66ms avg ~56ms |
| Local processing (parse+flatten+filter) | <1ms |
| **Total per poll (warm)** | **~57ms** |
| Bottleneck | Network (>98% of wall time) |

JSON.parse is ~0.74ms for the full 578-event payload. Quarter flattening, score carrying, and sinceEventId filtering add <0.3ms combined. Local CPU cost is negligible; keep-alive connection reuse is the only optimization that matters for fetch latency.

## Anti-Patterns

- **Polling PBP and LiveScore in series** — wastes 200–500ms per cycle on a redundant call
- **Using `/api/Points` for "all events"** — Points only has scoring events, no misses/turnovers/assists
- **Assuming event IDs are strictly sequential** — gaps observed in production data
- **Rate-limiting PBP roster notifications with the general throttle** — player events can exceed 5/min easily during active play; needs separate tier or batching
- **Using default undici keepAliveTimeout (4s) with 5s polling** — connection drops between every poll, paying ~960ms TLS penalty each time. Set `keepAliveTimeout: 15_000` minimum.

## Connection Management (Node 22)

Node 22's `fetch()` uses undici. The global dispatcher pools connections per-origin with a default `keepAliveTimeout` of 4000ms. For polling intervals ≤5s, the connection will be closed between polls.

**Fix:** Call `setGlobalDispatcher(new Agent({ keepAliveTimeout: 15_000 }))` once at startup. This keeps TCP+TLS connections warm across poll cycles, reducing per-poll latency from ~960ms (cold) to ~56ms (warm).

Two hosts are involved (`api-live.euroleague.net` and `live.euroleague.net`) — undici pools them in separate connection queues automatically.
