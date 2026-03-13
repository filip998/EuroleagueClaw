# Decisions

<!-- Append-only. Newest entries at the bottom. -->

## PBP Incremental Fetch Investigation — Nikola (2026-03-13)

**Status:** INVESTIGATION COMPLETE — No action required, mitigations optional

**Question:** Can we avoid fetching the full PlayByPlay payload (~157 KB, 578 events) on every poll cycle?

### Findings Summary

| Test | Result |
|------|--------|
| Server-side filtering params (quarter, from, since, etc.) | All ignored — full payload returned |
| Conditional requests (If-Modified-Since, ETag) | Not supported — always 200 |
| gzip compression | **Works: 157 KB → 10.7 KB (6.8%)** |
| Alternative endpoints (Header, Points, Boxscore) | Discovered and documented |

### Current State

The adapter already does client-side filtering via `sinceEventId`. The full payload is fetched but only new events are processed. This is optimal given the API design.

### Mitigation Options (if bandwidth becomes critical)

1. **Ensure gzip is active** (near-free win) — already default in Node.js fetch()
2. **Use `/api/Header` for score-only polling** — 475 bytes gzipped, 22× cheaper than PBP
3. **Use `/api/Points` for roster tracking** — 4.5 KB gzipped, smaller than full PBP
4. **Adaptive polling during dead time** — reduce poll frequency during timeouts/halftime
5. **Client-side response caching (5–10s TTL)** — avoids redundant parsing for multi-chat scenarios

### Recommendation

**No code changes needed now.** The gzip compression reduces real transfer to ~11 KB per poll, which is acceptable for a polling bot. If further optimization is required, option #2 (Header-first gating) gives the best cost/complexity tradeoff.

### Related Decisions

- Bogdan's PBP Optimization Strategy (ranked tier 1–3 alternatives)
- Nikola's Live Player Notification Latency Investigation (polling interval impact)

---

## PBP Optimization Strategy — Bogdan (2026-03-13)

**Status:** RANKED RECOMMENDATIONS COMPLETE

**Trigger:** Investigate reducing PBP data volume for cost optimization.

### Critical Finding

PBP is **only used for roster matching**. Score detection, quarter transitions, lead changes, and big runs all use `getLiveScore()`, not PBP.

### Data Volume Analysis

| Metric | Value |
|--------|-------|
| Full game PBP | ~154 KB / 578 events |
| Notable events (27%) | ~156 events |
| Wasted non-notable (73%) | 422 events |
| Per 2-hour game (15s polling) | ~45 MB transfer |

### Hidden Waste

Current implementation fetches full PBP every 15 seconds **even when rosters aren't loaded**. If `rosters.json` is empty, we fetch 154 KB and return early with no roster match.

### Ranked Optimization Alternatives

**Tier 1: Free Wins (No API Probing)**

1. **Skip PBP fetch when rosters not loaded** (3 lines)
   - Impact: 100% traffic reduction when no rosters configured
   - Change: Guard `onPlayByPlay` callback with roster presence check
   - Risk: Zero

2. **Reduce PBP poll frequency to 30–45s** (1 number change)
   - Impact: 50–67% traffic reduction
   - Change: `const PBP_POLL_INTERVAL_MS = 30000;`
   - Risk: Minimal (roster notifications arrive 15–30s later; acceptable)

