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

