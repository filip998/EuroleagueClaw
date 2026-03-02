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

### DevOps & CI/CD Tasks (2026-03-01)
**Assigned by:** Bogdan (Lead)

Bogdan evaluated hiring a DevOps engineer and **recommended against it**. Instead, task you with:

1. **Fix CI workflow** (`squad-ci.yml`) — Currently broken: runs `node --test test/*.test.js` but project uses **vitest**. Replace with `npm ci && npm run lint && npm test`
2. **Add CD workflow** (`deploy.yml`) — Build Docker image → push to ACR → run `az containerapp update` on push to `main`
3. **One-time Azure setup** — Provision Container App Environment, ACR, and Azure Files share for `/app/data` (SQLite persistence). Document or script with Bicep.
4. **Secrets management** — Wire `TELEGRAM_BOT_TOKEN` + `AZURE_CREDENTIALS` in GitHub Actions secrets; remaining env vars in Container App config

**Rationale:** Single-container bot + Azure Container Apps is standard managed ops. This is ~1 week of bounded work, not an ongoing DevOps role.

### Fantasy Roster Tracking Implementation (2025-07-18)
- **PBP API uses a separate base URL** — `https://live.euroleague.net/api` is hardcoded as `PBP_API_BASE` in `euroleague.adapter.ts`. This is a different service than the v2 API at `api-live.euroleague.net`.
- **RosterTracker follows TriviaService pattern** — Uses `readFileSync` for loading `data/rosters.json`. Same architectural violation as TriviaService (domain importing fs), accepted as pragmatic for v1.
- **GameTracker.onPlayByPlay is optional** — Added as 6th constructor param to avoid breaking existing tests. Container wires it with roster-matching logic.
- **PLAYTYPE mapping** — Full mapping from EuroLeague PBP `PLAYTYPE` codes to `PlayByPlayEventType` in `PLAY_TYPE_MAP` constant. Note: the API uses `ForthQuarter` (typo is theirs).
- **Key files:** `src/domain/roster-tracker.ts`, `src/adapters/euroleague/euroleague.adapter.ts`, `data/rosters.json`
- **Fantasy roster types** added to `src/domain/types.ts`: `FantasyRoster`, `RosteredPlayer`, `RosterRound`

### Fantasy Roster Tracking — Full Implementation (2026-03-01)
- **Status:** COMPLETE. 8 files modified, 81 tests passing, build passes.
- **PBP API implementation:** `EuroLeagueAdapter.getPlayByPlay()` now functional, pulling from `https://live.euroleague.net/api`.
- **RosterTracker service:** Loads `data/rosters.json`, builds lookup index, normalizes player names (case-insensitive via lowercase+trim), exports `matchEvent()` for fast roster matching.
- **GameTracker extension:** Added optional `onPlayByPlay` callback (6th constructor param). Polls PBP events in `pollGame()` and invokes callback with filtered results.
- **Event filtering:** Only notable events trigger notifications — made shots (2pt/3pt/FT), assists, steals, blocks. Eliminates spam from rebounds, fouls, subs, timeouts.
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
- Frontend: `euroleaguefantasy.euroleaguebasketball.net` (serves Flutter SPA — all routes return same HTML)
- API backend: `fantaking-api.dunkest.com/api/v1` (same as our existing `DUNKEST_API_BASE` config)
- Stats scraping: `www.dunkest.com/api/stats/table` (separate, no auth needed)

**Key IDs discovered:**
- Game ID: 7 (EuroLeague Fantasy Challenge — covers EuroLeague league_id=10 and EuroCup league_id=11)
- League ID: 10 (EuroLeague)
- Current competition/schedule/players_list ID: 30
- Current matchday: id=992, number=30
- Filip's fantasy team ID from URL: 1562600

**THE ROSTER ENDPOINT:**
- `GET /api/v1/fantasy-teams/{teamId}/matchdays/{matchdayId}/roster` — requires Bearer token
- `PUT` variant exists for updating rosters
- Matchday ID obtainable dynamically from public `/leagues/10/config`

**Other authenticated endpoints:**
- `/user/fantasy-teams` — current user's teams
- `/users/{userId}/fantasy-teams/overview` — user overview
- `/fantasy-leagues/{leagueId}/rosters` — all rosters in a private league (batch!)
- `/fantasy-leagues/{leagueId}/fantasy-teams` — all teams in a league
- `/players-lists/{listId}/matchdays/{matchdayId}/players` — available players

**Public endpoints (no auth):**
- `/leagues/{leagueId}/config` — league config, teams, matchdays, formations
- `/leagues/{leagueId}/fantasy-leaders` — fantasy point leaders
- `/schedules/{scheduleId}/matchdays/{matchdayId}` — match schedule

**Auth:** Social login via `POST /social/login` (provider_id, provider_name, provider_token, email, game_id). Returns bearer token.