**Tier 2: API-Dependent (After Nikola's Probe)**

3. **Lightweight polling pattern** (if `/api/Header` stable)
   - Impact: 60–70% reduction
   - Pattern: Poll Header every 30s, fetch full PBP on score change only

4. **Points-only polling** (if `/api/Points` includes player names)
   - Impact: 70% reduction
   - Trade-off: Loses rebound/foul/sub events

### Combined Impact

Implementing Tier 1 (guard + reduce interval): **90%+ reduction** with 5 lines of code.

### Implementation Priority

1. **Immediate:** Guard on roster presence + reduce interval to 30s
2. **Monitor:** Track bandwidth; if <1MB/game, declare success
3. **Future:** Evaluate Tier 2 alternatives if needed

### Owner

Strahinja (Backend Dev) — High priority, quick ROI, low risk

---

## Raw PBP API Capture Approach — Nikola (2026-03-13)

**Status:** IMPLEMENTED

**Context:** Filip requested a full raw EuroLeague play-by-play API response for PAO vs Zalgiris game in JSON format for inspection.

### Decision

**Preserve the raw API response without transformation.** Fetch from the live PBP endpoint and save both minified and pretty-printed JSON, exactly as returned by the API.

### Rationale

1. Raw inspection value — Filip audits the upstream schema directly
2. No downstream impact — raw payload serves analysis only
3. Audit trail — ensures we can trace API schema changes over time
4. Storage efficiency — Both minified (~157 KB) and pretty (~237 KB) are acceptable

### Implementation Details

- **Endpoint:** `https://live.euroleague.net/api/PlaybyPlay?gamecode={gameCode}&seasoncode={seasonCode}`
- **Game:** Panathinaikos AKTOR Athens vs Zalgiris Kaunas (Game Code `305`, Season `E2025`)
- **Payload:** 578 play-by-play events across 4 quarters
- **Location:** Session state files directory (raw and pretty-printed JSON)

### Follow-up

No follow-up changes required. The `EuroLeagueAdapter.getPlayByPlay()` method already maps raw PBP events correctly.

---

## Live Tracked-Player Notifications — Architecture Recommendation — Bogdan (2026-07-18)

**Status:** RECOMMENDATION

**Requested by:** Filip Tanic

**Product Goal:** Whenever a tracked player does something notable during a live game — including missed shots — post an update to chat as fast as realistically possible.

### Current State

The system has 80% of the plumbing:
- PBP polling exists (every 15s)
- RosterTracker matches events by normalized name
- MessageComposer formats matched events for chat
- Container wiring complete
- Deduplication via `lastEventId`

### What's Missing (Severity)

| Gap | Severity |
|-----|----------|
| Event filter too restrictive (only made shots, assists, steals, blocks) | Critical |
| No per-player subscription model | High |
| Score updates and player updates share same message flow | Medium |
| PBP throttling absent | Medium |
| Full PBP payload fetched every cycle | Low |

### Recommended Architecture

#### 1. Polling Strategy — Keep 15s Interval

No change to polling frequency. 15-second intervals are the sweet spot:
- The API returns the entire game's PBP (no server-side `since` filter)
- 15s is fast enough that users perceive updates as "live"
- Going faster (5–10s) doubles/triples API load with marginal UX benefit
- `sinceEventId` client-side filter already avoids re-processing

#### 2. Event Classification — Configurable Event Classes

Don't send literally everything. Introduce event classes:

```typescript
type PlayerEventClass = 'scoring' | 'playmaking' | 'defensive' | 'negative' | 'administrative';
```

Default subscription: `scoring` + `playmaking` + `defensive` + `negative`. A `/trackconfig` command deferred to Phase 2 could let users toggle.

#### 3. Per-Player Subscriptions — Defer

The current roster-based model (track all fantasy players) already covers the use case. Defer explicit per-player subscriptions unless demand emerges.

#### 4. Deduplication Strategy — Already Solved

`lastEventId` persisted per tracked game, `sinceEventId` filter in PBP fetch. Sufficient — no change needed.

#### 5. Message Throttling — Critical Piece

**Recommended approach: Batched Player Digests**

Instead of one message per event, batch events into 20–30s digest windows:

```
🏀 Q2 7:42 — Player Updates
├ HEZONJA: 🏀 2pt Made (8pts) → 🎯 Assist
├ LESSORT: ❌ 2pt Miss → 🏀 2pt Made (12pts)
└ VESELY: 🛡 Block
```

**Implementation:**
1. New domain service: `PlayerEventBatcher` collects events per chat in a buffer, flushes every N seconds
2. Wire into `onPlayByPlay` callback
3. Groups events by player, composes single digest message
4. Respects `ThrottleManager` rate limits

**Alternative (Phase 1, simpler):** Wire PBP messages through `ThrottleManager` like score events. Add PBP event priority: scoring = normal, misses = low. This is 10 lines of code.

#### 6. Separating Score Updates from Player Updates — Visual Distinction

Score updates and player updates interleave in the same chat. Users need to tell them apart:

- **Score updates:** Plain text, score-focused
- **Player updates:** MarkdownV2, player-focused, prefixed with roster emoji (📋)

Existing `composeRosterMatch()` format already uses 📋 prefix — no change needed.

### Build Order

**Phase 1 — Ship First (1–2 days)**
1. Expand `NOTABLE_EVENT_TYPES` in `roster-tracker.ts` to include misses, turnovers, rebounds, fouls
2. Wire PBP messages through ThrottleManager with priority (made shots/assists/steals/blocks = normal, misses = low)
3. Add PBP event type to `composeRosterMatch()`
4. Unit tests for expanded event matching, throttle integration

**Phase 2 — Polish (3–5 days)**
5. `PlayerEventBatcher` service with configurable flush interval
6. `/trackconfig` command to toggle event classes per chat
7. Event class persistence in SQLite

**Phase 3 — If Demanded**
8. Per-player subscriptions (`/trackplayer`, `/untrackplayer`)
9. Telegram topic threading for player updates
10. PBP API optimization (conditional requests, reduced payload)

### Key Risks

1. **PBP API reliability** — Undocumented legacy service. Graceful degradation already in place.
2. **Chat spam** — Even with throttling, 4+ tracked players could generate 20+ messages per quarter. Phase 2 batching is the real fix.
3. **Name matching gaps** — `normalizeName()` handles case but not variants (e.g., "De Colo" vs "DE COLO, NANDO").

### Decision

**Build Phase 1 immediately.** Expand event filter and wire throttling — 50–80 lines of code, 90% of what Filip wants. Batching (Phase 2) is the right long-term answer but doesn't block Phase 1 ship.

**Do not build per-player subscriptions.** The roster-based model already covers the use case.

---

## Near-Instant Tracked-Player Notifications — Data Strategy — Nikola (2026-07-18)

**Status:** RECOMMENDATION — Requires team discussion before implementation

**Goal:** Filip wants every tracked-player action pushed to chat as fast as possible. Currently ~15–20s average latency.

### Where Latency Comes From

| Stage | Current Latency | Controllable? |
|-------|---------|---|
| Upstream publication (EuroLeague stat crew enters event) | 2–15s | ❌ No |
| Poll interval wait (15s default, avg half-cycle) | 0–15s (avg 7.5s) | ✅ Yes |
| Sequential getLiveScore() + getPlayByPlay() fetch | 0.5–1.3s | ✅ Yes |
| Client-side PBP parsing + roster match | <10ms | — |
| Throttle check (5 msg/min, 120s window) | 0–120s | ✅ Yes |
| Telegram API send | 0.1–0.3s | — |
| **Total (typical)** | **~15–20s** | |

### Recommended Strategy: PBP-Primary Polling

#### Core Idea

Make the PBP endpoint the single source of truth. It already contains everything: player actions, running scores, clock, quarter. The separate `getLiveScore()` call is redundant — remove it from the hot path and derive game-level events from PBP data directly.

#### 1. Reduce PBP Poll Interval to 5 Seconds

Set `EUROLEAGUE_POLL_INTERVAL_MS=5000`. No observed rate limiting. With gzip: ~7.7 MB/hour/game.

**Impact:** Average poll-wait drops from 7.5s → 2.5s. Single biggest latency win.

#### 2. Decouple LiveScore from PBP Polling

Currently `pollGame()` does `getLiveScore()` then `getPlayByPlay()` in series.

**Instead:**
- **PBP poll (5s):** Fetch full PBP, extract new events via `sinceEventId`, derive score/quarter/clock from the latest event. Use for BOTH game-level events AND player-action notifications.
- **LiveScore poll (30–60s):** Separate slower cadence. Used only as fallback/sanity-check and for detecting game status transitions.

**Impact:** Eliminates ~200–500ms serial dependency per poll.

#### 3. Expand NOTABLE_EVENT_TYPES

Add misses and turnovers to roughly double notification volume.

```typescript
const NOTABLE_EVENT_TYPES: ReadonlySet<PlayByPlayEventType> = new Set([
  'two_pointer_made', 'two_pointer_missed',
  'three_pointer_made', 'three_pointer_missed',
  'free_throw_made', 'free_throw_missed',
  'assist', 'steal', 'block', 'turnover',
]);
```

#### 4. Rethink Throttle for Player Notifications

Current config (5 msg/min, 120s window) will suppress most player events. Options:

- **A) Batch per-cycle:** Combine all roster-matched events from one poll into a single message
- **B) Separate throttle tier:** PBP roster notifications exempt, with their own higher limit (20 msg/min)
- **C) Configurable per-chat:** Let chat admins choose "all events" vs "scoring only" vs "critical only"

