# Strahinja — History

## Project Context
**Project:** EuroleagueClaw — TypeScript/Node.js bot for live EuroLeague basketball game updates to Telegram group chats.
**Stack:** TypeScript (strict, ESM), Node.js ≥22, grammy, better-sqlite3, node-cron, Zod, Pino, vitest
**Architecture:** Hexagonal (Ports & Adapters) with 5 ports: ChatPort, StatsPort, FantasyPort, StoragePort, SchedulerPort
**User:** Filip Tanic

## Learnings

### Architecture Review Findings (2026-03-01)
- **`OutgoingMessage.parseMode` is Telegram-specific** — Domain type at `src/domain/types.ts:174` uses `'MarkdownV2' | 'HTML'` which are Telegram constants. When adding a new chat platform, this will need to be generalized.
- **`SchedulerPort` is orphaned** — Exists and is implemented (`NodeCronAdapter`) but never wired in `container.ts`. `GameTracker` uses raw `setInterval` instead. Consider if this should be refactored to use the port or if the port/adapter should be deleted.
- **Platform-specific concerns leaking into domain** — As a future stats/scheduler adapter implementer, be aware that domain types may contain platform-specific values. Flag these for extraction during refactoring.