**Roster composition (Classic):** 11 players (5 starters, 5 bench, 1 coach). 4G/4F/2C/1HC. Captain 2x.

**Blocker:** Need Filip's bearer token and team IDs to proceed with implementation.

### API Roster Fetching Implementation (2025-07-18)
- **Status:** COMPLETE. 6 files modified, 100 tests passing, build passes.
- **Config:** Added `DUNKEST_FANTASY_TEAM_IDS` env var (comma-separated) → `config.dunkest.fantasyTeamIds` array.
- **FantasyPort:** Added `getRosters(teamIds: string[]): Promise<FantasyRoster[]>` method.
- **DunkestAdapter.getRosters():** Fetches current matchday from public `/leagues/10/config`, then per-team roster from `/fantasy-teams/{id}/matchdays/{matchdayId}/roster`. Fully defensive parsing — tries multiple response shapes since API format is unverified. Has `fetchJsonPublic` (no auth) and existing `fetchJson` (bearer auth).
- **RosterTracker:** Added `loadRosters(rosters)` method for API-sourced data. Made `normalizeName` public static. Extracted `buildIndex()` to share between file and API loading paths.
- **Container wiring:** Async `createContainer`. Prefers API when bearerToken + fantasyTeamIds configured, falls back to `data/rosters.json` on failure or empty response.
- **Key files:** config.ts, fantasy.port.ts, dunkest.adapter.ts, roster-tracker.ts, container.ts, index.ts
- **No breaking changes:** All existing tests pass unchanged (only mock update for new port method).

### Dunkest API Deep Investigation & Roster Display Overhaul (2026-03-05)

**Task:** Full investigation of 6 Dunkest API endpoints + fix Round 0 bug + improve /roster Telegram output.

**API Findings (6 endpoints curled):**

1. **`/leagues/10/config`** (public, no auth) — Returns `current_matchday: { id: 992, number: 30, num_rounds: 2 }`, `current_round: { id: 1684, number: 1 }`, full team list with logos.
2. **`/user`** (auth) — Returns user profile: id=476181, Filip Tanic, email, country (Serbia).
3. **`/games/7/config`** (auth) — Game config with leagues, positions (Guard/Forward/Center/Head Coach), formations, tournament types.
4. **`/user/fantasy-teams?league=10&game_mode=1`** (auth) — User's fantasy teams: `[{ id: 1562600, name: "svinjare" }, { id: 1742696, name: "svinjare 2" }]` with pts, position, matchday info.
5. **`/fantasy-teams/1562600/matchdays/992`** (auth) — Team details for matchday: name, credits, pts, trades, wildcards.
6. **`/fantasy-teams/1562600/matchdays/992/roster`** (auth) — Full roster with rich player data: position, opponent, court_position (1-5 starters, 6-10 bench, 11 coach), is_captain, is_on_fire, round info.

**Bugs Fixed:**

1. **Round 0 bug** — `getRosters()` returned `FantasyRoster[]` without matchday context; `loadRosters()` hardcoded roundNumber=0. Now `getRosters()` returns `RosterFetchResult { matchdayNumber, rosters }` and passes matchday number from `/leagues/10/config`.
2. **"Team 1562600" display** — Adapter now fetches team names from `/user/fantasy-teams?league=10&game_mode=1` and uses real names (e.g. "svinjare").

**Improvements:**

- `RosteredPlayer` type extended with: `position`, `isCaptain`, `isOnFire`, `opponentCode`, `courtPosition`
- `RosterFetchResult` type added to `types.ts`
- `FantasyPort.getRosters` return type changed from `FantasyRoster[]` to `RosterFetchResult`
- `DunkestAdapter`: new `fetchTeamNames()` method, `fetchCurrentMatchday()` returns both id and number
- `RosterTracker.getOverview()` rewritten: shows Starting Five / Bench / Coach sections, position tags (G/F/C/HC), captain ©, fire 🔥, opponent matchups
- `RosterTracker` stores `rosterData` for display (preserves original casing), separate from `playerIndex` (lowercase for matching)
- `formatDisplayName()` converts "LASTNAME, FIRSTNAME" → "F. Lastname" for cleaner display

**Files Changed (6):**
- `src/domain/types.ts` — Extended RosteredPlayer, added RosterFetchResult
- `src/ports/fantasy.port.ts` — Updated getRosters return type
- `src/adapters/dunkest/dunkest.adapter.ts` — Team names, matchday number, rich player parsing
- `src/domain/roster-tracker.ts` — Rich display with starters/bench/coach, position tags
- `src/container.ts` — Handle new RosterFetchResult return type
- `tests/unit/roster-tracker.test.ts` + `tests/unit/fantasy-tracker.test.ts` — Updated assertions

**Test Results:** 100 tests passing, build clean.

