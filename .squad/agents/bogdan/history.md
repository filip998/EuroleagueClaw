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

### DevOps Evaluation (2025-07-18)
- **Decision: No DevOps hire needed.** Deployment footprint is a single container + SQLite. Azure Container Apps handles ops concerns.
- **CI is broken** — `squad-ci.yml` runs `node --test test/*.test.js` but project uses vitest (`npm test`). Needs fixing.
- **CD pipeline missing** — No workflow to build Docker image → push to ACR → deploy to Azure Container Apps. ~60 lines of YAML to add.
- **Dockerfile is solid** — Multi-stage build, Node 22 Alpine, correct native module handling for better-sqlite3.
- **SQLite persistence** — Requires Azure Files mount to `/app/data`; documented in README but not automated.
- **Scaling constraint** — SQLite forces `max-replicas=1`. Horizontal scaling would require replacing the storage layer first (architecture decision, not DevOps).
- **Recommendation** — Task Strahinja with CI fix + CD workflow + one-time Azure resource setup. Bounded ~1 week effort.
- **Squad workflows** — 10+ workflows in `.github/workflows/` are Squad tooling boilerplate (triage, heartbeat, promote, release), not project-specific CI/CD.

### Fantasy Roster Tracking Design (2025-07-18)
- **Play-by-play API is the blocker.** `EuroLeagueAdapter.getPlayByPlay()` returns `[]` — the v2 public API has no PBP endpoint. The `StatsPort` interface and `PlayByPlayEvent` domain type are fully defined and ready. Only the adapter implementation is missing.
- **GameTracker only uses `getLiveScore()`** — detects events by diffing aggregate scores. No player-level data flows through the system today.
- **`lastEventId` field exists on `TrackedGame`** but is never used (always `null`). It was designed for PBP cursor-based pagination — already wired in the storage layer.
- **Roster tracking does NOT need a new port.** Rosters are loaded from `data/rosters.json` at startup (same pattern as `data/trivia.json`). No database table needed — rosters are ephemeral per-round.
- **Integration point:** `GameTracker.pollGame()` gets a second callback (`onPlayByPlay`) alongside existing `onEvent`. PBP events flow to a `RosterTracker` domain service for matching.
- **Existing `FantasyPort`/`DunkestAdapter` are unrelated.** They handle Dunkest league standings (rankings/points). The roster feature is a separate concern — friends' player picks, not fantasy platform standings.
- **Player name matching is critical.** EuroLeague PBP API likely uses `"LASTNAME, FIRSTNAME"` format. A normalization function is needed for case-insensitive matching.
- **Key new files:** `src/domain/roster-tracker.ts` (domain service), `data/rosters.json` (roster data), `tests/unit/roster-tracker.test.ts`.
- **Key modified files:** `src/domain/game-tracker.ts` (PBP polling), `src/domain/types.ts` (roster types), `src/container.ts` (wiring), `src/domain/message-composer.ts` (roster match formatting), `src/domain/command-router.ts` (`/roster` command).
- **Full architecture proposal** written to `.squad/decisions.md`.

### Fantasy Roster Tracking Implementation (2026-03-01)
- **Architecture approved and implementation complete.** 8 files modified, 81 tests passing, build passes.
- **PBP API endpoint found:** `https://live.euroleague.net/api` (separate service, legacy widget API). Implemented `EuroLeagueAdapter.getPlayByPlay()`.
- **RosterTracker service created** — loads `data/rosters.json`, normalizes player names (lowercase+trim), matches PBP events against rosters.
- **GameTracker extended** — added `onPlayByPlay` callback (optional 6th param) for backward compatibility. Polls PBP in each `pollGame()` cycle.
- **Event filtering implemented** — only notable events trigger roster notifications: made shots (2pt/3pt/FT), assists, steals, blocks. No spam from rebounds, fouls, subs.
- **Container wiring complete** — RosterTracker loaded at startup; PBP callback injected into GameTracker; roster matching runs for each event.
- **Key decisions:** PBP base URL hardcoded (different API); RosterTracker uses readFileSync (matches TriviaService pattern, flagged for refactor); event filtering reduces notification noise.
- **Files modified:** euroleague.adapter.ts, types.ts, roster-tracker.ts (new), game-tracker.ts, message-composer.ts, command-router.ts, container.ts, rosters.json (new).
- **Test results:** All 81 tests passing. No existing tests modified (backward compatible design).

### Source Code Review — Uncommitted Changes (2026-07-18)
- **Scope:** 5 modified files in src/ — dunkest.adapter.ts, container.ts, command-router.ts, message-composer.ts, roster-tracker.ts.
- **Verdict: APPROVE** — all changes are architecturally sound, correct, and backward-compatible.
- **Dunkest `/roster/preview` endpoint** — Bug fix. The `/roster` endpoint only works for the authenticated user's teams; `/preview` is accessible for any team. Correct fix.
- **Container roster fallback removed** — Clean simplification. API is the canonical roster source; file fallback is gone. Graceful degradation preserved (warning logged on failure, rosters simply not loaded).
- **`/trackall` command** — New command to track all today's games at once. Uses plain text (correctly not in MARKDOWN_COMMANDS). Per-game error handling. Follows existing command patterns. No architecture violations.
- **Dead code in roster-tracker.ts** — `loadFromFile()`, `loadFromFileAndMerge()`, and `mergeRosters()` are now unused. The `readFileSync` import is only needed by dead methods. Non-blocking but should be cleaned up.
- **Missing tests** — `/trackall` has zero test coverage. Non-blocking but flagged for follow-up.
- **Test results:** 206/222 pass. 16 SQLite failures are pre-existing Node version mismatch (MODULE_VERSION 137 vs 127), unrelated to changes.

