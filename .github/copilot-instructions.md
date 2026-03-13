# Copilot Instructions — EuroleagueClaw

EuroLeague game updates bot for Telegram group chats. Tracks live games, posts score changes, serves fantasy basketball data, trivia, news, and TV schedules.

## Build, Test, Lint

```bash
npm run dev          # Hot-reload dev server (tsx watch + .env)
npm run build        # TypeScript compile (tsc → dist/)
npm test             # Run all tests (vitest run)
npx vitest run tests/unit/game-tracker.test.ts  # Run a single test file
npx vitest run -t "should detect lead change"   # Run a single test by name
npm run lint         # ESLint (src/ + tests/)
npm run format       # Prettier (write mode)
npm run format:check # Prettier (check mode)
```

## Architecture

Hexagonal (Ports & Adapters). Domain logic never imports adapters directly — everything goes through port interfaces.

### Ports (`src/ports/`)

| Port | Purpose | Adapter(s) |
|------|---------|------------|
| `ChatPort` | Send/receive bot commands | `TelegramAdapter` (grammy) |
| `StatsPort` | Live game data, schedules | `EuroLeagueAdapter` (api-live.euroleague.net) |
| `FantasyPort` | Fantasy league rosters/standings | `DunkestAdapter` (fantaking-api.dunkest.com) |
| `StoragePort` | Persistence | `SQLiteAdapter` (better-sqlite3), `InMemoryStorageAdapter` (tests) |
| `NewsPort` | Player news and injuries | `RotoWireAdapter` (HTML scraping) |
| `TvSchedulePort` | TV broadcast schedule | `ArenaSportAdapter` (HTML scraping) |
| `SchedulerPort` | Cron jobs and one-shot timers | `NodeCronAdapter` (node-cron) |

### Domain Services (`src/domain/`)

- **`GameTracker`** — Polls live games, detects events (score changes, quarter transitions, lead changes, big runs), emits `GameEvent` objects
- **`CommandRouter`** — Maps `/command` strings to handler functions; some commands use MarkdownV2 formatting (tracked in `MARKDOWN_COMMANDS` set)
- **`MessageComposer`** — Formats domain events into human-readable chat messages
- **`ThrottleManager`** — Rate-limits outgoing messages per chat
- **`FantasyTracker`**, **`RosterTracker`**, **`TriviaService`**, **`InjuryMonitor`** — Feature-specific domain services

### Wiring

`src/container.ts` → `createContainer(config)` manually wires all adapters and domain services. No DI framework — just constructor injection. Optional features (fantasy, TV schedule) are conditionally loaded based on config.

`src/index.ts` boots: load config → create container → initialize storage → seed trivia → resume tracked games → start Telegram listener → start health check endpoint.

## Key Conventions

### TypeScript ESM with `.js` extensions

The project uses `"type": "module"` with `verbatimModuleSyntax: true`. **All imports must use `.js` extensions**, even when importing `.ts` files:

```typescript
import { loadConfig } from './config.js';
import type { ChatPort } from './ports/chat.port.js';
```

### No barrel exports

Each file is imported directly by its full path. There are no `index.ts` barrel files (except the app entry point).

### Error classes

Custom error hierarchy in `src/shared/errors.ts`: `AppError` → `ApiError` (with statusCode, url), `ConfigError`, `StorageError`. Adapters throw typed errors; domain code catches them for graceful degradation.

### Retry and caching

`withRetry()` from `src/shared/retry.ts` wraps external API calls with exponential backoff (default: 3 attempts, 1s base delay). API adapters use in-memory TTL caches (5 min for game data, 1 hour for scraped content).

### MarkdownV2 formatting

Telegram messages use `src/shared/markdown-v2.ts` helpers (`escapeMarkdownV2`, `bold`, `italic`, `link`, `SEPARATOR`). Commands that return formatted text are listed in the `MARKDOWN_COMMANDS` set in `command-router.ts` and get `parseMode: 'MarkdownV2'` on the outgoing message.

### Config validation

`src/config.ts` uses Zod schemas to validate and type all environment variables. Config is loaded once at startup via `loadConfig()` and passed through the container.

### Logging

Pino logger (`src/shared/logger.ts`). All adapters and domain services receive a logger via constructor. Use structured fields: `{ chatId, command }`, `{ url, statusCode }`, `{ jobId }`.

## Testing Patterns

- **Framework:** Vitest with `globals: true` (no imports needed for `describe`, `it`, `expect`)
- **Port mocking:** Factory functions like `createMockStats()`, `createMockStorage()`, `createMockLogger()` returning objects with `vi.fn()` stubs
- **HTTP mocking:** `vi.stubGlobal('fetch', vi.fn())` to mock fetch calls in adapter tests
- **Test data:** Factory functions like `makeRoundGame()`, `makePbpEvent()` accepting `Partial<T>` overrides
- **Fake timers:** `vi.useFakeTimers()` for time-dependent tests (throttle, polling)
- **Integration tests:** SQLite adapter tested with `:memory:` database; EuroLeague adapter tested against real API structure
- **Coverage:** V8 provider, covers `src/**/*.ts` excluding `src/index.ts`

## Squad AI Team

This repo uses [Squad](https://github.com/AltNyx/create-squad) for AI agent orchestration (`.squad/` directory, `.github/agents/squad.agent.md`). The team has specialized agents (Strahinja for backend, Tihomir for testing, Bogdan for DevOps). **Standing directive:** every new feature must be automatically followed by tests — spawn test agent in parallel with or immediately after feature agent.