### /games Command — Round Schedule & Results (2026-07-18)
- **Task:** Repurpose `/games` from showing tracked games to showing all games from the current EuroLeague round.
- **API Discovery:** EuroLeague v2 API has `/competitions/E/seasons/E2025/rounds` endpoint returning all rounds with `minGameStartDate`/`maxGameStartDate` date ranges. Games already have `round` field — filtered from the existing all-games cache.
- **Round Detection Logic:** Find round whose date range contains today. Between rounds: pick whichever is nearer (next upcoming vs most recent past) by day count.
- **Serbian Time:** Used `Intl.DateTimeFormat` with `timeZone: 'Europe/Belgrade'` for CET/CEST display — no external library needed.
- **Output Format:** Games grouped by date within the round. Finished games: ✅ with final score + winner. Upcoming: ⏳ with kickoff time. Header shows round name.
- **New types:** `RoundSchedule`, `RoundGame` in `types.ts`. New `StatsPort.getCurrentRoundGames()` method.
- **Files changed (7):** euroleague.adapter.ts, command-router.ts, message-composer.ts, types.ts, stats.port.ts, command-router.test.ts, game-tracker.test.ts
- **Test Results:** 100 tests passing, build clean.

### MarkdownV2 Formatting Implementation (2025-07-18)
- **Task:** Convert bot output from plain text to Telegram MarkdownV2 for prettier messages.
- **New utility:** `src/shared/markdown-v2.ts` — `escapeMarkdownV2(text)` escapes all 20 MarkdownV2 special characters (`_*[]()~\`>#+\-=|{}.!`). Helpers: `bold()`, `italic()`, `underline()`, `strikethrough()`, `inlineCode()`, `link()` — each wraps text with formatting markers and escapes inner text.
- **MessageComposer updates:** `composeRoundGames()` uses bold team names and escaped scores/dates. `composeHelp()` uses bold command names. `composeRosterMatch()` uses bold player names and escapes descriptions/owners.
- **RosterTracker updates:** `getOverview()` uses bold for section headers, owner names, and player names. Added `formatPlayerLineMd()` alongside existing `formatPlayerLine()`.
- **parseMode wiring:** `CommandRouter` sets `parseMode: 'MarkdownV2'` on `help`, `start`, `games`, `roster` commands via `MARKDOWN_COMMANDS` set. `container.ts` roster match callback also sets `parseMode: 'MarkdownV2'`.
- **Emoji handling:** Emoji characters pass through unescaped (not in the special chars set).
- **Key design decision:** Only the four specified output methods use MarkdownV2. Live game events (`compose()`) remain plain text to avoid risk during live games — can be converted later.
- **Files changed (4 modified, 1 created):** `src/shared/markdown-v2.ts` (new), `src/domain/message-composer.ts`, `src/domain/roster-tracker.ts`, `src/domain/command-router.ts`, `src/container.ts`.
- **Test Results:** 100 tests passing, build clean. No test modifications needed — existing `toContain` assertions flexible enough for the formatting changes.

### Arena Sport TV Schedule Integration (2026-07-18)
- **Task:** Add TV channel info to `/games` output by scraping tvarenasport.com/tv-scheme.
- **Architecture:** Full hexagonal pattern — new `TvSchedulePort` interface, `ArenaSportAdapter` implementation, wired via `CommandRouter` dependency injection.
- **Port:** `src/ports/tv-schedule.port.ts` — `TvSchedulePort` with `getEuroLeagueSchedule()` returning `TvScheduleEntry[]` (channelName, channelShort, date, time, title, isLive).
- **Adapter:** `src/adapters/tv-schedule/arena-sport.adapter.ts` — Fetches `tvarenasport.com/tv-scheme` with browser-like UA. Two parsing strategies: (1) extract `window.TV_SCHEMES` JSON variable, (2) regex-based HTML parsing fallback. Filters for EuroLeague by keywords ("evroliga", "euroleague") and known team name fragments. 1-hour cache with stale fallback on errors.
- **Channel mapping:** Maps "Arena Premium 1" → "ASP1", "Arena Sport 1" → "AS1", etc. via `CHANNEL_SHORT_MAP` lookup.
- **Team matching:** Fuzzy matching in `CommandRouter.matchTvEntry()` — compares TV title against game's shortName, full name, and team code (all lowercase). Date matching when both dates available.
- **Graceful degradation:** TV enrichment wrapped in try/catch — if Arena Sport page fails, games display normally without TV info. Adapter is completely optional.
- **Output:** Upcoming games with matched TV channel show `📺 ASP1` after the time, e.g. `⏳ *Madrid* vs *Olympiacos*\n      🕐 20:00 · 📺 ASP1`
- **`RoundGame` type extended** with optional `tvChannel?: string` field.
- **No new dependencies** — uses regex/string parsing only, no HTML parsing library.
- **Files created (3):** `src/ports/tv-schedule.port.ts`, `src/adapters/tv-schedule/arena-sport.adapter.ts`, `tests/unit/arena-sport-adapter.test.ts`
- **Files modified (4):** `src/domain/types.ts` (tvChannel field), `src/domain/command-router.ts` (enrichWithTvInfo + matchTvEntry), `src/domain/message-composer.ts` (TV tag in formatGameLine), `src/container.ts` (ArenaSportAdapter wiring)
- **Test Results:** 175 tests passing (14 new), build clean.