### PBP Fetch Optimization Analysis (2026-07-18)
- **PBP is used for ONE purpose only:** roster matching (friend's player notifications). It is NOT used for score detection, quarter transitions, lead changes, or big runs — those all use `getLiveScore()`.
- **Full game PBP payload:** ~154 KB, 578 events. Only 27% (156) are "notable" events the bot cares about. The rest (fouls, rebounds, subs, timeouts) are fetched and parsed but discarded.
- **Client-side filtering:** `sinceEventId` filter happens AFTER full fetch+parse. The upstream `live.euroleague.net/api/PlaybyPlay` endpoint has no known server-side filtering, pagination, or quarter scoping.
- **Hidden waste discovered:** PBP is fetched even when rosters aren't loaded. The `onPlayByPlay` callback is always wired in container.ts; it returns early if rosters missing, but the HTTP fetch already happened.
- **Poll frequency:** PBP polls at same rate as LiveScore (default 15s). Over a 2-hour game, that's ~480 full fetches totaling ~45MB per tracked game.
- **Recommended immediate wins:** (1) Skip PBP fetch when `!rosterTracker.isLoaded()` — trivial, zero risk. (2) Reduce PBP poll frequency to 30-45s — easy, roster notifications aren't as time-critical as score updates.
- **Pending:** Nikola probing API for ETag/conditional request support, quarter parameter, gzip, and server-side `since` filter.
- **Full analysis:** Written to `.squad/decisions/inbox/bogdan-pbp-alternatives.md`.

### Live Tracked-Player Notifications Architecture (2026-07-18)
- **Product goal:** Whenever a tracked player does anything notable (including missed shots), post to chat instantly.
- **Current state:** 80% of plumbing exists. PBP polling (15s) → RosterTracker matching → MessageComposer → chat. Missing: event filter too restrictive (blocks misses, turnovers, fouls), no throttling on PBP messages, no event class configuration.
- **Polling:** Keep 15s intervals. The PBP API has no server-side filtering, no WebSocket. 15s aligns with basketball possession length (~24s). Going faster has marginal UX benefit and doubles API load.
- **Event classes designed:** `scoring`, `playmaking`, `defensive`, `negative`, `administrative`. Default subscription: all except `administrative`. Configurable via future `/trackconfig` command.
- **Spam control is the critical piece.** PBP roster matches currently bypass `ThrottleManager` entirely. Phase 1: wire through throttle with priority levels. Phase 2: `PlayerEventBatcher` service that batches player events into digest messages (grouped by player, flushed every 20-30s).
- **Per-player subscriptions deferred.** Roster-based model covers the use case. Adding `/trackplayer` subscription management is unnecessary complexity.
- **Deduplication already solved.** `lastEventId` + `sinceEventId` prevents replay. Restart-safe via SQLite persistence.
- **Separation of score vs player updates:** Already visually distinct (📋 prefix + MarkdownV2 for roster, plain text for scores). Future option: Telegram topic threading.
- **Phase 1 (ship first, 1-2 days):** Expand `NOTABLE_EVENT_TYPES`, wire PBP through `ThrottleManager`, add PBP event priority.
- **Phase 2 (polish, 3-5 days):** `PlayerEventBatcher` digest service, `/trackconfig` command, event class persistence.
- **Phase 3 (if demanded):** Per-player subscriptions, topic threading, PBP API optimization.
- **Full recommendation:** Written to `.squad/decisions/inbox/bogdan-live-player-architecture.md`.

### Code Review and Orchestration (2026-03-13)
- **Scribe role finalized:** Merge agent output → orchestration logs + session log, consolidate decision inbox → decisions.md, deduplicate, update agent histories, commit to git.
- **Orchestration logs created:** `2026-03-13T073916-nikola.md` and `2026-03-13T073916-bogdan.md` summarizing each agent's findings and recommendations.
- **Session log created:** `2026-03-13T073916-live-player-updates.md` with full problem statement, latency analysis, architecture recommendation, implementation scope, and risks.
- **Decision consolidation:** Merged 15 inbox files (nikola-live-player-updates, bogdan-live-player-architecture, nikola-pbp-api-investigation, bogdan-pbp-alternatives, strahinja-roster-live-fetch, strahinja-roster-robustness, strahinja-tv-schedule, tihomir-roster-tests, tihomir-roster-test-coverage, bogdan-src-review, copilot directives) into decisions.md with deduplication and cross-referencing.
- **History updates:** Appended new learnings to nikola/history.md and bogdan/history.md with references to new decisions and session artifacts.
- **Git integration:** Prepared .squad/ directory for commit with orchestration logs, session log, updated decisions.md, and agent histories.
