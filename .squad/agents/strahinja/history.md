# Strahinja ΓÇö History

## Project Context
**Project:** EuroleagueClaw ΓÇö TypeScript/Node.js bot for live EuroLeague basketball game updates to Telegram group chats.
**Stack:** TypeScript (strict, ESM), Node.js ΓëÑ22, grammy, better-sqlite3, node-cron, Zod, Pino, vitest
**Architecture:** Hexagonal (Ports & Adapters) with 5 ports: ChatPort, StatsPort, FantasyPort, StoragePort, SchedulerPort
**User:** Filip Tanic

## Core Context

**Role:** Backend developer. Owns domain services, business logic, container wiring, and integration between adapters and ports.

**Key Responsibilities:**
1. Domain services ΓÇö GameTracker, CommandRouter, MessageComposer, RosterTracker, FantasyTracker, TriviaService
2. Container wiring ΓÇö Dependency injection of adapters into domain services
3. Game polling loop ΓÇö Subscription management, poll intervals, event detection (score changes, quarter transitions, lead changes, big runs)
4. Message composition and routing ΓÇö Format domain events as chat messages, handle MarkdownV2 for formatted commands
5. CI/CD infrastructure ΓÇö Fix broken vitest CI; add Docker build + ACR push + Container App deploy CD workflow; Azure resource provisioning

