# Milan ΓÇö History

## Project Context
**Project:** EuroleagueClaw ΓÇö TypeScript/Node.js bot for live EuroLeague basketball game updates to Telegram group chats.
**Stack:** TypeScript (strict, ESM), Node.js ΓëÑ22, grammy, better-sqlite3, node-cron, Zod, Pino, vitest
**Architecture:** Hexagonal (Ports & Adapters) with 5 ports: ChatPort, StatsPort, FantasyPort, StoragePort, SchedulerPort
**User:** Filip Tanic

## Learnings

### Joined Team (2026-03-13)
- Owns Azure deployment, GitHub Actions CI/CD, Docker, secrets flow, and runtime operations.
- Primary surfaces are `Dockerfile`, `docker-compose.yml`, `.github/workflows/`, and deployment/config assets.
- Deployment target preference is Azure with GitHub-based automation and minimal ops overhead.

### Azure Deployment Implementation (2026-03-14)
- **Dockerfile optimization**: Moved build tools (python3, make, g++) to builder stage, used `npm prune --omit=dev` to strip dev deps, then copy production-only `node_modules` to final image. Eliminates `apk add` and `npm ci` from production stage. Added Docker HEALTHCHECK using `wget` against `/health:8080`.
- **GitHub Actions workflow**: `.github/workflows/deploy.yml` — two-job pipeline (test → deploy). Test job runs lint + vitest. Deploy job builds Docker image, tags with commit SHA + latest, pushes to ACR, then updates Container App. Uses `AZURE_CREDENTIALS` and `REGISTRY_NAME` secrets.
- **Azure setup script**: `scripts/azure-setup.sh` — idempotent provisioning of all resources (RG, ACR Basic, Storage Account + File Share, Container Apps Environment, Container App). Configures secrets via `secretref`, Azure Files volume mount at `/app/data`, liveness + startup health probes on `/health`. Creates service principal for CI/CD and prints GitHub secrets setup instructions.
- **Key architecture decision**: Azure Container Apps (Consumption) + ACR Basic + Azure Files for SQLite persistence. ~$15/mo estimated. Single replica (min=max=1) since SQLite doesn't support concurrent writers.
- **All env vars from `src/config.ts`** are mapped in the Container App: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_IDS, DUNKEST_BEARER_TOKEN, DUNKEST_FANTASY_TEAM_IDS, EUROLEAGUE_SEASON_CODE, EUROLEAGUE_COMPETITION_CODE, EUROLEAGUE_POLL_INTERVAL_MS, LOG_LEVEL, NODE_ENV, DATABASE_PATH, HEALTH_PORT, THROTTLE_WINDOW_SECONDS, THROTTLE_MAX_MESSAGES_PER_MINUTE.
- **Sensitive values** (TELEGRAM_BOT_TOKEN, DUNKEST_BEARER_TOKEN) use Container Apps secrets with `secretref:` — never stored in plain text in deployment config.
- **Pre-existing issue**: SQLite integration tests fail on Windows due to native binding path mismatch — not a deployment concern (runs fine in Alpine Docker + CI).
