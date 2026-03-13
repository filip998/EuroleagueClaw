# Nikola — History

## Project Context
**Project:** EuroleagueClaw — TypeScript/Node.js bot for live EuroLeague basketball game updates to Telegram group chats.
**Stack:** TypeScript (strict, ESM), Node.js ≥22, grammy, better-sqlite3, node-cron, Zod, Pino, vitest
**Architecture:** Hexagonal (Ports & Adapters) with 5 ports: ChatPort, StatsPort, FantasyPort, StoragePort, SchedulerPort
**User:** Filip Tanic

## Learnings

### Joined Team (2026-03-13)
- Owns external APIs, scraping, parsing, caching, and upstream schema-change investigation.
- Primary surfaces are `src/adapters/`, `src/ports/`, and shared integration utilities.
- Works closely with Strahinja when adapter changes require domain wiring or container updates.

### PBP API Raw Capture (2026-03-13)
- **Live PBP endpoint confirmed working:** `https://live.euroleague.net/api/PlaybyPlay?gamecode={gameCode}&seasoncode={seasonCode}` returns full play-by-play even for finished games.
- **Response structure:** Top-level keys are `Live`, `TeamA`, `TeamB`, `CodeTeamA`, `CodeTeamB`, `ActualQuarter`, `FirstQuarter`, `SecondQuarter`, `ThirdQuarter`, `ForthQuarter`, `ExtraTime`. Each quarter is an array of PBP event objects.
- **PAO vs Zalgiris game:** `game_code=305`, `season_code=E2025` (Panathinaikos AKTOR Athens vs Zalgiris Kaunas). Final score 92–88 (PAO win). 578 total PBP events across 4 quarters.
- **Raw payload size:** ~157 KB minified, ~237 KB pretty-printed. No transformation needed — raw API response preserved as-is.
- **Database query method:** SQLite better-sqlite3 module has version mismatch issues on Windows; used binary string extraction from `.db` file to locate game identifiers instead. Worked around by analyzing database dump directly.
- **Data location:** PAO/Zalgiris PBP JSON saved to `C:\Users\filiptanic\.copilot\session-state\0a0abdd4-0bc4-4c5a-9ff8-d446e3c86601\files\` (raw and pretty-printed).

### PBP API Incremental Fetch Investigation (2026-03-13)
- **No server-side incremental support.** Tested `quarter`, `q`, `from`, `since`, `lastEventId`, `cursor`, `offset`, `startNumber` params — all ignored. API always returns full payload (157 KB, 578 events).
- **No conditional request support.** `If-Modified-Since` header ignored (always 200, never 304). No `ETag` or `Last-Modified` in responses. `Cache-Control: no-store, must-revalidate, no-cache` — explicitly anti-cache.
- **gzip compression works well.** PBP compresses from 157 KB → ~10.7 KB (6.8% ratio). This is already handled by Node.js `fetch()` accepting `Accept-Encoding: gzip` by default.
- **Alternative lightweight endpoints discovered:**
  - `/api/Header` — 929 bytes (475 gzipped). Has live scores, quarter scores, fouls, timeouts, game clock. Great for score-only polling.
  - `/api/Points` — 54 KB (4.5 KB gzipped), 166 scoring events only. Has score running totals, player, team, shot coordinates.
  - `/api/Boxscore` — 13.7 KB. Full player stats per team.
- **`/api/PlaybyPlay/Period?period=N`** also ignores the period param — returns full payload.
- **Other endpoint guesses** (`Plays`, `Events`, `LiveUpdates`, `Actions`, `Timeline`, `GameUpdate`) all return 406 Not Acceptable.
- **Current client-side filtering is the right approach.** The adapter already accepts `sinceEventId` and filters locally (lines 158-161). This is the only viable strategy given the API design.
- **Key mitigation options documented in decision inbox** (`nikola-pbp-api-investigation.md`).

### Live Player Notification Latency Investigation (2026-07-18)
- **End-to-end latency breakdown for player-action notifications:**
  1. **Upstream publication (EuroLeague stat crew): 2–15s** — Hard floor. Scoring plays appear in 2–5s, non-scoring (misses, turnovers) in 5–15s. No public WebSocket or push API exists.
  2. **Poll interval wait: 0–15s (avg 7.5s)** — Default `EUROLEAGUE_POLL_INTERVAL_MS=15000`. Biggest controllable knob.
  3. **Sequential API calls per poll: ~0.5–1.3s** — `getLiveScore()` (v2 API) then `getPlayByPlay()` (live.euroleague.net). Two round-trips in series.
  4. **Throttle manager: up to 120s suppression** — Default 5 msg/min, 120s window. Roster match messages are normal-priority → easily throttled during active play.
  5. **Telegram send: ~0.1–0.3s** — Negligible.
- **Current average end-to-end: ~15–20s.** Worst case ~32s.
- **Achievable best-case with 5s polling: avg ~8–10s, worst ~21s.** True "instant" (<2s) is impossible without a push API.
- **Key finding:** RosterTracker's `NOTABLE_EVENT_TYPES` only includes made shots, assists, steals, blocks. Misses (`2FGA`, `3FGA`, `FTA`) are excluded. Adding them roughly doubles notification volume.
- **Key finding:** PBP events already carry `POINTS_A`/`POINTS_B` running scores. The `getLiveScore()` call is redundant for player-action detection — PBP alone can derive all game-level events. Removing this serial dependency saves ~200–500ms per cycle.
- **Key finding:** Throttle config (5 msg/min) is fundamentally incompatible with per-action player notifications. A busy quarter could generate 10–20 roster-matched events per minute across tracked players.
- **Decision documented in** `nikola-live-player-updates.md`.

### Tracked-Player Live Updates Strategy (2026-03-13)
- **Mission:** Recommend fastest realistic data strategy for live tracked-player event notifications given upstream constraints.
- **Key recommendations:** PBP-primary polling at 5-second intervals reduces average latency from 15–20s to 8–10s. Decouple `getLiveScore()` from hot path; use only as 30–60s fallback for game status transitions.
- **Polling insights:** No API rate limits observed at 720 req/hour. Full PBP gzip transfer is only 10.7 KB — acceptable. Upstream stat crew entry time (2–15s) is the hard floor; no technical workaround exists.
- **Throttling challenge:** Default 5 msg/min incompatible with per-action notifications. Batch events per cycle (20–30s digest) or implement separate throttle tier for PBP events.
- **Recommendation captured in** `.squad/decisions.md` → "Live Tracked-Player Updates — Data Strategy".


### PBP Poll Cost Benchmark (2026-07-18)
- **Benchmark target:** PAO vs Zalgiris (gamecode=305, seasoncode=E2025), 578 events, 4 quarters.
- **Raw payload:** 153.6 KB JSON. On-wire (gzip): **10.5 KB** (content-length: 10,754 bytes). Compression ratio: 6.8%.
- **Network fetch times (5 runs from dev machine):**
  - Cold (first call, TLS handshake): ~960ms
  - Warm (reused connection): 50–66ms, avg ~56ms
  - The first call per connection is 15–20× slower due to TLS + TCP setup to Cloudflare.
- **Local processing (1000-run averages):**
  - JSON.parse only: **0.74ms**
  - Full parse + flatten quarters + carry scores + map all 578 events: **0.78ms**
  - Parse + flatten + filter from sinceId=550 (84 new events): **1.00ms**
  - Parse + flatten + filter from sinceId=575 (60 new events): **0.86ms**
  - Filtering adds negligible cost (~0.1–0.2ms). The JSON parse dominates local work.
- **Total per-poll cost (warm connection): ~57ms.** Network is >98% of total time. Local processing is <1ms.
- **Conclusion:** A single PBP poll costs ~10.5 KB of bandwidth and ~57ms wall time on a warm connection. At 15s polling, that's 240 calls/hour = ~2.5 MB/hour bandwidth. The operation is cheap. Network latency to Cloudflare is the only real cost; local CPU work is trivially fast.
