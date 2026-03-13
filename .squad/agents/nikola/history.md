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

### PBP API Raw Capture (2026-07-18)
- **Live PBP endpoint confirmed working:** `https://live.euroleague.net/api/PlaybyPlay?gamecode={gameCode}&seasoncode={seasonCode}` returns full play-by-play even for finished games.
- **Response structure:** Top-level keys are `Live`, `TeamA`, `TeamB`, `CodeTeamA`, `CodeTeamB`, `ActualQuarter`, `FirstQuarter`, `SecondQuarter`, `ThirdQuarter`, `ForthQuarter`, `ExtraTime`. Each quarter is an array of PBP event objects.
- **PAO vs Zalgiris game:** `game_code=305`, `season_code=E2025`, final score 92–88 (PAO win). 578 total PBP events across 4 quarters.
- **Raw payload size:** ~157 KB minified, ~237 KB pretty-printed. No transformation needed — raw API response preserved as-is.
- **User preference reinforced:** Always use Claude Opus 4.6 (premium) for all squad work. Medium reasoning acceptable only for trivial tasks.