**Recommendation:** Start with (A) batching — simplest, reduces spam.

#### 5. Add PBP Response Cache (5s TTL)

If multiple chats track the same game, cache the parsed PBP response for the current poll cycle. Avoids redundant fetches and parsing.

### Achievable Latency

| Stage | After Changes |
|-------|--------------|
| Upstream publication | 2–15s (unchanged) |
| Poll interval wait (5s, avg half-cycle) | 0–5s (avg 2.5s) |
| PBP fetch (single call) | 0.3–0.8s |
| Processing + match | <10ms |
| Telegram send | 0.1–0.3s |
| **Total (typical)** | **~5–12s (avg ~8s)** |

### What "Instant" Really Means

- **True instant (<2s):** Impossible without push/WebSocket API
- **Near-instant (3–8s):** Achievable for scoring plays (stat crew enters fastest)
- **Fast (5–15s):** Achievable for non-scoring plays (lower priority, appear later)
- **The 5s poll interval is the sweet spot.** Going to 3s saves only ~1s average but doubles API load.

### What NOT to Do

- **Don't use `/api/Header` as PBP gate.** Header only shows score changes; misses don't change score.
- **Don't use `/api/Points`.** Scoring events only — no misses, turnovers, or other actions.
- **Don't scrape EuroLeague website.** HTML rendering lags API + fragile dependencies.

