# Bogdan — History

## Project Context
**Project:** EuroleagueClaw — TypeScript/Node.js bot for live EuroLeague basketball game updates to Telegram group chats.
**Stack:** TypeScript (strict, ESM), Node.js ≥22, grammy, better-sqlite3, node-cron, Zod, Pino, vitest
**Architecture:** Hexagonal (Ports & Adapters) with 5 ports: ChatPort, StatsPort, FantasyPort, StoragePort, SchedulerPort
**User:** Filip Tanic

## Learnings

### Architecture Review (2025-03-01)
- **5 ports defined** (`ChatPort`, `StatsPort`, `FantasyPort`, `StoragePort`, `SchedulerPort`) — all in `src/ports/`
- `SchedulerPort` + `NodeCronAdapter` exist but are **orphaned** — never wired in `container.ts` or used by any domain service. `GameTracker` uses raw `setInterval` instead.
- `TriviaService` (domain layer) imports `readFileSync` from `node:fs` — infrastructure leak in the domain.
- `container.ts` has a **70-line closure** for the `onEvent` callback wired into `GameTracker` — orchestration logic that should live in its own domain service.
- `OutgoingMessage.parseMode` is Telegram-specific (`'MarkdownV2' | 'HTML'`) — leaks platform concern into domain types.
- All domain services depend on port interfaces, not concrete adapters — correct DI direction.
- Tests are well-structured: unit tests mock ports via interfaces, integration tests hit real adapters.
- Error hierarchy (`AppError` → `ApiError`, `ConfigError`, `StorageError`) exists in `src/shared/errors.ts` but `StorageError` and `ConfigError` are never thrown by any code.
- `MessageComposer` holds mutable state (`teamNames` Map) without cleanup — potential memory leak on long-running instances.
- `sent_events` table used for dedup has no TTL/cleanup — unbounded growth.
- Config via Zod in `src/config.ts` is clean and well-structured.
- `InMemoryStorageAdapter` serves as test double — good for testing isolation.
- Key file paths: `src/container.ts` (DI), `src/config.ts` (config), `src/domain/types.ts` (domain model), `src/shared/errors.ts` (error hierarchy)