### RotoWire EuroLeague News Integration (2026-07-18)
- **Task:** Full RotoWire integration — scraper adapter, /rotowire command, proactive injury alerts.
- **Architecture:** Full hexagonal pattern — new `NewsPort` interface, `RotoWireAdapter` implementation, `InjuryMonitor` domain service, wired via `CommandRouter` and `container.ts`.
- **Port:** `src/ports/news.port.ts` — `NewsPort` with `getLatestNews()` and `getInjuryNews()` returning `NewsEntry[]`.
- **Adapter:** `src/adapters/rotowire/rotowire.adapter.ts` — Fetches `rotowire.com/euro/news.php` with browser-like UA. Regex-based HTML parsing extracts player name, headline, timestamp, position, injury type, and news text. 1-hour cache (same pattern as ArenaSportAdapter). Graceful degradation — returns stale cache or [] on failure.
- **InjuryMonitor:** `src/domain/injury-monitor.ts` — Polls injury news every 30 min. Tracks seen injuries via `Set<string>` keyed by `${playerName}-${headline}`. New injuries formatted via `composeNews()` and sent to all allowed chat IDs. Start/stop lifecycle methods.
- **CommandRouter:** `/rotowire` (no args) shows latest 10 news items; `/rotowire injuries` shows injury-only news. Both use MarkdownV2 formatting.
- **MessageComposer:** New `composeNews(entries, title)` method. Uses 🏥 for injuries, 📰 for general news. Truncates news text to ~100 chars. Max 10 entries. MarkdownV2 with bold player names, italic dates/injury types.
- **Container wiring:** RotoWireAdapter instantiated unconditionally. InjuryMonitor started if `allowedChatIds` configured. Monitor stopped on graceful shutdown.
- **Help updated:** `/rotowire` added to composeHelp() output.
- **No new dependencies** — uses regex/string parsing only, no HTML parsing library.
- **Files created (3):** `src/ports/news.port.ts`, `src/adapters/rotowire/rotowire.adapter.ts`, `src/domain/injury-monitor.ts`
- **Files modified (4):** `src/domain/command-router.ts` (NewsPort dep + /rotowire handler), `src/domain/message-composer.ts` (composeNews + /rotowire in help), `src/container.ts` (RotoWireAdapter + InjuryMonitor wiring), `src/index.ts` (shutdown hook)
- **Test Results:** 174 tests passing (1 pre-existing failure in roster-tracker.test.ts unrelated to this work), build clean.

### Smart Dynamic Polling for InjuryMonitor (2025-07-18)
- **Status:** COMPLETE. 2 files modified, 1 test file updated, 214 tests passing, build clean.
- **Problem:** InjuryMonitor polled at fixed 30-min intervals regardless of game schedule proximity.
- **Solution:** Replaced `setInterval` with self-rescheduling `setTimeout` pattern. After each poll, `calculateNextInterval()` determines the next delay based on game proximity in Belgrade timezone.
- **Polling rules:** ≤2h before any game → 5min (critical); game day but >2h → 30min; no games today → 12h (idle).
- **Game schedule access:** `InjuryMonitor` now accepts optional `GetRoundGames` function (returns `RoundGame[]`). Falls back to 30min if not provided or fetch fails.
- **Timezone handling:** `toBelgradeDateString()` uses `Intl.DateTimeFormat` via `toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' })` — "today" is defined in Belgrade timezone.
- **Interval window:** Games within ±2 hours trigger critical mode (covers both pre-game and in-progress scenarios).
- **Logging:** Each reschedule logs `{ intervalMs, mode }` where mode is `'5min-critical' | '30min-gameday' | '12h-idle'`.
- **Constructor change:** `pollIntervalMs` param removed, replaced with optional `getRoundGames` and `nowFn` (for testability). Existing callers without these args still work (backward compatible).
- **Container wiring:** `stats.getCurrentRoundGames()` wrapped in a closure and passed to InjuryMonitor.
- **Tests:** 7 new tests covering all interval modes, multi-game rounds, finished games, timezone edge cases.
- **Files modified:** `src/domain/injury-monitor.ts`, `src/container.ts`, `tests/unit/injury-monitor.test.ts`
- **Exports added:** `PollingMode` type, `GetRoundGames` type (for external use/testing).