### Implementation Scope

| Change | Owner | Effort |
|--------|-------|--------|
| PBP-primary polling refactor in GameTracker | Strahinja | Medium |
| Expand NOTABLE_EVENT_TYPES | Strahinja | Trivial |
| Batch roster notifications in MessageComposer | Strahinja | Small |
| PBP response cache in EuroLeagueAdapter | Nikola | Small |
| Throttle tier for PBP notifications | Strahinja | Small |
| Config: `PBP_POLL_INTERVAL_MS` separate from main poll | Nikola/Strahinja | Trivial |
| Tests for new notification flow | Tihomir | Medium |

### Risks

1. **Upstream rate limiting.** No observed limits, but 720 requests/hour/game is aggressive. Mitigate: exponential backoff on 429, log request counts.
2. **Message flood.** Adding misses + turnovers can produce 15–25 messages/minute. Batching is critical.
3. **PBP API downtime.** Service occasionally returns empty responses mid-game. Existing retry logic handles, but 5s intervals burn attempts faster. Keep `maxAttempts: 2` to fail fast.

---

## Code Review — Uncommitted src/ Changes — Bogdan (2026-07-18)

**Status:** APPROVED

**Scope:** 5 modified files never committed:
- `src/adapters/dunkest/dunkest.adapter.ts`
- `src/container.ts`
- `src/domain/command-router.ts`
- `src/domain/message-composer.ts`
- `src/domain/roster-tracker.ts`

### Verdict: APPROVE

All changes are architecturally consistent, correct, and introduce no regressions.

### Approved Changes

