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
