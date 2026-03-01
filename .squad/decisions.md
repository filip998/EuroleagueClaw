# Decisions

<!-- Append-only. Newest entries at the bottom. -->

## User Directive — Filip Tanic (2026-03-01)

**Status:** CAPTURED

**Decision:** Always use the best possible models. Unlimited budget. Optimize for precision, code quality, code structure, modern tools, modern languages, and expandability. Never optimize for cost.

---

## DevOps Hire Evaluation — Bogdan (2026-03-01)

**Status:** DECISION MADE

**Verdict:** Don't Hire

EuroleagueClaw does **not** need a dedicated DevOps team member. The deployment footprint is too small to justify a specialist.

### Analysis

| Asset | Status | Notes |
|-------|--------|-------|
| Dockerfile | ✅ Done | Multi-stage build, well-structured |
| docker-compose.yml | ✅ Done | Local dev only, simple single-service setup |
| GitHub Actions CI | ⚠️ Broken | `squad-ci.yml` runs `node --test test/*.test.js` — project uses **vitest**, not Node's built-in test runner |
| CD pipeline | ❌ Missing | No workflow to build image → push to ACR → deploy to Azure Container Apps |
| Infrastructure-as-Code | ❌ Missing | No Bicep/Terraform; README has manual `az` CLI instructions |
| Azure Files mount | ❌ Missing | Required for SQLite persistence, documented in README but not automated |

### Why Not Hire

1. **Single-container architecture.** One bot process, one SQLite file, one health endpoint. Azure Container Apps handles scaling, restarts, TLS, and health checks out of the box.

2. **The gap is one-time setup, not ongoing work.** What's missing is:
   - A CI workflow (~30 lines): lint + vitest
   - A CD workflow (~60 lines): docker build → ACR push → `az containerapp update`
   - Azure resource provisioning: Container App Environment + ACR + Azure Files share
   - Secrets wired in GitHub Actions + Azure
   
   This is a week of work, not a full-time role.

3. **No operational complexity.** SQLite prevents horizontal scaling (max-replicas=1 is already set). No database migrations. No multi-region. No blue-green needed for a Telegram bot that reconnects automatically.

4. **Well-documented territory.** GitHub Actions + Azure Container Apps is a standard pattern with official docs and examples.

### What To Do Instead

**Task Strahinja (Backend Dev)** with:

1. **Fix CI** — Replace `node --test test/*.test.js` with `npm ci && npm run lint && npm test` in `squad-ci.yml`
2. **Add CD workflow** — New `deploy.yml` that builds the Docker image, pushes to ACR, and runs `az containerapp update` on push to `main`
3. **One-time Azure setup** — Document or script (Bicep) the resource creation: Container App Environment, ACR, Azure Files share for `/app/data`
4. **Secrets** — `TELEGRAM_BOT_TOKEN` + `AZURE_CREDENTIALS` in GitHub Actions secrets; remaining env vars in Container App config

---

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