1. **Dunkest `/roster/preview` endpoint** — Fixes API access for non-authenticated users. Correct fix.
2. **Container roster file fallback removed** — API is now the single source. Graceful degradation with warning log. Clean simplification.
3. **`/trackall` command** — Tracks all today's games in one shot. Plain text output (not in `MARKDOWN_COMMANDS`). Per-game error handling. Follows patterns.
4. **Help text updated** — `/trackall` added to help message.

### Follow-up Items (Non-Blocking)

1. **Dead code in `roster-tracker.ts`** — `loadFromFile()`, `loadFromFileAndMerge()`, `mergeRosters()`, `readFileSync` import unused now. Should be cleaned up in follow-up commit.

2. **No tests for `/trackall`** — New command has zero test coverage. Should add to `tests/unit/command-router.test.ts`.

### Test Results

- **206/222 tests pass** — All unit + EuroLeague integration green
- **16 SQLite failures** — Pre-existing environment issue (better-sqlite3 Node 23 vs Node 22). Unrelated to these changes.

---

## User Directives — Filip Tanic

### 2026-03-13T13:09:18Z

**What:** Always spawn Scribe after every agent batch completes. Always push `.squad/` changes to git. No exceptions.

**Why:** User request — captured for team memory

---

### 2026-03-13T14:16:58Z

**What:** Default squad model policy is Claude Opus 4.6 for all non-trivial work; smaller tasks may use Claude Sonnet 4.5 as the medium-reasoning fallback. Prefer premium models for squad members and high reasoning mode by default.

**Why:** User request — captured for team memory

---

### 2026-03-13T14:34:39Z

**What:** The bot should prioritize live updates for tracked player actions in chat, including missed shots, as close to instant as the upstream data allows.

**Why:** User request — captured for team memory

### 2026-03-13T14:52:40Z

**What:** Keep PlayByPlay fetching limited to live games only while implementing lower-latency tracked-player updates.

**Why:** User request — captured for team memory

---

## Azure Deployment Recommendation — Milan (DevOps)

**Status:** RECOMMENDATION — Awaiting Filip's approval before implementation

**Requested by:** Filip Tanic  
**Context:** "Let's try deploying this to Azure, what do we need?"

---

## 1. Recommended Azure Architecture

### Service Selection: Azure Container Apps (Consumption Plan)

**Why Container Apps over alternatives:**

| Option | Verdict | Reason |
|--------|---------|--------|
| **Azure Container Apps** | ✅ **Recommended** | Native container support, consumption-based pricing, built-in health probes, easy secret management, Azure Files volume mounts for SQLite |
| Azure App Service (Container) | ❌ | More expensive for a single long-running bot; better suited for HTTP-serving workloads |
| Azure Container Instances | ❌ | No built-in restart policies, no revision management, limited observability |
| Azure VM | ❌ | Overkill ops burden for a single-container bot |
| Azure Kubernetes Service | ❌ | Massive overkill — this is one container |

### Required Azure Resources

| Resource | SKU / Tier | Purpose |
|----------|-----------|---------|
| **Resource Group** | — | Logical container for all resources |
| **Azure Container Registry (ACR)** | Basic ($5/mo) | Store Docker images |
| **Azure Container Apps Environment** | Consumption | Hosts the container app |
| **Azure Container App** | Consumption (0.25 vCPU, 0.5 Gi) | Runs the bot |
| **Azure Files (Storage Account)** | Standard LRS | Persistent SQLite database + trivia/roster data |

### Architecture Diagram

```
GitHub Actions
    │
    ├─► Build Docker image
    ├─► Push to Azure Container Registry
    └─► Deploy to Azure Container Apps
                 │
                 ├── Container: euroleague-claw
                 │   ├── Port 8080 (health check)
                 │   └── /app/data → Azure Files mount
                 │
                 └── Azure Files Share
                     ├── euroleague-claw.db
                     ├── trivia.json
                     └── rosters.json
```

---

## 2. SQLite Persistence — The Critical Challenge

SQLite needs a real filesystem with POSIX locking. This is the #1 constraint for the deployment.

