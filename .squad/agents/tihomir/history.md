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

### Comprehensive Test Coverage Expansion (2026-07-18)
- **MarkdownV2 utility** (`tests/unit/markdown-v2.test.ts`): 24 tests covering `escapeMarkdownV2`, `bold`, `italic`, `underline`, `strikethrough`, `inlineCode`, `link`. Key finding: backslash is NOT escaped by the regex — `SPECIAL_CHARS` uses `\-` and `\]` as character class escapes, so standalone `\` passes through unescaped.
- **MessageComposer.composeRoundGames**: 7 tests for finished/upcoming/empty/mixed games, MarkdownV2 bold formatting, date grouping with 📆 headers, and away-team winner display. Added `makeRoundGame()` factory helper.
- **MessageComposer.composeHelp MarkdownV2**: 2 tests verifying bold command wrapping (`*/help*`) and special char escaping. Note: `/` (slash) and `—` (em dash) are NOT MarkdownV2 special chars.
- **RosterTracker.getOverview extended**: 6 new tests for court positions (starters/bench/coach sections), captain ©, fire 🔥, opponent codes, and flat list fallback when no `courtPosition` data.
- **RosterTracker.loadRosters**: 4 tests for matchday number parameter, default matchday 0, empty rosters array, and player index rebuild for event matching.
- **Round detection** (`tests/unit/round-detection.test.ts`): 7 tests for `getCurrentRoundGames` covering active round selection, advance-to-next-round when all played, end-of-season fallback, empty rounds, in-progress games, game data mapping, and upcoming-only rounds. Tested via public method with `vi.stubGlobal('fetch')` mocking both `/rounds` and `/games` endpoints.
- **Total test count: 149** (up from 100). All passing. `tsc --noEmit` clean.

### Code Block Formatting Tests (2026-07-18)
- **`codeBlock()` helper** (`tests/unit/markdown-v2.test.ts`): 6 new tests — wraps in triple backticks, escapes backticks and backslashes inside, handles empty content, does NOT escape MarkdownV2 specials, handles multiline.
- **`composeRoundGames()` code blocks** (`tests/unit/message-composer.test.ts`): 3 new tests — finished game scores inside code blocks, upcoming game times/teams inside code blocks, headers (bold round name, 📆 dates) outside code blocks.
- **`getOverview()` code blocks** (`tests/unit/roster-tracker.test.ts`): 3 new tests — player data inside code blocks, owner/roster headers outside code blocks, position sections (Starting Five/Bench) inside code blocks when court positions present.
- **Total test count: 161** (up from 149). All passing. `tsc --noEmit` clean.

### RotoWire Integration Tests (2025-07-18)
- **`rotowire-adapter.test.ts`** (13 tests): `parseNews()` HTML extraction — player name, headline, date, position, injury type, news text. Edge cases: empty HTML, no blocks, missing player (skipped), player-link fallback to `news-update__player` class. `stripTags` tested with inline `<b>` tag. Caching: second call within TTL returns cached (fetch called once), separate caches for news vs injuries, stale cache returned on fetch error.
- **`injury-monitor.test.ts`** (9 tests): New injury detection + alert dispatch, dedup via seenKeys (no re-alert), incremental detection (only new entries on second check), multi-chat broadcast, empty news = no sendMessage, alert text includes "Injury Alerts" title, graceful handling of chat.sendMessage failure and news.getInjuryNews failure, 10-entry limit via `slice(0, 10)`.
- **`message-composer.test.ts`** composeNews section (10 new tests): 🏥 emoji for injuries, 📰 for general, truncation at 100 chars with `...`, no truncation for short text, MarkdownV2 escaping of `()` and `-`, bold title header with 🗞, empty entries returns "No news available", bold player name, injury type in italic metadata, 10-entry display limit.
- **Key finding**: `extractField` regex uses non-greedy `[\s\S]*?` and stops at first `<\/[a-z]+>` closing tag — nested HTML tags cause content truncation. Tests written to match this actual behavior.
- **Total test count: 207** (up from 161). All passing. `tsc --noEmit` clean.

### /roster Live Fetch Tests (2025-07-18)
- **6 new tests** in `tests/unit/command-router.test.ts` under `CommandRouter — /roster live fetch` describe block.
- **Key design discovery**: The `/roster` handler uses a graceful degradation pattern — API errors are caught and the handler falls through to cached `rosterTracker` data. No hard `❌` error; instead the warn-and-fallback approach keeps the UX smooth.
- **Edge case: fresh RosterTracker + API error** — returns "No fantasy rosters loaded" because `isLoaded()` is false and no cached data exists.
- **Edge case: pre-loaded RosterTracker + API error** — returns the previously-loaded overview (stale but functional).
- **Test helper pattern**: `buildRouter()` factory with overrides keeps test setup DRY; `makeRosterFetchResult()` factory follows project convention.
- **Pre-existing breakage**: `roster-tracker.test.ts` has 26 failures due to Strahinja's removal of `loadFromFile`, `loadFromFileAndMerge`, `mergeRosters`. Those tests need updating to use `loadRosters()` instead. The `sqlite.adapter.test.ts` 16 failures are a separate pre-existing issue.
- **Total test count: 228** (17 in command-router, up from 11). All 17 command-router tests pass.

### Roster Robustness Feature Tests (2025-07-18)
- **Strahinja's changes reviewed**: Removed `loadFromFile`, `loadFromFileAndMerge`, `mergeRosters`. Added `RosterStats` interface, `getStats()` method, `needsReload()` method, `lastLoadedAt` timestamp. `/roster` command now fetches live from Dunkest API with graceful fallback.
- **`getStats()` tests** (5 tests): Verified zero state when not loaded, correct player/team/round counts after load, normalized player names in output, unique team counting across rosters, zero state after loading empty rosters.
- **`needsReload()` tests** (5 tests): True when never loaded, false when recently loaded, true when stale (>1 hour via `vi.useFakeTimers`), false at 59-minute boundary, true after loading empty rosters.
- **`lastLoadedAt` tests** (4 tests): Null before loading, set to valid Date after loading, not set on empty rosters, updates on subsequent loads (verified via fake timers with 5s gap).
- **`/rostercheck` command**: NOT implemented by Strahinja — tests were requested but no production code exists. Filed in decisions inbox.
- **Total test count: 239** (42 in roster-tracker, up from 28; 14 new tests added). All 223 non-SQLite tests pass. `tsc --noEmit` clean.
