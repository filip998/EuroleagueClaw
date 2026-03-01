# Decisions

<!-- Append-only. Newest entries at the bottom. -->

## Architecture Review — Bogdan (2025-03-01)

**Status:** REVIEW COMPLETE

**Verdict:** The hexagonal architecture is **solid in structure** but has **several violations and dead code** that should be cleaned up before the codebase grows further.

### Architectural Violations (Must Fix)
1. **`TriviaService` imports `readFileSync`** (`src/domain/trivia-service.ts:1`) — direct filesystem I/O in the domain layer. The `seedTrivia` method should accept data, not a file path.
2. **`onEvent` callback** (`src/container.ts:66-81`) is a 70-line inline closure containing orchestration logic (throttling → composing → dedup → sending → recording). Should be extracted to an `EventDispatcher` or `NotificationService`.
3. **`OutgoingMessage.parseMode`** (`src/domain/types.ts:174`) uses `'MarkdownV2' | 'HTML'` — Telegram-specific values leaked into the domain type.
4. **`SchedulerPort` orphaned** — fully implemented but **never wired** in the DI container. `GameTracker` uses raw `setInterval` instead of the port.

### Quality Issues (Should Fix)
5. **Dead error classes** — `ConfigError` (never thrown) and `StorageError` (never thrown) are misleading; use them or delete them.
6. **`sent_events` unbounded growth** — table has no TTL or periodic purge; grows indefinitely.
7. **`MessageComposer` mutable state** — `teamNames` Map has no cleanup mechanism; potential memory leak on long-running bot.

### Strengths
- 5 well-defined ports with clean interfaces
- Adapters correctly depend inward on port interfaces
- Domain services correctly depend on port interfaces, not concrete adapters
- 81 tests, all passing; excellent testability
- Clean separation of concerns across `ports/` → `domain/` → `adapters/` → `shared/`

### Recommendations
1. Extract event dispatch logic from `container.ts:66-81` into a `NotificationService` domain class
2. Remove `readFileSync` from `TriviaService` — pass data array or use a port
3. Wire `SchedulerPort` or delete it
4. Generalize `OutgoingMessage.parseMode` — remove Telegram-specific types from domain