### Solution: Azure Files SMB Mount

Azure Container Apps supports mounting Azure Files shares as volumes. This gives SQLite a persistent, durable filesystem.

**Configuration:**

```yaml
# In Container App template
volumes:
  - name: bot-data
    storageName: botdatastorage    # linked Azure Files share
    storageType: AzureFile

containers:
  - name: euroleague-claw
    volumeMounts:
      - volumeName: bot-data
        mountPath: /app/data
```

**Important caveats:**
- Azure Files SMB supports SQLite's locking semantics for a **single-writer** scenario (which this bot is — one container instance)
- **Max replicas must be 1** — SQLite does not support concurrent writers from multiple containers
- WAL mode works over Azure Files SMB (the bot already uses WAL — `.db-wal` file present)
- Latency is slightly higher than local disk (~1-3ms per operation vs <0.1ms), but fine for this bot's write patterns

**Container App scaling rule:**

```json
{
  "minReplicas": 1,
  "maxReplicas": 1
}
```

### Alternative Considered: Azure Blob + SQLite VFS

Libraries like `sqlite-vfs` can back SQLite with blob storage. **Rejected** — adds complexity, latency, and maintenance burden for zero benefit at this scale.

### Alternative Considered: Migrate to PostgreSQL

Azure Database for PostgreSQL Flexible Server would eliminate the file persistence concern. **Deferred** — adds $13+/mo cost, requires adapter rewrite, and is overkill for a bot serving a few Telegram groups. If scaling beyond 1 replica becomes necessary, this is the right path.

---

## 3. Environment Variables & Secrets

### Full Environment Variable Surface (from `src/config.ts`)

| Variable | Required | Sensitive | Default | Notes |
|----------|----------|-----------|---------|-------|
| `TELEGRAM_BOT_TOKEN` | ✅ Yes | 🔒 **Secret** | — | Bot authentication |
| `TELEGRAM_ALLOWED_CHAT_IDS` | No | No | `[]` | Comma-separated chat IDs |
| `EUROLEAGUE_SEASON_CODE` | No | No | `E2025` | |
| `EUROLEAGUE_COMPETITION_CODE` | No | No | `E` | |
| `EUROLEAGUE_POLL_INTERVAL_MS` | No | No | `10000` | |
| `EUROLEAGUE_LIVE_API_BASE` | No | No | `https://api-live.euroleague.net` | |
| `DUNKEST_API_BASE` | No | No | `https://fantaking-api.dunkest.com/api/v1` | |
| `DUNKEST_BEARER_TOKEN` | No | 🔒 **Secret** | `''` | Fantasy API auth |
| `DUNKEST_FANTASY_TEAM_IDS` | No | No | `[]` | Comma-separated |
| `LOG_LEVEL` | No | No | `info` | |
| `NODE_ENV` | No | No | `development` | Set to `production` |
| `DATABASE_PATH` | No | No | `./data/euroleague-claw.db` | |
| `HEALTH_PORT` | No | No | `8080` | |
| `THROTTLE_WINDOW_SECONDS` | No | No | `120` | |
| `THROTTLE_MAX_MESSAGES_PER_MINUTE` | No | No | `5` | |

### Secrets Management Strategy

**Use Container Apps built-in secrets** (not Key Vault — overkill for 2 secrets):

```bash
# Set secrets during deployment
az containerapp secret set \
  --name euroleague-claw \
  --resource-group euroleague-rg \
  --secrets telegram-bot-token="<value>" dunkest-bearer-token="<value>"

# Reference in env vars
az containerapp update \
  --name euroleague-claw \
  --set-env-vars \
    TELEGRAM_BOT_TOKEN=secretref:telegram-bot-token \
    DUNKEST_BEARER_TOKEN=secretref:dunkest-bearer-token
```

**GitHub Actions secrets** (for CI/CD pipeline):
- `AZURE_CREDENTIALS` — Service principal JSON for `az login`
- `TELEGRAM_BOT_TOKEN` — Passed to Container App secrets
- `DUNKEST_BEARER_TOKEN` — Passed to Container App secrets