**Current Status (as of 2026-03-13):**
- Fantasy roster tracking **COMPLETE** (8 files, 81 tests passing, PBP polling + roster matching)
- `/trackall` command **APPROVED** (tracks all today's games in one message; non-blocking follow-up: add tests)
- **Azure deployment plan ready** — Milan has provided comprehensive recommendation (Container Apps + ACR + Azure Files). Awaiting Filip's approval.
  - **Action items for Strahinja:** Dockerfile optimization (move build tools to builder) + GitHub Actions CI/CD workflow (~1 week)
  - **Key constraint:** SQLite requires single replica; Azure Files SMB mount handles persistence
  - **Cost estimate:** ~$15/month
- Live tracked-player notifications **NEXT PRIORITY** (Phase 1: expand NOTABLE_EVENT_TYPES + wire PBP through ThrottleManager ΓÇö 1ΓÇô2 days)

**Key Implemented Features:**
- Fantasy roster tracking (RosterTracker, PBP polling, roster match formatting)
- `/trackall` command (batch subscribe to today's games)
- `/roster` command (show current roster overview)
- Dunkest roster API endpoint switch (from /roster to /preview for non-authenticated access)

**Pending Phase 1 (Live Tracked-Player Notifications):**
1. Expand `NOTABLE_EVENT_TYPES` in `roster-tracker.ts` ΓÇö add two_pointer_missed, three_pointer_missed, free_throw_missed, turnover (remove any non-notable events)
2. Wire PBP messages through `ThrottleManager` ΓÇö assign priority (made shots/assists/steals/blocks = normal, misses = low)
3. Add PBP event type to `composeRosterMatch()` ΓÇö show what happened (e.g., "2pt Miss" vs "2pt Make")
4. Unit tests for expanded event matching + throttle integration

**Pending Phase 2 (Polish):**
- `PlayerEventBatcher` service ΓÇö collect events per chat, flush every 20ΓÇô30s as digest
- `/trackconfig` command ΓÇö toggle event classes per chat (scoring, playmaking, defensive, negative)
- Event class persistence ΓÇö new SQLite column or table

## Learnings

### Architecture Review Findings (2026-03-01)
- **`OutgoingMessage.parseMode` is Telegram-specific** ΓÇö Domain type at `src/domain/types.ts:174` uses `'MarkdownV2' | 'HTML'` which are Telegram constants. When adding a new chat platform, this will need to be generalized.
- **`SchedulerPort` is orphaned** ΓÇö Exists and is implemented (`NodeCronAdapter`) but never wired in `container.ts`. `GameTracker` uses raw `setInterval` instead. Consider if this should be refactored to use the port or if the port/adapter should be deleted.
- **Platform-specific concerns leaking into domain** ΓÇö As a future stats/scheduler adapter implementer, be aware that domain types may contain platform-specific values. Flag these for extraction during refactoring.

### DevOps & CI/CD Tasks (2026-03-01)
**Assigned by:** Bogdan (Lead)

Bogdan evaluated hiring a DevOps engineer and **recommended against it**. Instead, task you with:

1. **Fix CI workflow** (`squad-ci.yml`) ΓÇö Currently broken: runs `node --test test/*.test.js` but project uses **vitest**. Replace with `npm ci && npm run lint && npm test`
2. **Add CD workflow** (`deploy.yml`) ΓÇö Build Docker image ΓåÆ push to ACR ΓåÆ run `az containerapp update` on push to `main`
3. **One-time Azure setup** ΓÇö Provision Container App Environment, ACR, and Azure Files share for `/app/data` (SQLite persistence). Document or script with Bicep.
4. **Secrets management** ΓÇö Wire `TELEGRAM_BOT_TOKEN` + `AZURE_CREDENTIALS` in GitHub Actions secrets; remaining env vars in Container App config

**Rationale:** Single-container bot + Azure Container Apps is standard managed ops. This is ~1 week of bounded work, not an ongoing DevOps role.

### Fantasy Roster Tracking Implementation (2025-07-18)
- **PBP API uses a separate base URL** ΓÇö `https://live.euroleague.net/api` is hardcoded as `PBP_API_BASE` in `euroleague.adapter.ts`. This is a different service than the v2 API at `api-live.euroleague.net`.
- **RosterTracker follows TriviaService pattern** ΓÇö Uses `readFileSync` for loading `data/rosters.json`. Same architectural violation as TriviaService (domain importing fs), accepted as pragmatic for v1.
- **GameTracker.onPlayByPlay is optional** ΓÇö Added as 6th constructor param to avoid breaking existing tests. Container wires it with roster-matching logic.
- **PLAYTYPE mapping** ΓÇö Full mapping from EuroLeague PBP `PLAYTYPE` codes to `PlayByPlayEventType` in `PLAY_TYPE_MAP` constant. Note: the API uses `ForthQuarter` (typo is theirs).
- **Key files:** `src/domain/roster-tracker.ts`, `src/adapters/euroleague/euroleague.adapter.ts`, `data/rosters.json`
- **Fantasy roster types** added to `src/domain/types.ts`: `FantasyRoster`, `RosteredPlayer`, `RosterRound`

### Fantasy Roster Tracking ΓÇö Full Implementation (2026-03-01)
- **Status:** COMPLETE. 8 files modified, 81 tests passing, build passes.
- **PBP API implementation:** `EuroLeagueAdapter.getPlayByPlay()` now functional, pulling from `https://live.euroleague.net/api`.
- **RosterTracker service:** Loads `data/rosters.json`, builds lookup index, normalizes player names (case-insensitive via lowercase+trim), exports `matchEvent()` for fast roster matching.
- **GameTracker extension:** Added optional `onPlayByPlay` callback (6th constructor param). Polls PBP events in `pollGame()` and invokes callback with filtered results.
- **Event filtering:** Only notable events trigger notifications ΓÇö made shots (2pt/3pt/FT), assists, steals, blocks. Eliminates spam from rebounds, fouls, subs, timeouts.
- **MessageComposer:** New `composeRosterMatch(event, owners)` method. Formats roster notifications with player name + event + owner list.
- **CommandRouter:** New `/roster` command shows current roster overview.
- **Container wiring:** RosterTracker instantiated at startup; logs warning if `data/rosters.json` missing. PBP callback injected into GameTracker. For each PBP event, if roster owners found, send formatted message to chat.
- **Key decisions finalized:** PBP base URL hardcoded (separate API); readFileSync accepted (matches TriviaService); callback optional for backward compat; event filtering reduces notification noise.
- **Files:** euroleague.adapter.ts (PBP), types.ts (roster types), roster-tracker.ts (new service), game-tracker.ts (PBP polling), message-composer.ts (formatting), command-router.ts (/roster), container.ts (wiring), rosters.json (sample data).
- **Test coverage:** All 81 tests green. No existing tests modified.


### EuroLeague Fantasy (Dunkest/Fantaking) API Research (2026-03-05)

**Task:** Investigate the EuroLeague Fantasy API to find a roster/team endpoint.

**Platform Architecture:**
- EuroLeague Fantasy is a **Flutter web app** (compiled Dart) by Fantaking/Dunkest
- Frontend: `euroleaguefantasy.euroleaguebasketball.net` (serves Flutter SPA ΓÇö all routes return same HTML)
- API backend: `fantaking-api.dunkest.com/api/v1` (same as our existing `DUNKEST_API_BASE` config)
- Stats scraping: `www.dunkest.com/api/stats/table` (separate, no auth needed)

**Key IDs discovered:**
- Game ID: 7 (EuroLeague Fantasy Challenge ΓÇö covers EuroLeague league_id=10 and EuroCup league_id=11)
- League ID: 10 (EuroLeague)
- Current competition/schedule/players_list ID: 30
- Current matchday: id=992, number=30
- Filip's fantasy team ID from URL: 1562600

**THE ROSTER ENDPOINT:**
- `GET /api/v1/fantasy-teams/{teamId}/matchdays/{matchdayId}/roster` ΓÇö requires Bearer token
- `PUT` variant exists for updating rosters
- Matchday ID obtainable dynamically from public `/leagues/10/config`

**Other authenticated endpoints:**
- `/user/fantasy-teams` ΓÇö current user's teams
- `/users/{userId}/fantasy-teams/overview` ΓÇö user overview
- `/fantasy-leagues/{leagueId}/rosters` ΓÇö all rosters in a private league (batch!)
- `/fantasy-leagues/{leagueId}/fantasy-teams` ΓÇö all teams in a league
- `/players-lists/{listId}/matchdays/{matchdayId}/players` ΓÇö available players

**Public endpoints (no auth):**
- `/leagues/{leagueId}/config` ΓÇö league config, teams, matchdays, formations
- `/leagues/{leagueId}/fantasy-leaders` ΓÇö fantasy point leaders
- `/schedules/{scheduleId}/matchdays/{matchdayId}` ΓÇö match schedule

**Auth:** Social login via `POST /social/login` (provider_id, provider_name, provider_token, email, game_id). Returns bearer token.

**Roster composition (Classic):** 11 players (5 starters, 5 bench, 1 coach). 4G/4F/2C/1HC. Captain 2x.

**Blocker:** Need Filip's bearer token and team IDs to proceed with implementation.

### API Roster Fetching Implementation (2025-07-18)
- **Status:** COMPLETE. 6 files modified, 100 tests passing, build passes.
- **Config:** Added `DUNKEST_FANTASY_TEAM_IDS` env var (comma-separated) ΓåÆ `config.dunkest.fantasyTeamIds` array.
- **FantasyPort:** Added `getRosters(teamIds: string[]): Promise<FantasyRoster[]>` method.
- **DunkestAdapter.getRosters():** Fetches current matchday from public `/leagues/10/config`, then per-team roster from `/fantasy-teams/{id}/matchdays/{matchdayId}/roster`. Fully defensive parsing ΓÇö tries multiple response shapes since API format is unverified. Has `fetchJsonPublic` (no auth) and existing `fetchJson` (bearer auth).
- **RosterTracker:** Added `loadRosters(rosters)` method for API-sourced data. Made `normalizeName` public static. Extracted `buildIndex()` to share between file and API loading paths.
- **Container wiring:** Async `createContainer`. Prefers API when bearerToken + fantasyTeamIds configured, falls back to `data/rosters.json` on failure or empty response.
- **Key files:** config.ts, fantasy.port.ts, dunkest.adapter.ts, roster-tracker.ts, container.ts, index.ts
- **No breaking changes:** All existing tests pass unchanged (only mock update for new port method).

### Dunkest API Deep Investigation & Roster Display Overhaul (2026-03-05)

**Task:** Full investigation of 6 Dunkest API endpoints + fix Round 0 bug + improve /roster Telegram output.

**API Findings (6 endpoints curled):**

1. **`/leagues/10/config`** (public, no auth) ΓÇö Returns `current_matchday: { id: 992, number: 30, num_rounds: 2 }`, `current_round: { id: 1684, number: 1 }`, full team list with logos.
2. **`/user`** (auth) ΓÇö Returns user profile: id=476181, Filip Tanic, email, country (Serbia).
3. **`/games/7/config`** (auth) ΓÇö Game config with leagues, positions (Guard/Forward/Center/Head Coach), formations, tournament types.
4. **`/user/fantasy-teams?league=10&game_mode=1`** (auth) ΓÇö User's fantasy teams: `[{ id: 1562600, name: "svinjare" }, { id: 1742696, name: "svinjare 2" }]` with pts, position, matchday info.
5. **`/fantasy-teams/1562600/matchdays/992`** (auth) ΓÇö Team details for matchday: name, credits, pts, trades, wildcards.
6. **`/fantasy-teams/1562600/matchdays/992/roster`** (auth) ΓÇö Full roster with rich player data: position, opponent, court_position (1-5 starters, 6-10 bench, 11 coach), is_captain, is_on_fire, round info.

**Bugs Fixed:**

1. **Round 0 bug** ΓÇö `getRosters()` returned `FantasyRoster[]` without matchday context; `loadRosters()` hardcoded roundNumber=0. Now `getRosters()` returns `RosterFetchResult { matchdayNumber, rosters }` and passes matchday number from `/leagues/10/config`.
2. **"Team 1562600" display** ΓÇö Adapter now fetches team names from `/user/fantasy-teams?league=10&game_mode=1` and uses real names (e.g. "svinjare").

**Improvements:**

- `RosteredPlayer` type extended with: `position`, `isCaptain`, `isOnFire`, `opponentCode`, `courtPosition`
- `RosterFetchResult` type added to `types.ts`
- `FantasyPort.getRosters` return type changed from `FantasyRoster[]` to `RosterFetchResult`
- `DunkestAdapter`: new `fetchTeamNames()` method, `fetchCurrentMatchday()` returns both id and number
- `RosterTracker.getOverview()` rewritten: shows Starting Five / Bench / Coach sections, position tags (G/F/C/HC), captain ┬⌐, fire ≡ƒöÑ, opponent matchups
- `RosterTracker` stores `rosterData` for display (preserves original casing), separate from `playerIndex` (lowercase for matching)
- `formatDisplayName()` converts "LASTNAME, FIRSTNAME" ΓåÆ "F. Lastname" for cleaner display

**Files Changed (6):**
- `src/domain/types.ts` ΓÇö Extended RosteredPlayer, added RosterFetchResult
- `src/ports/fantasy.port.ts` ΓÇö Updated getRosters return type
- `src/adapters/dunkest/dunkest.adapter.ts` ΓÇö Team names, matchday number, rich player parsing
- `src/domain/roster-tracker.ts` ΓÇö Rich display with starters/bench/coach, position tags
- `src/container.ts` ΓÇö Handle new RosterFetchResult return type
- `tests/unit/roster-tracker.test.ts` + `tests/unit/fantasy-tracker.test.ts` ΓÇö Updated assertions

**Test Results:** 100 tests passing, build clean.

### /games Command ΓÇö Round Schedule & Results (2026-07-18)
- **Task:** Repurpose `/games` from showing tracked games to showing all games from the current EuroLeague round.
- **API Discovery:** EuroLeague v2 API has `/competitions/E/seasons/E2025/rounds` endpoint returning all rounds with `minGameStartDate`/`maxGameStartDate` date ranges. Games already have `round` field ΓÇö filtered from the existing all-games cache.
- **Round Detection Logic:** Find round whose date range contains today. Between rounds: pick whichever is nearer (next upcoming vs most recent past) by day count.
- **Serbian Time:** Used `Intl.DateTimeFormat` with `timeZone: 'Europe/Belgrade'` for CET/CEST display ΓÇö no external library needed.
- **Output Format:** Games grouped by date within the round. Finished games: Γ£à with final score + winner. Upcoming: ΓÅ│ with kickoff time. Header shows round name.
- **New types:** `RoundSchedule`, `RoundGame` in `types.ts`. New `StatsPort.getCurrentRoundGames()` method.
- **Files changed (7):** euroleague.adapter.ts, command-router.ts, message-composer.ts, types.ts, stats.port.ts, command-router.test.ts, game-tracker.test.ts
- **Test Results:** 100 tests passing, build clean.

### MarkdownV2 Formatting Implementation (2025-07-18)
- **Task:** Convert bot output from plain text to Telegram MarkdownV2 for prettier messages.
- **New utility:** `src/shared/markdown-v2.ts` ΓÇö `escapeMarkdownV2(text)` escapes all 20 MarkdownV2 special characters (`_*[]()~\`>#+\-=|{}.!`). Helpers: `bold()`, `italic()`, `underline()`, `strikethrough()`, `inlineCode()`, `link()` ΓÇö each wraps text with formatting markers and escapes inner text.
- **MessageComposer updates:** `composeRoundGames()` uses bold team names and escaped scores/dates. `composeHelp()` uses bold command names. `composeRosterMatch()` uses bold player names and escapes descriptions/owners.
- **RosterTracker updates:** `getOverview()` uses bold for section headers, owner names, and player names. Added `formatPlayerLineMd()` alongside existing `formatPlayerLine()`.
- **parseMode wiring:** `CommandRouter` sets `parseMode: 'MarkdownV2'` on `help`, `start`, `games`, `roster` commands via `MARKDOWN_COMMANDS` set. `container.ts` roster match callback also sets `parseMode: 'MarkdownV2'`.
- **Emoji handling:** Emoji characters pass through unescaped (not in the special chars set).
- **Key design decision:** Only the four specified output methods use MarkdownV2. Live game events (`compose()`) remain plain text to avoid risk during live games ΓÇö can be converted later.
- **Files changed (4 modified, 1 created):** `src/shared/markdown-v2.ts` (new), `src/domain/message-composer.ts`, `src/domain/roster-tracker.ts`, `src/domain/command-router.ts`, `src/container.ts`.
- **Test Results:** 100 tests passing, build clean. No test modifications needed ΓÇö existing `toContain` assertions flexible enough for the formatting changes.

### Arena Sport TV Schedule Integration (2026-07-18)
- **Task:** Add TV channel info to `/games` output by scraping tvarenasport.com/tv-scheme.
- **Architecture:** Full hexagonal pattern ΓÇö new `TvSchedulePort` interface, `ArenaSportAdapter` implementation, wired via `CommandRouter` dependency injection.
- **Port:** `src/ports/tv-schedule.port.ts` ΓÇö `TvSchedulePort` with `getEuroLeagueSchedule()` returning `TvScheduleEntry[]` (channelName, channelShort, date, time, title, isLive).
- **Adapter:** `src/adapters/tv-schedule/arena-sport.adapter.ts` ΓÇö Fetches `tvarenasport.com/tv-scheme` with browser-like UA. Two parsing strategies: (1) extract `window.TV_SCHEMES` JSON variable, (2) regex-based HTML parsing fallback. Filters for EuroLeague by keywords ("evroliga", "euroleague") and known team name fragments. 1-hour cache with stale fallback on errors.
- **Channel mapping:** Maps "Arena Premium 1" ΓåÆ "ASP1", "Arena Sport 1" ΓåÆ "AS1", etc. via `CHANNEL_SHORT_MAP` lookup.
- **Team matching:** Fuzzy matching in `CommandRouter.matchTvEntry()` ΓÇö compares TV title against game's shortName, full name, and team code (all lowercase). Date matching when both dates available.
- **Graceful degradation:** TV enrichment wrapped in try/catch ΓÇö if Arena Sport page fails, games display normally without TV info. Adapter is completely optional.
- **Output:** Upcoming games with matched TV channel show `≡ƒô║ ASP1` after the time, e.g. `ΓÅ│ *Madrid* vs *Olympiacos*\n      ≡ƒòÉ 20:00 ┬╖ ≡ƒô║ ASP1`
- **`RoundGame` type extended** with optional `tvChannel?: string` field.
- **No new dependencies** ΓÇö uses regex/string parsing only, no HTML parsing library.
- **Files created (3):** `src/ports/tv-schedule.port.ts`, `src/adapters/tv-schedule/arena-sport.adapter.ts`, `tests/unit/arena-sport-adapter.test.ts`
- **Files modified (4):** `src/domain/types.ts` (tvChannel field), `src/domain/command-router.ts` (enrichWithTvInfo + matchTvEntry), `src/domain/message-composer.ts` (TV tag in formatGameLine), `src/container.ts` (ArenaSportAdapter wiring)
- **Test Results:** 175 tests passing (14 new), build clean.

### RotoWire EuroLeague News Integration (2026-07-18)
- **Task:** Full RotoWire integration ΓÇö scraper adapter, /rotowire command, proactive injury alerts.

### Roster Matching Robustness Fix (2026-07-18)
- **Bug:** During PRS vs ASV game, Nadir Hifi's PBP events triggered zero roster match notifications. Root cause: startup Dunkest API fetch silently failed, `rosterTracker.isLoaded()` stayed false, and `onPlayByPlay` callback silently returned without matching any events.
- **Fix 1 ΓÇö Lazy roster loading:** Added `tryLazyRosterLoad()` in container.ts. When `onPlayByPlay` fires and rosters aren't loaded, it attempts a Dunkest API fetch with 5-minute cooldown to avoid hammering. State tracked via `lastRosterLoadAttempt` timestamp.
- **Fix 2 ΓÇö RosterTracker diagnostics:** Added `lastLoadedAt` timestamp, `needsReload()` (stale after 1 hour), `getStats()` returning `RosterStats` with player count, team count, indexed names. Exported `RosterStats` interface.
- **Fix 3 ΓÇö Logging:** `onPlayByPlay` now logs WARN when skipping due to unloaded rosters. Logs lazy-load attempts and results. Logs DEBUG on each PBP roster match.
- **Fix 4 ΓÇö `/rostercheck` command:** Shows loaded status, player count, team count, matchday, last loaded timestamp, and all indexed player names. Added to `MARKDOWN_COMMANDS` set for MarkdownV2 output. `MessageComposer.composeRosterStatus()` formats the diagnostics view.
- **Architecture:** Lazy loading stays in container.ts (wiring layer) which CAN access adapters directly ΓÇö no hexagonal violations. `RosterStats` type exported from domain, consumed by `MessageComposer` ΓÇö pure domain-to-domain dependency.
- **Files modified (4):** `src/domain/roster-tracker.ts` (stats/diagnostics), `src/container.ts` (lazy loading + logging), `src/domain/command-router.ts` (/rostercheck), `src/domain/message-composer.ts` (composeRosterStatus + help text)
- **Test Results:** 223 unit tests passing, build clean. 16 pre-existing SQLite integration test failures (native module issue).
- **Architecture:** Full hexagonal pattern ΓÇö new `NewsPort` interface, `RotoWireAdapter` implementation, `InjuryMonitor` domain service, wired via `CommandRouter` and `container.ts`.
- **Port:** `src/ports/news.port.ts` ΓÇö `NewsPort` with `getLatestNews()` and `getInjuryNews()` returning `NewsEntry[]`.
- **Adapter:** `src/adapters/rotowire/rotowire.adapter.ts` ΓÇö Fetches `rotowire.com/euro/news.php` with browser-like UA. Regex-based HTML parsing extracts player name, headline, timestamp, position, injury type, and news text. 1-hour cache (same pattern as ArenaSportAdapter). Graceful degradation ΓÇö returns stale cache or [] on failure.
- **InjuryMonitor:** `src/domain/injury-monitor.ts` ΓÇö Polls injury news every 30 min. Tracks seen injuries via `Set<string>` keyed by `${playerName}-${headline}`. New injuries formatted via `composeNews()` and sent to all allowed chat IDs. Start/stop lifecycle methods.
- **CommandRouter:** `/rotowire` (no args) shows latest 10 news items; `/rotowire injuries` shows injury-only news. Both use MarkdownV2 formatting.
- **MessageComposer:** New `composeNews(entries, title)` method. Uses ≡ƒÅÑ for injuries, ≡ƒô░ for general news. Truncates news text to ~100 chars. Max 10 entries. MarkdownV2 with bold player names, italic dates/injury types.
- **Container wiring:** RotoWireAdapter instantiated unconditionally. InjuryMonitor started if `allowedChatIds` configured. Monitor stopped on graceful shutdown.
- **Help updated:** `/rotowire` added to composeHelp() output.
- **No new dependencies** ΓÇö uses regex/string parsing only, no HTML parsing library.
- **Files created (3):** `src/ports/news.port.ts`, `src/adapters/rotowire/rotowire.adapter.ts`, `src/domain/injury-monitor.ts`
- **Files modified (4):** `src/domain/command-router.ts` (NewsPort dep + /rotowire handler), `src/domain/message-composer.ts` (composeNews + /rotowire in help), `src/container.ts` (RotoWireAdapter + InjuryMonitor wiring), `src/index.ts` (shutdown hook)
- **Test Results:** 174 tests passing (1 pre-existing failure in roster-tracker.test.ts unrelated to this work), build clean.

### Smart Dynamic Polling for InjuryMonitor (2025-07-18)
- **Status:** COMPLETE. 2 files modified, 1 test file updated, 214 tests passing, build clean.
- **Problem:** InjuryMonitor polled at fixed 30-min intervals regardless of game schedule proximity.
- **Solution:** Replaced `setInterval` with self-rescheduling `setTimeout` pattern. After each poll, `calculateNextInterval()` determines the next delay based on game proximity in Belgrade timezone.
- **Polling rules:** Γëñ2h before any game ΓåÆ 5min (critical); game day but >2h ΓåÆ 30min; no games today ΓåÆ 12h (idle).
- **Game schedule access:** `InjuryMonitor` now accepts optional `GetRoundGames` function (returns `RoundGame[]`). Falls back to 30min if not provided or fetch fails.
- **Timezone handling:** `toBelgradeDateString()` uses `Intl.DateTimeFormat` via `toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' })` ΓÇö "today" is defined in Belgrade timezone.
- **Interval window:** Games within ┬▒2 hours trigger critical mode (covers both pre-game and in-progress scenarios).
- **Logging:** Each reschedule logs `{ intervalMs, mode }` where mode is `'5min-critical' | '30min-gameday' | '12h-idle'`.
- **Constructor change:** `pollIntervalMs` param removed, replaced with optional `getRoundGames` and `nowFn` (for testability). Existing callers without these args still work (backward compatible).
- **Container wiring:** `stats.getCurrentRoundGames()` wrapped in a closure and passed to InjuryMonitor.
- **Tests:** 7 new tests covering all interval modes, multi-game rounds, finished games, timezone edge cases.
- **Files modified:** `src/domain/injury-monitor.ts`, `src/container.ts`, `tests/unit/injury-monitor.test.ts`
- **Exports added:** `PollingMode` type, `GetRoundGames` type (for external use/testing).

### Low-Latency Polling Strategy (2026-03-13)
- **Backend developer role in cross-agent orchestration.** Mapped Bogdan's architectural recommendations to exact code changes.
- **Implementation plan finalized:** 6 files + config updates required. Parallel polling architecture designed.
- **Connection strategy:** Create two explicit `undici.Agent` instances (v2 API + PBP API) with `keepAliveTimeout: 60_000`. Pass as `dispatcher` option to all `fetch()` calls.
- **Warm-up method:** New `EuroLeagueAdapter.warmUpConnections()` fires lightweight HEAD/GET to both endpoints before first real poll. Establishes TLS sessions upfront.
- **Polling architecture:** Keep one `setInterval` loop per game, but parallelize `Promise.allSettled([getLiveScore, getPlayByPlay])` inside `pollGame()`. Prevents race conditions and state coherence issues that two separate loops would create.
- **Config additions:** 3 new env vars (`EUROLEAGUE_POLL_INTERVAL_MS`, `EUROLEAGUE_FETCH_TIMEOUT_MS`, `EUROLEAGUE_KEEPALIVE_TIMEOUT_MS`). Defaults tuned: poll 10s (was 15s), throttle window 60s (was 120s), max messages 10/min (was 5).
- **Files to modify:** euroleague.adapter.ts (agents + warm-up), game-tracker.ts (parallel fetch), config.ts (new keys + validation), container.ts (agent injection + cleanup), ports/stats.port.ts (optional warmUp method).
- **Rollout checklist:** 4 phases ΓÇö Connection Foundation (undici Agent setup), Parallel Polling, Config Tuning, Monitoring & Validation.
- **Risk assessment:** Cloudflare 429s (monitor, tunable), undici memory leak (call close() on shutdown), parallel masking errors (Promise.allSettled handles), Telegram limits (throttle manager already tuned), connection exhaustion (pool size 4 per origin is sufficient).
- **Full implementation plan:** Merged from inbox to `.squad/decisions.md` under "Low-Latency Polling Strategy ΓÇö Bogdan & Strahinja (2026-03-13)".

### /roster Live Fetch Fix (2025-07-18)
- **Task:** `/roster` command was showing stale startup-cached data. Made it always fetch live from Dunkest API.
- **Root cause:** Rosters fetched once in `container.ts` at boot, stored in `RosterTracker`. `/roster` handler just read cached state.
- **Fix:** Added `FantasyPort` and `fantasyTeamIds` to `CommandRouterDeps`. `/roster` handler now calls `fantasyPort.getRosters(fantasyTeamIds)` to get fresh data, loads it into `rosterTracker`, then returns the overview. Falls back to cached data if live fetch fails.
- **Dead code removed:** `loadFromFile`, `loadFromFileAndMerge`, `mergeRosters` methods and `import { readFileSync } from 'node:fs'` from `roster-tracker.ts` ΓÇö none were called anywhere.
- **Startup pre-load preserved:** Container still pre-loads rosters at boot for the `onRosterEvent` PBP callback in `GameTracker`.
- **Container wiring:** Reused the existing `DunkestAdapter` instance (created for `fantasyTracker`) and passed it + `config.dunkest.fantasyTeamIds` into CommandRouter deps.
- **Tests updated:** Removed `loadFromFile` test suite (3 tests), updated remaining tests to use `loadRosters()` directly. All 209 unit tests pass, build clean.
- **Files changed (4):** `src/domain/command-router.ts`, `src/container.ts`, `src/domain/roster-tracker.ts`, `tests/unit/roster-tracker.test.ts`

### PBP Raw Payload Reference Captured (2026-03-13)
- **Agent:** Nikola (Data / Integrations)
- **Outcome:** Full raw play-by-play JSON from EuroLeague API saved for schema reference and fixture data.
- **Game:** Panathinaikos AKTOR Athens vs Zalgiris Kaunas (game_code 305, season_code E2025)
- **Endpoint:** `https://live.euroleague.net/api/PlaybyPlay?gamecode=305&seasoncode=E2025`
- **Key finding:** PBP data persists post-game (not live-only). API uses `ForthQuarter` (typo ΓÇö must be respected in parsing code).
- **Files available:** `pao-zalgiris-pbp-raw-opus.json` (157 KB minified), `pao-zalgiris-pbp-pretty-opus.json` (237 KB formatted)
- **Artifact location:** Session workspace `0a0abdd4-0bc4-4c5a-9ff8-d446e3c86601/files/`
- **Next steps:** When debugging PBP event parsing or field mappings in `GameTracker` and `RosterTracker`, reference these raw samples for schema validation.

### Low-Latency Polling ΓÇö Implementation Plan (2026-07-18)

**Task:** Plan 10s-or-less tracked-player updates with connection reuse / keep-alive.

**Current Architecture Bottlenecks Identified:**
1. `pollGame()` in `game-tracker.ts:123-171` makes **two sequential HTTP calls** per tick: `getLiveScore()` ΓåÆ `getPlayByPlay()`. At ~1-2s each (TLS handshake + round-trip), this burns 2-4s of every 15s window.
2. `EuroLeagueAdapter` calls two **different API hosts**: `api-live.euroleague.net` (v2 scores) and `live.euroleague.net/api` (PBP). Each host requires its own TCP+TLS connection.
3. No connection reuse ΓÇö each `fetch()` call creates a fresh connection despite Node 22's undici-based fetch having keep-alive on the global dispatcher. The issue is that idle connections expire between poll cycles at 15s intervals, causing "cold" TLS handshakes.
4. Config minimum is 5000ms but default is 15000ms. `AbortSignal.timeout(10000)` is aggressive relative to poll interval ΓÇö a 10s timeout with 10s interval means zero margin.

**Plan:**
- **Step 1:** Add `undici` as explicit dep ΓåÆ create two `Agent` instances (v2 host + PBP host) with `keepAliveTimeout: 60_000` and `connections: 4`. Pass as `dispatcher` to `fetch()`.
- **Step 2:** Parallelize `getLiveScore` + `getPlayByPlay` in `pollGame()` via `Promise.allSettled`. Cuts per-tick time from ~3s to ~1.5s.
- **Step 3:** Add `warmUpConnections()` method to `EuroLeagueAdapter` ΓÇö fires one lightweight request to each host when `startPolling()` is called, priming the TLS sessions.
- **Step 4:** Split `pollIntervalMs` into `scorePollIntervalMs` (10s default) and `pbpPollIntervalMs` (10s default, same loop but can be skipped on alternating ticks).
- **Step 5:** Tune config defaults and throttle windows for faster delivery.
- **Step 6:** Adjust `AbortSignal.timeout` to be proportional to poll interval (e.g., `min(pollInterval * 0.8, 8000)`).

**Key Decision: One loop, not two.** Score + PBP should fire in parallel within the same tick. Two independent loops create event ordering drift and duplicate state tracking complexity.

**Key Decision: `undici` as explicit dep.** Node 22's global dispatcher has keep-alive, but we need custom `Agent` with tuned `keepAliveTimeout` (60s vs default 4s) to survive between 10s poll cycles without cold handshakes. `undici` is already the engine under Node's fetch ΓÇö zero runtime cost.

See decision doc: `.squad/decisions/inbox/strahinja-low-latency-rollout.md`

### Live Tracked-Player Architecture & PBP Poll Recommendations Merged (2026-03-13T07:43:31Z via Scribe)
- **Architecture decision captured:** .squad/decisions.md ΓåÆ "Live Tracked-Player Notifications ΓÇö Architecture Recommendation ΓÇö Bogdan (2026-07-18)"
- **Build order:** Phase 1 (expand NOTABLE_EVENT_TYPES + wire throttle) immediate; Phase 2 (batching) deferred; Phase 3 (per-player subs) only if demand
- **Latency strategy merged:** Nikola's "Near-Instant Tracked-Player Notifications ΓÇö Data Strategy" also captured in decisions.md
- **Sync-up needed:** Bogdan + Nikola + Strahinja alignment on Phase 1 scope before implementation

### Code Review Approved & Merged (2026-03-13T07:43:31Z via Scribe)
- **Verdict:** All uncommitted src/ changes approved by Bogdan (2026-07-18)
- **Changes:** Dunkest endpoint fix + container simplification + /trackall command + help text update
- **Follow-up items:** Dead code cleanup in roster-tracker.ts + tests for /trackall (non-blocking)

### Azure Deployment Infrastructure Ready (2026-03-14 via Scribe)
- **Milan delivered:** Optimized Dockerfile (~150MB, was 350MB), `.github/workflows/deploy.yml` (test → deploy), `scripts/azure-setup.sh` (idempotent provisioning)
- **Architecture:** Azure Container Apps (Consumption) + ACR Basic + Azure Files for SQLite persistence (~$15/mo)
- **Key constraint:** Single replica (maxReplicas: 1) due to SQLite non-concurrent writer limitation
- **Env vars mapping:** All 13 config vars from `src/config.ts` mapped in Container App definition
- **Secrets:** TELEGRAM_BOT_TOKEN + DUNKEST_BEARER_TOKEN use `secretref:` (never plain text)
- **Health probes:** Liveness + startup on `/health:8080` — validates existing health check endpoint
- **CI/CD blocker:** `squad-ci.yml` still runs `node --test` but project uses vitest; needs vitest fix before deploy workflow can succeed
- **Next for Strahinja:** (1) Fix CI workflow, (2) Implement Low-Latency Polling Phase 1, (3) Run Azure setup script, (4) Push to main to trigger auto-deploy

### Player-Only Event Filter (2026-07-14)
**Requested by:** Filip Tanic

- **Change:** Replaced the `onEvent` callback in `container.ts` with a debug-log-only no-op. Game-level events (score changes, quarter transitions, lead changes, big runs, game start/end) are still detected by GameTracker for internal state tracking but are no longer sent to Telegram.
- **Untouched:** `onPlayByPlay` roster-match callback — this is the only path that posts to chat now (tracked fantasy player actions).
- **Rationale:** Filip wants the bot to be player-notification-only. The GameTracker's `detectEvents()` still runs because it maintains game lifecycle state (scheduled→live→finished), but the chat output is purely roster matches.
- **Impact:** Zero test breakage (233 unit tests pass). Build and lint clean. The `MessageComposer.compose()` method and game event types are retained as dead code — they can be cleaned up later if this direction is permanent.
