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