Non-sensitive env vars are set directly on the Container App as plain environment variables.

---

## 4. CI/CD Pipeline — GitHub Actions

### Workflow: `.github/workflows/deploy.yml`

**Trigger:** Push to `main` branch  
**Steps:**

1. **Checkout** code
2. **Install deps + lint + test** — fail fast on broken code
3. **Login** to Azure via service principal (`azure/login@v2`)
4. **Login** to ACR (`az acr login`)
5. **Build & push** Docker image to ACR (tagged with commit SHA + `latest`)
6. **Deploy** to Container Apps (`az containerapp update --image`)

**Estimated pipeline time:** ~3-4 minutes

### Proposed Workflow Structure

```yaml
name: Deploy to Azure
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - run: az acr login --name euroleagueclaw
      - run: |
          docker build -t euroleagueclaw.azurecr.io/euroleague-claw:${{ github.sha }} .
          docker build -t euroleagueclaw.azurecr.io/euroleague-claw:latest .
          docker push euroleagueclaw.azurecr.io/euroleague-claw --all-tags
      - run: |
          az containerapp update \
            --name euroleague-claw \
            --resource-group euroleague-rg \
            --image euroleagueclaw.azurecr.io/euroleague-claw:${{ github.sha }}
```

---

## 5. Estimated Monthly Azure Costs

| Resource | SKU | Est. Monthly Cost |
|----------|-----|-------------------|
| **Container Apps** (Consumption) | 0.25 vCPU, 0.5 Gi, always-on | ~$7–12 |
| **Azure Container Registry** | Basic | $5 |
| **Azure Storage (Files)** | Standard LRS, <1 GB | ~$0.05 |
| **Egress** | <5 GB/mo (API calls + Telegram) | ~$0.50 |
| **Total** | | **~$13–18/month** |

### Cost Notes

- Container Apps Consumption charges per vCPU-second ($0.000024) and GiB-second ($0.000003). A single always-on container with 0.25 vCPU + 0.5 Gi runs ~$7-12/mo.
- The bot must run 24/7 (it polls live games and listens for Telegram commands), so scale-to-zero is **not applicable**.
- `minReplicas: 1` ensures the bot is always running.
- Storage costs are negligible — the SQLite DB is measured in KB-to-low-MB.
- **No free tier applies** for Container Apps consumption that's always-on. But this is still the cheapest container hosting option on Azure.

### Comparison to Alternatives

| Platform | Est. Monthly |
|----------|-------------|
| **Azure Container Apps** | **~$15** |
| Azure App Service B1 | ~$13 |
| Azure VM B1s | ~$8 + ops overhead |
| Railway/Render | ~$5-7 (but less Azure integration) |

---

## 6. Prerequisites — What Filip Needs

### One-Time Azure Setup

