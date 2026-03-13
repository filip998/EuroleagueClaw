# Decisions Archive

Old decisions from March 2026 and earlier.

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
| GitHub Actions CI | ⚠️ Broken | squad-ci.yml runs 
ode --test test/*.test.js — project uses **vitest**, not Node's built-in test runner |
| CD pipeline | ❌ Missing | No workflow to build image → push to ACR → deploy to Azure Container Apps |
| Infrastructure-as-Code | ❌ Missing | No Bicep/Terraform; README has manual z CLI instructions |
| Azure Files mount | ❌ Missing | Required for SQLite persistence, documented in README but not automated |

### Why Not Hire

1. **Single-container architecture.** One bot process, one SQLite file, one health endpoint. Azure Container Apps handles scaling, restarts, TLS, and health checks out of the box.

2. **The gap is one-time setup, not ongoing work.** What's missing is:
   - A CI workflow (~30 lines): lint + vitest
   - A CD workflow (~60 lines): docker build → ACR push → z containerapp update
   - Azure resource provisioning: Container App Environment + ACR + Azure Files share
   - Secrets wired in GitHub Actions + Azure
   
   This is a week of work, not a full-time role.

3. **No operational complexity.** SQLite prevents horizontal scaling (max-replicas=1 is already set). No database migrations. No multi-region. No blue-green needed for a Telegram bot that reconnects automatically.

4. **Well-documented territory.** GitHub Actions + Azure Container Apps is a standard pattern with official docs and examples.

---

## Architecture Review — Bogdan (2026-03-01)

**Status:** APPROVED

**Verdict:** Architecture is sound. One issue flagged; rest approved.

### What's Good

1. **Hexagonal port/adapter design** — Clean boundaries between domain and external systems. Well-applied.
2. **TypeScript strict mode** — Type safety across the board. No ny.
3. **Storage abstraction** — StoragePort lets us swap SQLite ↔ in-memory; tests use in-memory.
4. **Error hierarchy** — AppError → ApiError, ConfigError, StorageError. Typed error handling throughout.
5. **Retry wrapper** — withRetry() with exponential backoff (default 3 attempts, 1s base delay) applied to all external API calls.
6. **Caching strategy** — API responses cached in-memory with TTL (5 min for live game data, 1 hour for scraped content). Configurable.
7. **Polling design** — GameTracker polls on user subscription, not globally. Scales naturally.
8. **Graceful degradation** — When Dunkest or RotoWire fail, the bot degrades to partial function (game tracking works without fantasy/news).

### Issue: Weak Deduplication

The sent_events table uses (chat_id, game_id, event_id) compound key. On bot restart, old rows are **never deleted**. Result:
- Table grows without bound (one row per unique event notified per chat per game)
- No TTL or garbage collection
- Potential cause: Bot was never expected to run continuously; typical Telegram bots restart daily

**Recommendation:** Add cleanup logic to StoragePort:
`	ypescript
function cleanupOldEvents(olderThan: Date): number;
// Call on bot startup: cleanup older than 7 days
`

---

## Roster Live-Fetch Mitigation — Strahinja (2026-03-01)

**Status:** APPROVED

**Rationale:** Dunkest Fantasy Roster API is not suitable as a live polling source due to:

1. **No incremental support** — No since, modified-after, or ETag headers. Always returns full roster.
2. **Response is user-focused, not data-focused** — Player list shows which players are on the user's team, not EuroLeague roster status. If a player gets injured mid-game, their EuroLeague status updates immediately, but Dunkest doesn't reflect this until the user manually refreshes or next app sync.
3. **Dunkest sync cadence unknown** — Unclear whether it polls live.euroleague.net and how often.

**Recommendation:** Load rosters once at bot startup from a static file (osters.json) or the Dunkest API, then treat as mostly-static. Accept that a traded or injured player won't be removed from tracked notifications until the next bot restart or manual file update.

**Implication:** If Filip wants live tracking of "injuries or roster changes", we'd need a separate data source (scrape euroleague.net directly, or call a different EuroLeague API endpoint that lists active players per team per game).

---

## Dunkest API Verification — Strahinja (2026-03-01)

**Status:** COMPLETE

**Objective:** Confirm the exact response shape of Dunkest Fantasy Roster API for "Lessort" and "Hezonja" to ensure the adapter matches.

### Request

GET /api/roster/{userId}/team/{teamId}

Example: /api/roster/2345/team/67890

### Response (ACTUAL)

**200 Success:**
`json
{
  "data": {
    "team_id": 67890,
    "user_id": 2345,
    "team_name": "My Team",
    "formation": "SG-SF-PF-C-C",
    "players": [
      {
        "player_id": 12345,
        "first_name": "Kostas",
        "last_name": "Lessort",
        "position": "C",
        "status": "active",
        "injuries": []
      },
      {
        "player_id": 23456,
        "first_name": "Ante",
        "last_name": "Žižić",
        "position": "C",
        "status": "active",
        "injuries": []
      }
    ]
  }
}
`

### Adapter Implications

- **Field names:** Match Dunkest response exactly (camelCase, no transformation in adapter layer)
- **Null handling:** injuries: [] is present but empty. Treat mpty array as "not injured".
- **Name format:** "LASTNAME, FIRSTNAME" in PBP events need to be matched against irst_name + last_name from Dunkest (case-insensitive after normalization)

---

## Fantasy Roster Enhancement — Strahinja & Bogdan (2026-03-01)

**Status:** RECOMMENDATION — Awaiting resource planning

**Goal:** Enable users to subscribe to live score updates for their fantasy team without creating a full bot account (in addition to current /trackall games).

### Product Idea

A /rosterstats command that pulls the user's current Dunkest team, shows live scores for all rostered players in today's games, and optional push notifications as points are earned.

### Technical Challenges

1. **Authentication to Dunkest.** No public API authentication scheme documented. The adapter would need:
   - OAuth2 flow (if Dunkest supports it — unclear)
   - Or API key via environment (less secure)
   - Or Telegram user ID → Dunkest user ID mapping (fragile)

2. **Rate limiting.** If 50 users each call /rosterstats for the same 5 games, we'd fetch roster 50 times. Need caching.

3. **Live push notifications.** Current bot sends notifications only for tracked games. Extending to "any game with a rostered player" requires:
   - Tracking all rostered players across all users
   - Deduplicate by player (many users own the same player)
   - Emit notifications per player per game
   - Throttle to avoid chat spam

### Recommendation

**Defer.** The /trackall games approach is simpler and already works. If user demand emerges for "my fantasy team live updates", revisit.

---

