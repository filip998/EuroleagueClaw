# Tihomir — History

## Project Context
**Project:** EuroleagueClaw — TypeScript/Node.js bot for live EuroLeague basketball game updates to Telegram group chats.
**Stack:** TypeScript (strict, ESM), Node.js ≥22, grammy, better-sqlite3, node-cron, Zod, Pino, vitest
**Architecture:** Hexagonal (Ports & Adapters) with 5 ports: ChatPort, StatsPort, FantasyPort, StoragePort, SchedulerPort
**User:** Filip Tanic

## Learnings

### Architecture Review Findings (2026-03-01)
- **`sent_events` table has unbounded growth** — Used for dedup in event dispatch. Currently has no TTL or periodic purge mechanism. Before implementing storage improvements, check if this needs lifecycle management.
- **`StoragePort` and `InMemoryStorageAdapter` are clean abstractions** — Good model for how new storage adapters should be structured. Be aware that `StorageError` is defined but never thrown; raw errors propagate instead.
- **Memory management concern:** `MessageComposer` holds mutable `teamNames` Map with no deregistration mechanism — potential memory leak on long-running instances. Consider if storage layer needs explicit cleanup hooks when tracking stops.

### Fantasy Roster Tracking Tests (2026-03-01)
- **Temp file strategy for `loadFromFile` tests**: Use `mkdtempSync` + `writeFileSync` in `beforeEach`/`afterEach` to create and clean up real JSON fixtures. Avoids mocking `readFileSync` and tests the full I/O path.
- **`RosterTracker.normalizeName` is private but tested implicitly** via case-insensitive matching test (`"campazzo, facundo"` matches `"CAMPAZZO, FACUNDO"`). No need to expose internals.
- **Non-notable event types tested exhaustively**: foul, substitution, all misses, rebound, turnover, timeout — all confirmed to return empty arrays from `matchEvent`.
- **`composeRosterMatch` emoji mapping**: scoring events (2PT/3PT/FT) → 🏀, assist → 🎯, steal → 🔥, block → 🛡️. Tested each branch.
- **Test helper pattern**: `makePbpEvent()` and `makeRosterData()` factory functions with partial overrides keep tests concise and readable. Matches project convention from `game-tracker.test.ts`.