1. **Azure Subscription** — If none exists, create one at [portal.azure.com](https://portal.azure.com). A pay-as-you-go subscription is fine.

2. **Azure CLI installed** — `winget install Microsoft.AzureCLI` or [download](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)

3. **Resource Group:**
   ```bash
   az group create --name euroleague-rg --location westeurope
   ```

4. **Azure Container Registry:**
   ```bash
   az acr create --name euroleagueclaw --resource-group euroleague-rg --sku Basic --admin-enabled true
   ```

5. **Storage Account + File Share (for SQLite):**
   ```bash
   az storage account create --name euroleagueclawdata --resource-group euroleague-rg --sku Standard_LRS --location westeurope
   az storage share create --name bot-data --account-name euroleagueclawdata
   ```

6. **Container Apps Environment:**
   ```bash
   az containerapp env create --name euroleague-env --resource-group euroleague-rg --location westeurope
   
   # Link storage to environment
   az containerapp env storage set \
     --name euroleague-env \
     --resource-group euroleague-rg \
     --storage-name botdatastorage \
     --azure-file-account-name euroleagueclawdata \
     --azure-file-account-key <storage-key> \
     --azure-file-share-name bot-data \
     --access-mode ReadWrite
   ```

7. **Service Principal for GitHub Actions:**
   ```bash
   az ad sp create-for-rbac --name "euroleague-claw-deploy" \
     --role contributor \
     --scopes /subscriptions/<subscription-id>/resourceGroups/euroleague-rg \
     --json-auth
   ```
   → Store the JSON output as `AZURE_CREDENTIALS` in GitHub repo secrets.

8. **Grant ACR pull to Container Apps:**
   ```bash
   az containerapp registry set \
     --name euroleague-claw \
     --resource-group euroleague-rg \
     --server euroleagueclaw.azurecr.io \
     --identity system
   ```

### GitHub Repository Secrets to Configure

| Secret Name | Value |
|-------------|-------|
| `AZURE_CREDENTIALS` | Service principal JSON |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DUNKEST_BEARER_TOKEN` | Dunkest API token (if using fantasy features) |

---

## 7. Dockerfile Changes Needed

The current Dockerfile is **mostly good**, but needs two adjustments for Azure:

### Change 1: Remove build tools from production stage

The production stage installs `python3 make g++` for better-sqlite3 compilation. This is fine but adds ~200MB to the image. A better approach: compile in the builder stage and copy the native module.

```dockerfile
# Stage 1: Build (includes native compilation)
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Production (no build tools)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/dist dist/
COPY data/ data/
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

**Benefits:** Image drops from ~350MB to ~150MB. Faster pull times in CI/CD. Smaller attack surface.

### Change 2: Add health check instruction (optional, nice-to-have)

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1
```

Container Apps has its own health probes, so this is mainly for local Docker usage.

### No Other Changes Needed

- Port 8080 exposure is correct ✅
- Volume mount point `/app/data` matches `DATABASE_PATH` default ✅
- Node 22 Alpine is a good base ✅
- `COPY data/ data/` seeds trivia.json correctly ✅

---

## 8. Health Check Configuration on Azure

Container Apps supports HTTP health probes natively:

```json
{
  "probes": [
    {
      "type": "liveness",
      "httpGet": {
        "path": "/health",
        "port": 8080
      },
      "periodSeconds": 30,
      "failureThreshold": 3
    },
    {
      "type": "startup",
      "httpGet": {
        "path": "/health",
        "port": 8080
      },
      "periodSeconds": 10,
      "failureThreshold": 5
    }
  ]
}
```

The existing `/health` endpoint returns `{"status":"ok","uptime":...,"trackedGames":...}` which is perfect for Azure probes.

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SQLite corruption on Azure Files | Low | High | WAL mode + single replica + Azure Files snapshot backups |
| Container restart loses in-flight game state | Medium | Medium | `resumeAll()` on startup already handles this ✅ |
| Azure Files latency spikes | Low | Low | Bot's DB operations are infrequent (game events, not high-throughput) |
| Secrets leak in CI logs | Low | High | Use GitHub Actions secrets + mask in logs |
| ACR image pull failures | Low | Medium | Retry policy on Container Apps deployment |

---

## 10. Recommended Implementation Order

1. **Set up Azure resources** (Resource Group, ACR, Storage, Container Apps Environment) — ~30 min
2. **Optimize Dockerfile** (move build tools to builder stage) — ~10 min
3. **Create Container App** with secrets, env vars, and Azure Files mount — ~20 min
4. **Manual first deploy** (build + push + deploy via CLI) — verify it works — ~15 min
5. **Create GitHub Actions workflow** — automate the above — ~30 min
6. **Test end-to-end** — push to main, verify auto-deploy — ~15 min

**Total estimated setup time: ~2 hours**

---

## Summary

Azure Container Apps on Consumption plan is the right fit: cheapest container hosting (~$15/mo), native Docker support, built-in secrets, and Azure Files mounting solves SQLite persistence. The existing Dockerfile needs only a minor optimization (move build tools to builder stage). The health check endpoint is already compatible with Azure probes. One GitHub Actions workflow handles the full CI/CD pipeline.
